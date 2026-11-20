/** `limit`/`offset` query parsing with the same bounds the routes declared. */

import { ValidationCollector, py, validationError } from "./validation";

export interface Paging {
  limit: number;
  offset: number;
}

function parseInteger(
  raw: string | undefined,
  field: string,
  fallback: number,
  bounds: { min?: number; max?: number },
  collector: ValidationCollector,
): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^-?\d+$/.test(raw)) {
    collector.add(py.intParsing(["query", field]));
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (bounds.min !== undefined && value < bounds.min) {
    collector.add(py.greaterThanEqual(["query", field], bounds.min));
  }
  if (bounds.max !== undefined && value > bounds.max) {
    collector.add(py.lessThanEqual(["query", field], bounds.max));
  }
  return value;
}

export function parsePaging(query: Record<string, unknown>): Paging {
  const collector = new ValidationCollector();
  const asString = (value: unknown): string | undefined =>
    value === undefined ? undefined : Array.isArray(value) ? String(value[0]) : String(value);

  const limit = parseInteger(asString(query["limit"]), "limit", 50, { min: 1, max: 200 }, collector);
  const offset = parseInteger(asString(query["offset"]), "offset", 0, { min: 0 }, collector);
  if (collector.length > 0) throw validationError(collector.collected());
  return { limit, offset };
}

export { validationError };
