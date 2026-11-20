import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone for a minimal container image (see Dockerfile).
  output: "standalone",
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
