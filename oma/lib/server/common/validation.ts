/**
 * Request validation.
 *
 * FastAPI answered malformed bodies with `422 {"detail": [{loc, msg, type}]}` and the
 * console renders `detail[0].loc.at(-1)` + `msg`, so the shape (and never echoing the
 * submitted value) is part of the contract. Validation is written out by hand rather
 * than delegated to a decorator framework so each message and location can match the
 * previous service exactly.
 */

import { ApiError } from "./api-error";

export type Location = Array<string | number>;

export interface ValidationIssue {
  loc: Location;
  msg: string;
  type: string;
}

/** Collects issues while validating, and raises them together like pydantic does. */
export class ValidationCollector {
  private readonly issues: ValidationIssue[] = [];

  add(issue: ValidationIssue): void {
    this.issues.push(issue);
  }

  get length(): number {
    return this.issues.length;
  }

  collected(): ValidationIssue[] {
    return [...this.issues];
  }

  throwIfAny(): void {
    if (this.issues.length > 0) {
      throw validationError(this.issues);
    }
  }
}

export function validationError(issues: ValidationIssue[]): ApiError {
  return new ApiError(422, issues);
}

export function issue(loc: Location, msg: string, type: string): ValidationIssue {
  return { loc, msg, type };
}

/* ------------------------------------------------------------------ pydantic-ish issue factories */

export const py = {
  missing: (loc: Location, field: string): ValidationIssue =>
    issue([...loc, field], "Field required", "missing"),
  stringType: (loc: Location): ValidationIssue =>
    issue(loc, "Input should be a valid string", "string_type"),
  boolType: (loc: Location): ValidationIssue =>
    issue(loc, "Input should be a valid boolean", "bool_type"),
  dictType: (loc: Location, model: string): ValidationIssue =>
    issue(loc, `Input should be a valid dictionary or instance of ${model}`, "model_type"),
  stringTooShort: (loc: Location, min: number): ValidationIssue =>
    issue(
      loc,
      `String should have at least ${min} character${min === 1 ? "" : "s"}`,
      "string_too_short",
    ),
  stringTooLong: (loc: Location, max: number): ValidationIssue =>
    issue(loc, `String should have at most ${max} characters`, "string_too_long"),
  enum: (loc: Location, values: readonly string[]): ValidationIssue =>
    issue(loc, `Input should be ${values.map((value) => `'${value}'`).join(" or ")}`, "enum"),
  valueError: (loc: Location, message: string): ValidationIssue =>
    issue(loc, `Value error, ${message}`, "value_error"),
  extraForbidden: (loc: Location): ValidationIssue =>
    issue(loc, "Extra inputs are not permitted", "extra_forbidden"),
  unionTagInvalid: (loc: Location): ValidationIssue =>
    issue(loc, "Choose a supported authentication type", "union_tag_invalid"),
  urlParsing: (loc: Location): ValidationIssue =>
    issue(loc, "Input should be a valid URL, relative URL without a base", "url_parsing"),
  urlScheme: (loc: Location): ValidationIssue =>
    issue(loc, "URL scheme should be 'http' or 'https'", "url_scheme"),
  urlTooLong: (loc: Location, max: number): ValidationIssue =>
    issue(loc, `URL should have at most ${max} characters`, "url_too_long"),
  intParsing: (loc: Location): ValidationIssue =>
    issue(loc, "Input should be a valid integer, unable to parse string as an integer", "int_parsing"),
  greaterThanEqual: (loc: Location, limit: number): ValidationIssue =>
    issue(loc, `Input should be greater than or equal to ${limit}`, "greater_than_equal"),
  lessThanEqual: (loc: Location, limit: number): ValidationIssue =>
    issue(loc, `Input should be less than or equal to ${limit}`, "less_than_equal"),
};

/* ------------------------------------------------------------------ primitive helpers */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a required string field, recording `missing`/`string_type` issues. */
export function requiredString(
  body: Record<string, unknown>,
  field: string,
  loc: Location,
  collector: ValidationCollector,
): string | null {
  const value = body[field];
  if (value === undefined) {
    collector.add(py.missing(loc, field));
    return null;
  }
  if (typeof value !== "string") {
    collector.add(py.stringType([...loc, field]));
    return null;
  }
  return value;
}

/** Read an optional boolean field; explicit null is permitted where pydantic allows it. */
export function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
  loc: Location,
  collector: ValidationCollector,
  allowNull: boolean,
): { present: boolean; value: boolean | null } {
  if (!(field in body)) return { present: false, value: undefined as unknown as null };
  const value = body[field];
  if (value === null) {
    if (allowNull) return { present: true, value: null };
    collector.add(py.boolType([...loc, field]));
    return { present: false, value: null };
  }
  if (typeof value !== "boolean") {
    collector.add(py.boolType([...loc, field]));
    return { present: false, value: null };
  }
  return { present: true, value };
}

/** Read an optional string field with length bounds. */
export function optionalString(
  body: Record<string, unknown>,
  field: string,
  loc: Location,
  collector: ValidationCollector,
  bounds: { min?: number; max?: number; strip?: boolean },
  allowNull: boolean,
): { present: boolean; value: string | null } {
  if (!(field in body)) return { present: false, value: null };
  const raw = body[field];
  if (raw === null) {
    if (allowNull) return { present: true, value: null };
    collector.add(py.stringType([...loc, field]));
    return { present: false, value: null };
  }
  if (typeof raw !== "string") {
    collector.add(py.stringType([...loc, field]));
    return { present: false, value: null };
  }
  const value = bounds.strip ? raw.trim() : raw;
  if (bounds.min !== undefined && value.length < bounds.min) {
    collector.add(py.stringTooShort([...loc, field], bounds.min));
    return { present: true, value };
  }
  if (bounds.max !== undefined && value.length > bounds.max) {
    collector.add(py.stringTooLong([...loc, field], bounds.max));
    return { present: true, value };
  }
  return { present: true, value };
}

/** Optional field constrained to a fixed set of values. */
export function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  loc: Location,
  collector: ValidationCollector,
  values: readonly T[],
  allowNull: boolean,
): { present: boolean; value: T | null } {
  if (!(field in body)) return { present: false, value: null };
  const raw = body[field];
  if (raw === null) {
    if (allowNull) return { present: true, value: null };
    collector.add(py.stringType([...loc, field]));
    return { present: false, value: null };
  }
  if (typeof raw !== "string" || !values.includes(raw as T)) {
    collector.add(py.enum([...loc, field], values));
    return { present: false, value: null };
  }
  return { present: true, value: raw as T };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pydantic/`email-validator` reports a malformed address without the generic
 * "Value error, " prefix it adds to custom validators.
 */
export function emailIssue(loc: Location): ValidationIssue {
  return issue(
    loc,
    "value is not a valid email address: An email address must have an @-sign.",
    "value_error",
  );
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value) && value.length <= 320;
}
