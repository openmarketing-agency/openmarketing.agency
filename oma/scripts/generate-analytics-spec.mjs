/** Exports the browser's OpenUI component schema for server-side generation and validation. */

import { writeFileSync } from "node:fs";
import { analyticsLibrary } from "../lib/analytics-library.ts";

const target = new URL("../lib/server/analytics-library.spec.json", import.meta.url);
writeFileSync(target, JSON.stringify(analyticsLibrary.toSpec()) + "\n");
