/** Request bodies for the authentication routes. */

import {
  ValidationCollector,
  isPlainObject,
  py,
  requiredString,
  validationError,
} from "../common/validation";

export interface LoginForm {
  username: string;
  password: string;
}

export interface RefreshRequestBody {
  refresh_token: string;
}

/** The OAuth2 password flow: `application/x-www-form-urlencoded` form fields. */
export function parseLoginForm(value: unknown): LoginForm {
  const body = isPlainObject(value) ? value : {};
  const collector = new ValidationCollector();
  const username = requiredString(body, "username", ["body"], collector);
  const password = requiredString(body, "password", ["body"], collector);
  collector.throwIfAny();
  return { username: username as string, password: password as string };
}

export function parseRefreshRequest(value: unknown): RefreshRequestBody {
  if (!isPlainObject(value)) {
    throw validationError([py.dictType(["body"], "RefreshRequest")]);
  }
  const collector = new ValidationCollector();
  const refreshToken = requiredString(value, "refresh_token", ["body"], collector);
  collector.throwIfAny();
  return { refresh_token: refreshToken as string };
}
