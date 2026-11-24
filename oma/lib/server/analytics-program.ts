/** Generates the OpenUI system prompt and verifies that saved dashboards read only workspace analytics. */

import { createParser, generateSystemPrompt, parseExpression, split, tokenize, walkAST, type ASTNode, type LibrarySpec } from "@openuidev/lang-core";

import { analyticsDateRange, analyticsMetrics, analyticsQueryTool } from "../analytics";
import spec from "./analytics-library.spec.json";

const library = spec as LibrarySpec;
const parser = createParser(library.schema!, library.root);
const components = new Set(Object.keys(library.components));
const metrics = new Set<string>(analyticsMetrics);
const maxArgs: Record<string, number> = { Kpi: 3, Stat: 2, Bars: 4, TimeSeries: 4, Series: 2, Column: 4, Table: 2, Card: 4 };
const queryName = "activity";
const queryStatement = `${queryName} = Query("${analyticsQueryTool}", {dateRange: $dateRange}, {}, 60)`;

export const analyticsProgramExample = [
  "root = Dashboard([filters, overview])",
  '$dateRange = "7d"',
  queryStatement,
  'filters = FilterBar([SelectFilter($dateRange, [{value: "7d", label: "Last 7 days"}, {value: "28d", label: "Last 28 days"}], "Task completion period")])',
  'overview = Section("Campaign activity", [summary, tasks, timeline, delivery], "A concise summary of the snapshot.")',
  'summary = Kpis([Kpi("Kanban tasks", activity.tasks.total, "number"), Kpi("Tasks completed", activity.timeline.total, "number"), Kpi("Scheduled jobs", activity.schedules.total, "number")])',
  'tasks = Row([Card("Kanban tasks", [Bars(activity.tasks.labels, [Series("Tasks", activity.tasks.counts)], "number")], "full", activity.tasks.note)], 320)',
  'timeline = Row([Card("Task completions", [TimeSeries(activity.timeline.labels, [Series("Completed", activity.timeline.counts)], "bar", "number")], "full", activity.timeline.note)], 320)',
  'delivery = Row([Card("Scheduled jobs", [Table([Column("Status", activity.schedules.labels, "primary"), Column("Jobs", activity.schedules.counts, "number")])], "half", activity.schedules.note), Card("Recent publications", [Bars(activity.publications.labels, [Series("Records", activity.publications.counts)], "number")], "half", activity.publications.note)], 320)',
].join("\n");

const metricSchema = {
  type: "object",
  properties: {
    labels: { type: "array", items: { type: "string" } },
    counts: { type: "array", items: { type: "integer" } },
    total: { type: ["integer", "null"] },
    note: { type: "string" },
  },
};

export const dashboardSystemPrompt = generateSystemPrompt({
  library,
  promptOptions: {
    toolCalls: true, bindings: true, builtinFunctions: false,
    tools: [{
      name: analyticsQueryTool,
      description: "Reads live aggregate task, scheduler, and publication data for the dashboard's campaign.",
      inputSchema: { type: "object", properties: { dateRange: { type: "string", enum: ["7d", "28d"] } }, required: ["dateRange"] },
      outputSchema: { type: "object", properties: Object.fromEntries(analyticsMetrics.map((name) => [name, metricSchema])) },
    }],
    toolExamples: [analyticsProgramExample],
    additionalRules: [
      "Return only OpenUI Lang source. Produce one clear operations dashboard with charts or tables, no Markdown or explanation outside the program.",
      "Use the supplied snapshot and appended campaign ID to understand which campaign the dashboard covers.",
      "Use a short description of the snapshot in the first Section. The snapshot spans 28 days for task completions. Reflect partial or missing data. Avoid hardcoded counts, forecasts, and claims about traffic, engagement, or conversions.",
      `Copy the date range and query from the example. The exact query must be ${queryStatement}. Leave the default result {} so no values are shown while the request is pending.`,
      "Use tasks, timeline, schedules, and publications. Each query member exposes labels, counts, total, and note. Bind a live chart or table and a Card subtitle from each source.",
      "Bind chart labels and series counts to the same activity source. Bind Columns to labels or counts and Kpi or Stat values to activity.<source>.total. Use numeric formatting.",
      "Skip optional previous values, reference lines, forecasts, table totals, and card controls. Use the argument counts in the example.",
      "Only use components from the dashboard library. Do not add scripts, actions, links, extra queries, or mutations. Use one SelectFilter with both 7d and 28d options.",
      "Choose a useful arrangement for the campaign. Put at most two Cards in each Row and use full-width time series.",
    ],
  },
});

function binding(node: ASTNode | undefined, fields: string[]) {
  if (node?.k !== "Member" || !fields.includes(node.field) || node.obj.k !== "Member" ||
      !metrics.has(node.obj.field) || node.obj.obj.k !== "Ref" || node.obj.obj.n !== queryName) return;
  return node.obj.field;
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
      query.statementId !== queryName || query.toolAST?.k !== "Str" || query.toolAST.v !== analyticsQueryTool ||
      range?.[0] !== "dateRange" || range[1].k !== "StateRef" || range[1].n !== "$dateRange" ||
      !analyticsDateRange.safeParse(stateDeclarations.$dateRange).success ||
      query.defaultsAST?.k !== "Obj" || query.defaultsAST.entries.length !== 0 ||
      query.refreshAST?.k !== "Num" || query.refreshAST.v !== 60) {
    throw new Error(`Copy the live query exactly: ${queryStatement}`);
  }

  const plotted = new Set<string>();
  const coverage = new Set<string>();
  let filters = 0;
  for (const statement of split(tokenize(source))) {
    if (statement.id === queryName) continue;
    walkAST(parseExpression(statement.tokens), (node) => {
      if (node.k !== "Comp") return;
      if (!components.has(node.name)) throw new Error("Use only the supplied dashboard components.");
      if (Object.hasOwn(maxArgs, node.name) && node.args.length > maxArgs[node.name]) {
        throw new Error("Use the component arguments in the example. Leave out previous values and extra controls.");
      }
      if (node.name === "Bars" || node.name === "TimeSeries") checkBinding(node.args[0], ["labels"]);
      if (node.name === "Kpi" || node.name === "Stat") checkBinding(node.args[node.name === "Kpi" ? 1 : 0], ["total"]);
      if (node.name === "Series" || node.name === "Column") {
        const metric = checkBinding(node.args[1], node.name === "Series" ? ["counts"] : ["labels", "counts"]);
        if (node.name === "Column" && node.args[2] &&
            (node.args[2].k !== "Str" || !["primary", "text", "number", "bar"].includes(node.args[2].v))) {
          throw new Error("Use only primary, text, number, or bar columns.");
        }
        if (binding(node.args[1], ["counts"])) plotted.add(metric);
      }
      if (node.name === "Card") {
        const metric = binding(node.args[3], ["note"]);
        if (metric) coverage.add(metric);
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
  if (filters !== 1 || analyticsMetrics.some((metric) => !plotted.has(metric) || !coverage.has(metric))) {
    throw new Error("Show one date range filter and live charts or tables with source notes for all four metrics.");
  }
  return source;
}

function checkBinding(node: ASTNode | undefined, fields: string[]) {
  const metric = binding(node, fields);
  if (!metric) throw new Error("Bind displayed values directly to activity query fields.");
  return metric;
}
