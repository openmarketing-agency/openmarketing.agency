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
  <style>
    :root { color-scheme: light; --ground: #f7f9f7; --ink: #182a24; --rule: #dbe4de; --accent: #165c43; }
    body { margin: 0; background: var(--ground); color: var(--ink); font: 15px/1.55 system-ui, sans-serif; }
    .reference-bar { background: #fff; border-bottom: 1px solid var(--rule); }
    .reference-bar > div, .reference-heading { box-sizing: border-box; max-width: 1460px; margin: auto; padding: 14px 20px; }
    .reference-bar > div { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .reference-bar a, .reference-heading a { color: var(--accent); text-underline-offset: 3px; }
    .reference-heading { padding-top: 26px; }
    .reference-heading h1 { margin: 0 0 8px; font-size: clamp(26px, 4vw, 38px); line-height: 1.12; letter-spacing: -.03em; }
    .reference-heading p { max-width: 67ch; margin: 0; }
    a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .reference-skip { position: fixed; z-index: 100; inset: 8px auto auto 8px; padding: 10px; color: var(--accent); background: white; transform: translateY(-150%); }
    .reference-skip:focus { transform: none; }
    .swagger-ui .info { margin-block: 14px 24px; }
    .swagger-ui .scheme-container { background: white; box-shadow: none; border-block: 1px solid var(--rule); }
    .swagger-ui .wrapper { box-sizing: border-box; }
    .swagger-ui .opblock-summary-path, .swagger-ui .opblock-summary-description { overflow-wrap: anywhere; }
    .swagger-ui .btn.authorize { border-color: var(--accent); color: var(--accent); }
    .swagger-ui .btn.authorize svg { color: var(--accent); fill: currentColor; }
    .swagger-ui .info .title .version-stamp { background: #356148; }
    .swagger-ui .opblock.opblock-get .opblock-summary-method { background: #175789; }
    .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #24634d; }
    .swagger-ui .opblock.opblock-put .opblock-summary-method { background: #874a11; }
    .swagger-ui .opblock.opblock-patch .opblock-summary-method { background: #575090; }
    .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #9c3541; }
  </style>
</head>
<body>
  <a class="reference-skip" href="#main-content">Skip to API reference</a>
  <header class="reference-bar"><div>
    <strong>Open Marketing Agency</strong>
    <a href="/">Open workspace</a>
  </div></header>
  <div id="main-content" tabindex="-1">
    <div class="reference-heading">
      <h1>API reference</h1>
      <p>Explore account and tool endpoints, or view the OpenAPI specification in <a href="/openapi.json">JSON</a> or <a href="/openapi.yaml">YAML</a>.</p>
    </div>
    <div id="swagger-ui"></div>
  </div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>
    document.querySelector(".reference-skip").addEventListener("click", () => {
      requestAnimationFrame(() => document.getElementById("main-content").focus());
    });
    SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui", validatorUrl: null });
  </script>
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
