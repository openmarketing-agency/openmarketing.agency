import { mkdirSync } from "node:fs";
import { version } from "./package.json";
import { r2Url } from "./src/update";

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("package.json must declare a stable CLI version (X.Y.Z).");
const r2Base = process.env.OMA_R2_PUBLIC_URL ?? "";
if (r2Base || process.env.GITHUB_REF_TYPE === "tag") r2Url("versions/index.json", r2Base);
console.error(`==> Compiling oma-cli ${version}`);
mkdirSync("dist", { recursive: true });
const build = Bun.spawnSync([process.execPath, "build", "--compile", "--target=bun-linux-x64-baseline",
  "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--define", `OMA_BUILD_R2_PUBLIC_URL=${JSON.stringify(r2Base)}`,
  "./src/cli.ts", "--outfile", "./dist/oma"], {
  cwd: import.meta.dir, stdout: "inherit", stderr: "inherit",
});
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
console.error("==> Built dist/oma");
