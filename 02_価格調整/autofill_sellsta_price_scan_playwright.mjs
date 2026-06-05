/**
 * Phase 2 雛形：セルスタログイン後、eBay 競合画面から最安を取得する。
 * セレクタは playwright_selectors_sellsta.sample.json をコピーして実画面に合わせて更新すること。
 *
 * 実行例:
 *   node autofill_sellsta_price_scan_playwright.mjs
 *
 * Phase A: ログインは手動。headless=false 推奨。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELECTORS_FILE =
  process.env.SELLSTA_SELECTORS ||
  path.join(__dirname, "playwright_selectors_sellsta.json");
const SAMPLE_SELECTORS = path.join(
  __dirname,
  "playwright_selectors_sellsta.sample.json"
);

function loadSelectors() {
  const file = fs.existsSync(SELECTORS_FILE)
    ? SELECTORS_FILE
    : SAMPLE_SELECTORS;
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing selectors. Copy ${SAMPLE_SELECTORS} to playwright_selectors_sellsta.json`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const cfg = loadSelectors();
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Open Sellsta and log in manually, then press Enter in this terminal...");
  await page.goto(cfg.sellstaListUrl || "https://sellsta.biz/");
  await waitForEnter();

  const skus = (cfg.scanSkus || []).slice(0, cfg.maxSkusPerRun || 5);
  const results = [];

  for (const sku of skus) {
    console.log(`Scan: ${sku}`);
    // TODO: セルスタ一覧で SKU 行を開き、eBay リンクをクリック（cfg.selectors 参照）
    // TODO: eBay 側で最安 total を DOM または dump から取得
    results.push({
      sku,
      competitorLowestTotalUsd: null,
      status: "not_implemented",
      note: "Update selectors after run_dump on real pages",
    });
    await page.waitForTimeout(cfg.delayMsBetweenSkus || 4000);
  }

  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "competitor_scan_latest.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
  await browser.close();
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
