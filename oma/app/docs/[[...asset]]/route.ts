/** Serve Swagger UI and its package assets from OMA's own origin. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connection } from "next/server";

import { loadSettings } from "@/lib/server/settings";

const assets = {
  "swagger-ui.css": "text/css",
  "swagger-ui-bundle.js": "text/javascript",
};

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OMA API documentation</title>
  <link rel="stylesheet" href="/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui", validatorUrl: null });</script>
</body>
</html>`;

export async function GET(_request: Request, { params }: { params: Promise<{ asset?: string[] }> }) {
  await connection();
  if (!loadSettings().docsEnabled) return new Response(null, { status: 404 });

  const { asset } = await params;
  if (!asset) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });

  const [file] = asset;
  if (asset.length !== 1 || !Object.hasOwn(assets, file)) return new Response(null, { status: 404 });
  const content = await readFile(join(process.cwd(), "node_modules", "swagger-ui-dist", file), "utf8");
  return new Response(content, {
    headers: { "Content-Type": assets[file as keyof typeof assets], "X-Content-Type-Options": "nosniff" },
  });
}
