/** Generates the OpenUI system prompt and verifies that saved dashboards read only workspace analytics. */

import { createParser, generateSystemPrompt, parseExpression, split, tokenize, walkAST, type ASTNode, type LibrarySpec } from "@openuidev/lang-core";

import { analyticsDateRange, observationColumns, observationQueryTool } from "../analytics";
import { observationDashboard, observationQueryStatement } from "../observation-dashboard";
import spec from "./analytics-library.spec.json";

const library = spec as LibrarySpec;
const parser = createParser(library.schema!, library.root);
const components = new Set(Object.keys(library.components).filter((name) => name !== "TimeSeries"));
const maxArgs: Record<string, number> = { Kpi: 3, Stat: 2, Bars: 3, Series: 2, Column: 3, Table: 1, Card: 4 };
const queryName = "activity";
const fields = {
  sources: ["labels", "counts", "total", "note"],
  observations: [...observationColumns, "note"],
};
const strings = { type: "array", items: { type: "string" } };

export const dashboardSystemPrompt = generateSystemPrompt({
  library,
  promptOptions: {
    toolCalls: true, bindings: true, builtinFunctions: false,
    tools: [{
      name: observationQueryTool,
      description: "Reads saved observation records for this campaign. The sources breakdown counts records. Observation table values preserve each metric, unit, account, period, and dimensions.",
      inputSchema: { type: "object", properties: { dateRange: { type: "string", enum: ["7d", "28d"] } }, required: ["dateRange"] },
      outputSchema: {
        type: "object",
        properties: {
          sources: { type: "object", properties: {
            labels: strings, counts: { type: "array", items: { type: "integer" } }, total: { type: "integer" }, note: { type: "string" },
          } },
          observations: { type: "object", properties: {
            ...Object.fromEntries(observationColumns.map((key) => [key, strings])), note: { type: "string" },
          } },
        },
      },
    }],
    toolExamples: [observationDashboard],
    additionalRules: [
      "Return only a complete OpenUI Lang dashboard. Use the campaign ID for context. Keep titles and descriptions valid for any campaign sources and any number of observations, including zero.",
      `Copy the 7d/28d date filter and exact query from the example: ${observationQueryStatement}`,
      "Use one chart or table for the record count by source and one table containing every observation column in the example. Bind the subtitles directly to the query notes.",
      "Bind all displayed data directly to the query. Never hardcode KPI values, series, observation cells, or data-specific descriptions. Do not sum or compare different observation metrics.",
      "Use text or primary columns for the observation records. Use numeric columns for counts. Use the component argument counts from the example and omit scripts, actions, links, mutations, extra queries, and extra state.",
    ],
  },
});

function binding(node: ASTNode | undefined, dataset: keyof typeof fields, allowed = fields[dataset]) {
  if (node?.k !== "Member" || !allowed.includes(node.field) || node.obj.k !== "Member" ||
      node.obj.field !== dataset || node.obj.obj.k !== "Ref" || node.obj.obj.n !== queryName) return;
  return node.field;
}

