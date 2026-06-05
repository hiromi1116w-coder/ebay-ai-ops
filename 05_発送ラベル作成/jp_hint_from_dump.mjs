/**
 * 1) npm run jp:hint [-- snapshot.json]  … dump からセレクタ候補
 * 2) npm run jp:guide  … 人手／ツールの役割（STEPS 先頭）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const baseDir = path.dirname(fileURLToPath(import.meta.url));

function printGuide() {
  const p = path.join(baseDir, "STEPS_4_5_6.txt");
  if (!fs.existsSync(p)) {
    console.error("STEPS_4_5_6.txt が見つかりません:", p);
    process.exit(1);
  }
  const s = fs.readFileSync(p, "utf8");
  const marker = "以下: 細かいコマンド";
  const i = s.indexOf(marker);
  console.log(i >= 0 ? s.slice(0, i).trimEnd() : s.slice(0, 4000));
}

const argv = process.argv.slice(2);
if (argv.includes("--guide") || argv.includes("-g")) {
  printGuide();
  process.exit(0);
}

const argvPath = argv.find((a) => !a.startsWith("-"));
const envPath = String(process.env.JP_SNAPSHOT_FILE || "").trim();
let dumpPath;
if (argvPath) {
  dumpPath = path.isAbsolute(argvPath) ? argvPath : path.resolve(process.cwd(), argvPath);
} else if (envPath) {
  dumpPath = path.isAbsolute(envPath) ? envPath : path.join(baseDir, envPath);
} else {
  dumpPath = path.join(baseDir, "jp_form_fields_snapshot.json");
}

if (!fs.existsSync(dumpPath)) {
  console.error("ファイルがありません:", dumpPath);
  console.error("npm run jp:dump のあと npm run jp:hint  または  npm run jp:hint -- file.json");
  console.error("人手チェックリスト: npm run jp:guide");
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
const frames = Array.isArray(j.frames) ? j.frames : [];

if (!frames.length) {
  console.error("frames が空です。format 2 の dump が必要です（npm run jp:dump）。");
  process.exit(1);
}

function escAttr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

console.log("読み込み:", dumpPath, "\n");
console.log("--- jp_hint_from_dump（手で selectors にコピー。同一文言が複数あるときは DevTools で確認）\n");

for (const fr of frames) {
  const u = fr.frameUrl || "(unknown frame)";
  console.log(`frame: ${u}`);

  for (const b of fr.buttons || []) {
    const label = String(b.value || b.text || "").trim();
    if (!label) continue;
    let role = "";
    if (/次へ/.test(label)) role = "recipientNext / step3Next / confirmNext / step4WizardNext のいずれか";
    if (/内容/.test(label) && /確認/.test(label)) role = "step5ContentConfirm 候補";
    if (/アドレス帳/.test(label)) role = "（宛先帳から選択。通常は未使用）";
    if (!role) continue;
    const sel = b.id?.trim()
      ? `#${b.id.trim()}`
      : `input.form__submit[value="${escAttr(label)}"]`;
    console.log(`  [${label}] → ${role}`);
    console.log(`      "${sel}"`);
  }

  for (const inp of fr.inputs || []) {
    const id = String(inp.id || "").trim();
    if (!id) continue;
    const name = String(inp.name || "");
    if (
      /^addr_/i.test(id) ||
      /itemTitle|quantity|hsCode|^weight|sizeL|sizeW|sizeH|vatNumber|iossNumber|rutNumber|tax|ref|duty|invoice|charg|bill|請求|課税|航空/i.test(
        id + name
      )
    ) {
      console.log(`  #${id}  (${name})`);
    }
  }
  console.log("");
}

console.log(
  "宛先の「次へ」を自動で押すとき: fillPhases の recipient に \"clickAfter\": [\"recipientNext\"] を足し、clicks.recipientNext に上のセレクタを入れる。\n"
);
