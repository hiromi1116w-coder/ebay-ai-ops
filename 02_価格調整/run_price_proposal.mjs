import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { proposeAll } from "./lib/price_proposal.mjs";
import { mergeRules } from "./lib/profit_calc.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = [
    "sku",
    "sellstaId",
    "ebayItemId",
    "priority",
    "currentPriceUsd",
    "currentTotalUsd",
    "competitorLowestTotalUsd",
    "targetTotalUsd",
    "proposedPriceUsd",
    "proposedTotalUsd",
    "profitMarginPercent",
    "netProfitJpy",
    "approved_by_rule",
    "action",
    "reason",
  ];
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

function main() {
  const inputPath =
    process.argv[2] || path.join(__dirname, "listings_input.json");
  const rulesPath =
    process.argv[3] || path.join(__dirname, "profit_rules.json");

  if (!fs.existsSync(inputPath)) {
    console.error(
      `Input not found: ${inputPath}\nCopy sample_listing.json to listings_input.json and add your SKUs.`
    );
    process.exit(1);
  }

  const payload = loadJson(inputPath);
  const listings = Array.isArray(payload) ? payload : payload.listings || [];
  let rules = {};
  if (fs.existsSync(rulesPath)) {
    rules = loadJson(rulesPath);
  } else {
    const sampleRules = path.join(__dirname, "profit_rules.sample.json");
    if (fs.existsSync(sampleRules)) {
      rules = loadJson(sampleRules);
      console.warn(`Using ${sampleRules} (copy to profit_rules.json for production)`);
    }
  }

  const merged = mergeRules(rules);
  const proposals = proposeAll(listings, merged);

  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const csvPath = path.join(outDir, `price_proposals_${stamp}.csv`);
  fs.writeFileSync(csvPath, toCsv(proposals), "utf8");

  const summary = proposals.reduce((acc, p) => {
    acc[p.action] = (acc[p.action] || 0) + 1;
    return acc;
  }, {});

  console.log(`Wrote ${proposals.length} rows -> ${csvPath}`);
  console.log("Summary:", summary);
  console.log(
    "Rules: min margin",
    merged.minProfitMarginPercent + "%",
    "| undercut",
    merged.undercutUsd,
    "USD | fx",
    merged.fxUsdJpy
  );
}

main();
