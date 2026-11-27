/** Repairs small, unambiguous slips in model-written OpenUI Lang before validation. */

import type { createParser } from "@openuidev/lang-core";

type Parser = ReturnType<typeof createParser>;

/** Drop list references to statements the model never defined, so one missing card doesn't discard a whole page. */
export function dropUndefinedReferences(source: string, parser: Parser) {
  let repaired = source;
  for (let pass = 0; pass < 3; pass++) {
    const { unresolved } = parser.parse(repaired).meta;
    if (!unresolved.length) break;
    for (const name of unresolved) {
      if (!/^[A-Za-z_]\w*$/.test(name)) continue;
      repaired = repaired
        .replace(new RegExp(`(\\[\\s*)${name}\\s*,\\s*`, "g"), "$1")
        .replace(new RegExp(`\\s*,\\s*${name}(?=\\s*[,\\]])`, "g"), "");
    }
  }
  return repaired;
}

/** Describe what's wrong in terms a model can act on in its next attempt. */
export function structureProblem(meta: ReturnType<Parser["parse"]>["meta"]) {
  if (meta.unresolved.length) return `Define ${meta.unresolved.join(", ")} or remove ${meta.unresolved.length === 1 ? "it" : "them"} from the lists that use ${meta.unresolved.length === 1 ? "it" : "them"}.`;
  if (meta.orphaned.length) return `Connect ${meta.orphaned.join(", ")} to root, or remove ${meta.orphaned.length === 1 ? "that statement" : "those statements"}.`;
  if (meta.incomplete) return "Finish the program. It ends in the middle of a statement.";
  return "";
}


/** Keep only the first arguments of the named components, dropping extras such as invented previous values. */
export function trimArguments(source: string, limits: Record<string, number>) {
  let output = "";
  let index = 0;
  const call = new RegExp(`\\b(${Object.keys(limits).join("|")})\\(`, "g");
  for (let match = call.exec(source); match; match = call.exec(source)) {
    if (insideString(source, match.index)) continue;
    const open = match.index + match[0].length;
    const args = splitArguments(source, open);
    if (!args) continue;
    const limit = limits[match[1]];
    if (args.parts.length > limit) {
      output += source.slice(index, open) + args.parts.slice(0, limit).map((part) => trimArguments(part, limits)).join(",") + ")";
      index = args.end + 1;
      call.lastIndex = index;
    }
  }
  return output + source.slice(index);
}

/** Remove each call of one component whose trimmed arguments match, along with the list comma beside it. */
export function dropCalls(source: string, name: string, drop: (args: string[]) => boolean) {
  let output = source;
  const call = new RegExp(`\\b${name}\\(`, "g");
  for (let match = call.exec(output); match; match = call.exec(output)) {
    if (insideString(output, match.index)) continue;
    const args = splitArguments(output, match.index + match[0].length);
    if (!args || !drop(args.parts.map((part) => part.trim()))) continue;
    let start = match.index;
    let end = args.end + 1;
    const after = /^\s*,\s*/.exec(output.slice(end));
    if (after) end += after[0].length;
    else start -= /,\s*$/.exec(output.slice(0, start))?.[0].length ?? 0;
    output = output.slice(0, start) + output.slice(end);
    call.lastIndex = start;
  }
  return output;
}

function insideString(source: string, position: number) {
  let quoted = false;
  for (let i = 0; i < position; i++) {
    if (source[i] === "\\" && quoted) i++;
    else if (source[i] === "\"") quoted = !quoted;
  }
  return quoted;
}

/** Split a call's arguments at top-level commas, starting just after its opening parenthesis. */
function splitArguments(source: string, start: number) {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let from = start;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === "\\") i++;
      else if (char === "\"") quoted = false;
    } else if (char === "\"") quoted = true;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) {
      if (depth === 0) {
        parts.push(source.slice(from, i));
        return { parts, end: i };
      }
      depth--;
    } else if (char === "," && depth === 0) {
      parts.push(source.slice(from, i));
      from = i + 1;
    }
  }
  return undefined;
}
