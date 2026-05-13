import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, ["autofill_japanpost_playwright.mjs"], {
  cwd: baseDir,
  stdio: "inherit",
  env: { ...process.env, JP_DUMP_INPUTS: "1" },
});
process.exit(r.status ?? 1);
