/** Request bodies for the authentication routes. */

import {
  ValidationCollector,
  isPlainObject,
  requiredString,
} from "../common/validation";

export interface LoginForm {
  username: string;
  password: string;
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
