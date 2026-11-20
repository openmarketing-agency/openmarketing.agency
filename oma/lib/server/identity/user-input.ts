/** Validates email and password input for registration and profile updates. */

import {
  ValidationCollector,
  emailIssue,
  isPlainObject,
  isValidEmail,
  optionalString,
  py,
  requiredString,
  validationError,
} from "../common/validation";

export interface UserUpdateInput {
  password?: string;
  email?: string;
}

export interface UserCreateInput {
  email: string;
  password: string;
}

function requireObject(value: unknown, model: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw validationError([py.dictType(["body"], model)]);
  return value;
}

export function parseUserCreate(value: unknown): UserCreateInput {
  const body = requireObject(value, "UserCreate");
  const collector = new ValidationCollector();
  const email = requiredString(body, "email", ["body"], collector)?.trim() ?? null;
  const password = requiredString(body, "password", ["body"], collector);
  if (email !== null && !isValidEmail(email)) collector.add(emailIssue(["body", "email"]));
  collector.throwIfAny();
  return { email: email as string, password: password as string };
}

export function parseUserUpdate(value: unknown): UserUpdateInput {
  const body = requireObject(value, "UserUpdate");
  const collector = new ValidationCollector();
  const password = optionalString(body, "password", ["body"], collector, {}, true).value ?? undefined;
  const email = optionalString(body, "email", ["body"], collector, {}, true).value?.trim();
  if (email !== undefined && !isValidEmail(email)) collector.add(emailIssue(["body", "email"]));
  collector.throwIfAny();
  return { email, password };
}
