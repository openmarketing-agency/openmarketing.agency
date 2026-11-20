/** Start the native production build with Next.js environment files and standalone assets. */

import { cp } from "node:fs/promises";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
await Promise.all([
  cp("public", ".next/standalone/public", { recursive: true }),
  cp(".next/static", ".next/standalone/.next/static", { recursive: true }),
]);

process.env.HOSTNAME ??= "127.0.0.1";
await import("../.next/standalone/server.js");
