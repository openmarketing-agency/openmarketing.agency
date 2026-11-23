import { isIP } from "node:net";
import type { NextConfig } from "next";

// Dev assets are requested from the browser’s address, which can differ from the container’s.
const devOrigins = new Set<string>();
const appHost = URL.parse(process.env.OMA_APP_URL ?? "")?.hostname;
if (appHost && !appHost.includes("*")) devOrigins.add(appHost);
const bindAddress = (process.env.OMA_BIND_ADDRESS ?? "").trim().replace(/^\[|\]$/g, "");
const bindVersion = isIP(bindAddress);
if (bindVersion && bindAddress !== "0.0.0.0" && bindAddress !== "::") {
  devOrigins.add(bindVersion === 6 ? `[${bindAddress}]` : bindAddress);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: [...devOrigins],
  // Emits .next/standalone for a minimal container image (see Dockerfile).
  output: "standalone",
  redirects() {
    return [{ source: "/playbooks/:id", destination: "/campaigns/:id", permanent: true }];
  },
  outputFileTracingIncludes: {
    "/docs/**": ["./node_modules/swagger-ui-dist/swagger-ui.css", "./node_modules/swagger-ui-dist/swagger-ui-bundle.js"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