/** Accept only an OpenUI dashboard with a bounded live query and metric bindings to its response. */
export function validateAnalyticsProgram(value: string): string {
  const fenced = /^\s*```(?:openui(?:-lang)?)?\s*\n([\s\S]*?)\n```\s*$/i.exec(value);
  const source = (fenced ? fenced[1] : value).trim();
  if (!source || source.length > 16_000 || /\]\]>openui:|<script/i.test(source)) {
    throw new Error("Return a short OpenUI Lang dashboard without scripts.");
  }

  const { root, meta, stateDeclarations, queryStatements, mutationStatements } = parser.parse(source);
  const errors = meta.errors.filter(({ severity }) => severity !== "warning");
  if (errors.length) throw new Error("Use the documented component arguments. OpenUI could not parse the layout.");
  if (meta.incomplete || meta.unresolved.length || meta.orphaned.length || root?.typeName !== "Dashboard" ||
      !Array.isArray(root.props.children) || !root.props.children.length) {
    throw new Error("Return a complete Dashboard with every component connected to root.");
  }

  const [query] = queryStatements;
  const range = query?.argsAST?.k === "Obj" && query.argsAST.entries.length === 1 ? query.argsAST.entries[0] : undefined;
  if (mutationStatements.length || queryStatements.length !== 1 || !query.complete ||
      query.statementId !== queryName || query.toolAST?.k !== "Str" || query.toolAST.v !== observationQueryTool ||
      range?.[0] !== "dateRange" || range[1].k !== "StateRef" || range[1].n !== "$dateRange" ||
      Object.keys(stateDeclarations).length !== 1 ||
      !analyticsDateRange.safeParse(stateDeclarations.$dateRange).success ||
      query.defaultsAST?.k !== "Obj" || query.defaultsAST.entries.length !== 0 ||
      query.refreshAST?.k !== "Num" || query.refreshAST.v !== 60) {
    throw new Error(`Copy the live query exactly: ${observationQueryStatement}`);
  }

  const observationFields = new Set<string>();
  const coverage = new Set<string>();
  let sourceCounts = false;
  let filters = 0;
  for (const statement of split(tokenize(source))) {
    if (statement.id === queryName) continue;
    walkAST(parseExpression(statement.tokens), (node) => {
      if (node.k !== "Comp") return;
      if (!components.has(node.name)) throw new Error("Use only the supplied dashboard components.");
      if (Object.hasOwn(maxArgs, node.name) && node.args.length > maxArgs[node.name]) {
        throw new Error("Use the component arguments in the example. Leave out previous values and extra controls.");
      }
      if (node.name === "Bars") checkBinding(node.args[0], "sources", ["labels"]);
      if (node.name === "Kpi" || node.name === "Stat") {
        checkBinding(node.args[node.name === "Kpi" ? 1 : 0], "sources", ["total"]);
      }
      if (node.name === "Series") {
        checkBinding(node.args[1], "sources", ["counts"]);
        sourceCounts = true;
      }
      if (node.name === "Column") {
        const field = binding(node.args[1], "observations", [...observationColumns]);
        const count = !field && checkBinding(node.args[1], "sources", ["labels", "counts"]) === "counts";
        if (field) observationFields.add(field);
        if (count) sourceCounts = true;
        const allowed = count ? ["number", "bar"] : ["primary", "text"];
        const format = node.args[2];
        if (format && (format.k !== "Str" || !allowed.includes(format.v))) {
          throw new Error("Use text or primary columns for labels and observations. Use number or bar columns for counts.");
        }
      }
      if (node.name === "Card") {
        for (const dataset of ["sources", "observations"] as const) {
          if (binding(node.args[3], dataset, ["note"])) coverage.add(dataset);
        }
      }
      if (node.name === "SelectFilter") {
        filters++;
        const [value, options] = node.args;
        const choices = options?.k === "Arr" ? options.els.map((entry) => entry.k === "Obj"
          ? entry.entries.find(([key]) => key === "value")?.[1] : undefined) : [];
        if (value?.k !== "StateRef" || value.n !== "$dateRange" || choices.length !== 2 ||
            !choices.some((choice) => choice?.k === "Str" && choice.v === "7d") ||
            !choices.some((choice) => choice?.k === "Str" && choice.v === "28d")) {
          throw new Error("Add the 7d and 28d date range options from the example.");
        }
      }
    });
  }
  if (filters !== 1 || !sourceCounts || coverage.size !== 2 || observationFields.size !== observationColumns.length) {
    throw new Error("Show the date filter, source record counts, and every observation column. Bind both card subtitles to the query.");
  }
  return source;
}

function checkBinding(node: ASTNode | undefined, dataset: keyof typeof fields, allowed: string[]) {
  const field = binding(node, dataset, allowed);
  if (!field) throw new Error("Bind displayed values directly to activity query fields.");
  return field;
}
