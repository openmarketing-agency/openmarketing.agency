/** Maps the public auth and protected account endpoints to the identity services. */

import { notFound } from "../common/api-error";
import { userRead } from "../common/serialize";
import { empty, json, readJson, readText } from "../http";
import { loadSettings } from "../settings";
import { parseLoginForm } from "./auth-input";
import { requireUser } from "./authenticate";
import { login, revokeAllSessions } from "./sessions";
import { parseUserCreate, parseUserUpdate } from "./user-input";
import { registerUser, updateOwnProfile } from "./users";

async function loginBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(await readText(request)));
  }
  return readJson(request);
}

async function auth(request: Request, path: string): Promise<Response> {
  if (request.method !== "POST") throw notFound();
  switch (path) {
    case "register": {
      if (!loadSettings().registrationEnabled) throw notFound();
      const user = await registerUser(parseUserCreate(await readJson(request)));
      return json(userRead(user), 201);
    }
    case "jwt/login": {
      const { username, password } = parseLoginForm(await loginBody(request));
      return json(await login(username, password));
    }
    case "jwt/logout-all": {
      const user = requireUser(request);
      revokeAllSessions(user.id);
      return empty();
    }
    default:
      throw notFound();
  }
}

async function profile(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "PATCH") throw notFound();
  const user = requireUser(request);
  if (request.method === "GET") return json(userRead(user));
  const updated = await updateOwnProfile(user, parseUserUpdate(await readJson(request)));
  return json(userRead(updated));
}

export function handleIdentity(request: Request, segments: string[]): Promise<Response> {
  const [resource, ...path] = segments;
  if (resource === "auth") return auth(request, path.join("/"));
  if (resource === "users" && path.length === 1 && path[0] === "me") return profile(request);
  throw notFound();
}
