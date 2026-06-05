import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { proposeUkAll } from "./lib/uk_price_proposal.mjs";
import { mergeRules } from "./lib/profit_calc.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function toMarkdown(rows) {
  const lines = [
    "# 価格調整 作業チェックリスト（1 SKU）",
    "",
    `生成: ${new Date().toISOString()}`,
    "",
  ];

  for (const r of rows) {
    lines.push(`## ${r.sku}`);
    lines.push("");
    if (r.action === "skip") {
      lines.push(`- **スキップ**: ${r.reason}`);
      lines.push("");
      continue;
    }
    lines.push("### 1. eBay（UK）で最安を確認");
    lines.push("- [ ] セルスタ出品管理 → 右下チェックボックスで eBay 価格順を開く");
    lines.push("- [ ] **Ship to = United Kingdom** を確認");
    lines.push("- [ ] 並び: Price + Shipping lowest first");
    if (r.competitorItemUsd != null) {
      lines.push(
        `- [ ] 先頭商品ページ: 価格 **$${r.competitorItemUsd}** + 送料 **$${r.competitorShippingUsd}** = **$${r.competitorLowestTotalUsd}**`
      );
    } else {
      lines.push(
        `- [ ] 先頭商品ページで USD 合計を確認 → **$${r.competitorLowestTotalUsd}**（入力済み）`
      );
    }
    lines.push("");
    lines.push("### 2. セルスタ利益計算（UK 試算）");
    lines.push(`- [ ] **販売額($)**: **${r.proposedPriceUsd}**`);
    lines.push("- [ ] **送料($)**: **0**");
    lines.push("- [ ] **DDP対応関税率(%)**: **0**");
    lines.push(
      `- [ ] 利益率が **${r.profitCheckSellsta?.minMarginPercent ?? 1}% 以上**（還付金は見ない）→ セルスタ画面で確認`
    );
    lines.push("");
    lines.push("### 3. 出品画面で反映");
    lines.push(`- [ ] 販売額を **$${r.proposedPriceUsd}** に変更（現価 $${r.currentPriceUsd} → ${r.action}）`);
    if (r.shippingPolicyChange) {
      lines.push(
        `- [ ] **Shipping Policy を変更**: \`${r.currentShippingPolicy || "(未記録)"}\` → \`${r.proposedShippingPolicy}\``
      );
    } else {
      lines.push(`- [ ] Shipping Policy: \`${r.proposedShippingPolicy}\`（帯変更なしの想定）`);
    }
    lines.push("- [ ] **更新** をクリック");
    lines.push("- [ ] 利益計算に戻し **DDP=25** に戻す（送料$は0のまま）");
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function toCsv(rows) {
  const headers = [
    "sku",
    "action",
    "currentPriceUsd",
    "competitorLowestTotalUsd",
    "proposedPriceUsd",
    "currentShippingPolicy",
    "proposedShippingPolicy",
    "shippingPolicyChange",
    "reason",
  ];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [headers.join(",")]
      .concat(rows.map((r) => headers.map((h) => esc(r[h])).join(",")))
      .join("\n") + "\n"
  );
}

function main() {
  const inputPath =
    process.argv[2] || path.join(__dirname, "listings_input.json");
  if (!fs.existsSync(inputPath)) {
    console.error(`Missing ${inputPath}`);
    process.exit(1);
  }

  const payload = loadJson(inputPath);
  const listings = Array.isArray(payload) ? payload : payload.listings || [];
  const rulesPath = path.join(__dirname, "profit_rules.json");
  const sampleRules = path.join(__dirname, "profit_rules.sample.json");
  const rules = fs.existsSync(rulesPath)
    ? loadJson(rulesPath)
    : loadJson(sampleRules);

  const rows = proposeUkAll(listings, mergeRules(rules));
  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const mdPath = path.join(outDir, `uk_checklist_${stamp}.md`);
  const csvPath = path.join(outDir, `uk_proposals_${stamp}.csv`);
  fs.writeFileSync(mdPath, toMarkdown(rows), "utf8");
  fs.writeFileSync(csvPath, toCsv(rows), "utf8");

  console.log(`Wrote ${mdPath}`);
  console.log(`Wrote ${csvPath}`);
  console.log(
    "Actions:",
    rows.reduce((a, r) => {
      a[r.action] = (a[r.action] || 0) + 1;
      return a;
    }, {})
  );
}

main();
