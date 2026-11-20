/** Expose OMA's OpenAPI document as JSON when API documentation is enabled. */

import { connection } from "next/server";

import { openApiDocument } from "@/lib/server/openapi";
import { loadSettings } from "@/lib/server/settings";

export async function GET() {
  await connection();
  if (!loadSettings().docsEnabled) return new Response(null, { status: 404 });
  return Response.json(openApiDocument());
}
