/** Expose the OpenAPI document as YAML 1.2, which accepts the JSON representation. */

import { connection } from "next/server";

import { openApiDocument } from "@/lib/server/openapi";
import { loadSettings } from "@/lib/server/settings";

export async function GET() {
  await connection();
  if (!loadSettings().docsEnabled) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(openApiDocument(), null, 2), { headers: { "Content-Type": "application/yaml" } });
}
