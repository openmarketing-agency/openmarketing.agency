/** Exports the designed-document OpenUI schema for server-side prompts and validation. Run with `node --import tsx`. */

import { writeFileSync } from "node:fs";
import { documentLibrary } from "../lib/document-library.tsx";

const target = new URL("../lib/server/document-library.spec.json", import.meta.url);
writeFileSync(target, JSON.stringify(documentLibrary.toSpec()) + "\n");
