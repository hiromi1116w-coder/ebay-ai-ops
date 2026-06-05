import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);
const env = { ...process.env, JP_DUMP_INPUTS: "1" };
if (extra[0]) env.JP_SNAPSHOT_FILE = extra[0];
const r = spawnSync(process.execPath, ["autofill_japanpost_playwright.mjs"], {
  cwd: baseDir,
  stdio: "inherit",
  env,
});
process.exit(r.status ?? 1);
