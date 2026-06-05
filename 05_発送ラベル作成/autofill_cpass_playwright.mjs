import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const labelPath = path.join(baseDir, "label_input.json");
const selectorPath = path.join(baseDir, "playwright_selectors_cpass.sample.json");

function readJson(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`File not found: ${p}`);
  }
  let raw = fs.readFileSync(p, "utf8");
  raw = raw.replace(/^\uFEFF/, "");
  raw = raw.replace(/^[\u200B\u200C\u200D\u2060]+/, "");
  return JSON.parse(raw);
}

function pickSizePart(sizeCm, idx) {
  if (!sizeCm) return "";
  const parts = String(sizeCm).split(/x|×|\*/i).map((v) => v.trim());
  return parts[idx] || "";
}

async function waitEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`${message}\nEnterで続行: `);
  rl.close();
}

async function fillIfExists(page, selector, value) {
  if (!selector || value === undefined || value === null) return;
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return;
  await el.fill(String(value));
}

/** 全角数字を半角にしてから数字だけ抽出（HS用） */
function normalizeHsDigits(raw) {
  if (raw === undefined || raw === null) return "";
  let s = String(raw);
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  return s.replace(/\D/g, "");
}

async function clearAndFillIfExists(page, selector, value) {
  if (!selector || value === undefined || value === null) return;
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return;
  await el.clear();
  await el.fill(String(value));
}

async function clickIfExists(page, selector) {
  if (!selector) return;
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return;
  await el.click();
}

function parseMinJpy(text) {
  if (!text) return Number.POSITIVE_INFINITY;
  const normalized = String(text).replace(/,/g, "");
  const nums = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*JPY/gi)].map((m) => Number(m[1]));
  if (nums.length > 0) return Math.min(...nums);
  const generic = [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (generic.length > 0) return Math.min(...generic);
  return Number.POSITIVE_INFINITY;
}

/** 「選択」ボタンごとに祖先テキストを集め、正規表現に合う行だけクリック */
async function tryClickSelectButtonNearText(page, textRegex) {
  const buttons = page.getByRole("button", { name: /選択|Select/ });
  const n = await buttons.count();
  for (let i = 0; i < n; i += 1) {
    const btn = buttons.nth(i);
    const blob = await btn.evaluate((el) => {
      const parts = [];
      let w = el;
      for (let d = 0; d < 18 && w; d += 1) {
        parts.push((w.innerText || w.textContent || "").trim());
        w = w.parentElement;
      }
      return parts.join("\n");
    });
    if (textRegex.test(blob)) {
      await btn.click();
      return true;
    }
  }
  return false;
}

/** label の shippingService に合わせ、行テキストから「選択」を押す（判定失敗時のフォールバック） */
async function trySelectByShippingHint(page, shippingHintRaw) {
  const hint = String(shippingHintRaw || "").trim().toLowerCase();
  if (!hint || hint.includes("economy") || hint.includes("エコノミ")) return false;

  const tryClick = async (pattern) => {
    const row = page.locator("tr, li, article, section, div").filter({ hasText: pattern }).first();
    if ((await row.count()) === 0) return false;
    const btn = row.getByRole("button", { name: /選択|Select/ }).first();
    if ((await btn.count()) === 0) return false;
    await btn.click();
    return true;
  };

  if (hint.includes("dhl")) {
    if (await tryClick(/Ship via DHL/i)) {
      console.log("自動選択(ヒント): DHL 行の「選択」をクリック");
      return true;
    }
    if (await tryClick(/\bDHL\b/)) {
      console.log("自動選択(ヒント): DHL 行の「選択」をクリック");
      return true;
    }
    // 表記ゆれ・日本語UI: 祖先テキストに DHL が含まれる「選択」だけ押す
    if (await tryClickSelectButtonNearText(page, /\bDHL\b/i)) {
      console.log("自動選択(ヒント): 「選択」ボタン近傍テキストに DHL を検出してクリック");
      return true;
    }
  }

  if (hint.includes("fedex")) {
    if (hint.includes("priority") || hint.includes("プライオリティ")) {
      if (await tryClick(/International Priority/i)) {
        console.log("自動選択(ヒント): FedEx Priority 行の「選択」をクリック");
        return true;
      }
    } else if (hint.includes("connect") || hint.includes("コネクト")) {
      if (await tryClick(/International Connect Plus/i)) {
        console.log("自動選択(ヒント): FedEx Connect Plus 行の「選択」をクリック");
        return true;
      }
    } else {
      if (await tryClick(/International Connect Plus/i)) {
        console.log("自動選択(ヒント): FedEx Connect Plus 行の「選択」をクリック");
        return true;
      }
      if (await tryClick(/International Priority/i)) {
        console.log("自動選択(ヒント): FedEx Priority 行の「選択」をクリック");
        return true;
      }
    }
  }

  return false;
}

async function chooseCpassService(page, selectors, shippingServiceHint) {
  const service = selectors.services || {};
  const cardSelector = service.card || ".service-item, .service-card, li, .card";
  const nameSelector = service.name || "";
  const priceSelector = service.price || "";
  const selectButtonSelector = service.selectButton || 'button:has-text("選択"), button:has-text("Select")';

  const candidates = [];

  // A) まず cardSelector ベースで候補収集
  const cards = page.locator(cardSelector);
  const count = await cards.count();
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const whole = await card.innerText().catch(() => "");
    if (!whole) continue;
    const nameText = nameSelector ? await card.locator(nameSelector).first().innerText().catch(() => "") : whole;
    const priceText = priceSelector ? await card.locator(priceSelector).first().innerText().catch(() => "") : whole;
    const lower = `${whole}\n${nameText}`.toLowerCase();

    let type = "OTHER";
    if (lower.includes("speedpak economy") || lower.includes("economy") || lower.includes("エコノミ")) type = "ECONOMY";
    else if (lower.includes("fedex @international connect plus")) type = "FEDEX_CONNECT_PLUS";
    else if (lower.includes("fedex @international priority")) type = "FEDEX_PRIORITY";
    else if (lower.includes("ship via dhl") || (lower.includes("dhl") && (lower.includes("speedpak") || lower.includes("ebay"))))
      type = "DHL";

    candidates.push({ idx: i, type, priceMin: parseMinJpy(priceText), text: whole, mode: "card" });
  }

  // B) 既知サービスが取れていない場合、"選択" ボタンの親要素テキストから判定（フォールバック）
  const knownFromCards = candidates.some((c) => c.type !== "OTHER");
  if (!knownFromCards) {
    const buttons = page.locator(selectButtonSelector);
    const bcount = await buttons.count();
    for (let i = 0; i < bcount; i += 1) {
      const btn = buttons.nth(i);
      const parentText = await btn.evaluate((el) => {
        const p = el.closest("li, .card, .service-item, .service-card, div");
        return (p && p.textContent) ? p.textContent : (el.textContent || "");
      }).catch(() => "");
      if (!parentText) continue;
      const lower = parentText.toLowerCase();
      let type = "OTHER";
      if (lower.includes("speedpak economy") || lower.includes("economy") || lower.includes("エコノミ")) type = "ECONOMY";
      else if (lower.includes("fedex @international connect plus")) type = "FEDEX_CONNECT_PLUS";
      else if (lower.includes("fedex @international priority")) type = "FEDEX_PRIORITY";
      else if (lower.includes("ship via dhl") || (lower.includes("dhl") && (lower.includes("speedpak") || lower.includes("ebay"))))
        type = "DHL";

      candidates.push({
        idx: i,
        type,
        priceMin: parseMinJpy(parentText),
        text: parentText,
        mode: "button"
      });
    }
  }

  const hintLower = String(shippingServiceHint || "").toLowerCase();
  const forceExpress = hintLower.includes("dhl") || hintLower.includes("fedex");

  // 1) label が DHL/FedEx のときは Economy を選ばない（誤選択防止）
  // 2) それ以外で Economy があれば Economy 優先
  const economy = candidates.find((c) => c.type === "ECONOMY");
  let chosen = !forceExpress ? economy : undefined;

  // 3) Economy が無い／強制エクスプレスのときは最安値などから選ぶ
  if (!chosen) {
    const ranked = candidates
      .filter((c) => c.type !== "OTHER")
      .sort((a, b) => {
        if (a.priceMin !== b.priceMin) return a.priceMin - b.priceMin;
        const priority = {
          FEDEX_CONNECT_PLUS: 1,
          FEDEX_PRIORITY: 2,
          DHL: 3,
          OTHER: 99
        };
        return (priority[a.type] || 99) - (priority[b.type] || 99);
      });
    if (ranked.length > 0) chosen = ranked[0];
  }

  if (!chosen) {
    if (await trySelectByShippingHint(page, shippingServiceHint)) {
      return;
    }
    // 最終手段: 画面上の全「選択」から shippingService ヒントに合うものを探す
    if (hintLower.includes("dhl") && (await tryClickSelectButtonNearText(page, /\bDHL\b/i))) {
      console.log("自動選択(再試行): DHL の「選択」をクリック");
      return;
    }
    console.log("候補は見つかりましたが、既知サービスを判定できなかったため自動選択をスキップしました。");
    return;
  }

  if (chosen.mode === "button") {
    const buttons = page.locator(selectButtonSelector);
    const btn = buttons.nth(chosen.idx);
    if ((await btn.count()) === 0) {
      console.log(`選択ボタンが見つからないため自動選択をスキップ: ${chosen.type}`);
      return;
    }
    await btn.click();
  } else {
    const chosenCard = cards.nth(chosen.idx);
    const btn = chosenCard.locator(selectButtonSelector).first();
    if ((await btn.count()) === 0) {
      console.log(`選択ボタンが見つからないため自動選択をスキップ: ${chosen.type}`);
      return;
    }
    await btn.click();
  }
  console.log(`自動選択: ${chosen.type} / minJPY=${chosen.priceMin}`);
}

async function main() {
  const label = readJson(labelPath);
  const selectors = readJson(selectorPath);

  const browser = await chromium.launch({ headless: false, slowMo: 120 });
  const page = await browser.newPage();

  console.log("1) CPASS ログインページを開きます。");
  await page.goto(selectors.urls.login, { waitUntil: "domcontentloaded" });
  await waitEnter("手動でログインしてください。ログイン後、ラベル入力画面まで移動してから続行します。");

  if (selectors.urls.form) {
    console.log("2) ラベル入力ページへ移動します。");
    await page.goto(selectors.urls.form, { waitUntil: "domcontentloaded" });
  }

  // CPASS は「発送手続き待ち(/order/paid) -> 編集画面」の2段階がある
  // paid一覧ではアイテム選択のみ行い、編集画面で詳細入力を行う。
  if ((label.cpassStage || "").toLowerCase() === "paid_list") {
    console.log("3) 現在は発送手続き待ちフェーズです。対象アイテムを手動で選択し、編集画面へ進んでください。");
    await waitEnter("HS・重量・寸法を入力できる編集画面に来たら Enter（このあと CPASS どおり先に HS/重量/サイズを入れます）。");
  }

  // CPASS 実務順: 先に HS・重量・サイズ → その後に配送方法4択（スクリプトの入力順もこれに合わせる）
  const service = String(label.shippingService || "").trim().toLowerCase();
  const explicitCarrier = service.length > 0;
  const isEconomy =
    !explicitCarrier ||
    service.includes("economy") ||
    service.includes("speedpak economy");
  const hsRequired =
    explicitCarrier &&
    !isEconomy &&
    (service.includes("dhl") || service.includes("fedex") || label.hsCodeRequired === true);

  console.log("4) label_input.json の値を入力します（HS → 重量 → サイズ → その他の順）。");

  if (hsRequired) {
    const hs10 = normalizeHsDigits(label.hsCode);
    if (hs10.length !== 10) {
      console.log(
        `HSコードが10桁数字ではないため入力をスキップしました（DHL/FedEx）。label_input.json の hsCode=${JSON.stringify(label.hsCode)} → 抽出桁数=${hs10.length}`
      );
    } else if (!selectors.fields.hsCode) {
      console.log("selectors.fields.hsCode が未設定のため HS を入力できません。");
    } else {
      await clearAndFillIfExists(page, selectors.fields.hsCode, hs10);
      console.log(`HSコードを入力しました（10桁、入力前に欄をクリア済み）。`);
    }
  } else if (explicitCarrier && isEconomy && selectors.fields.hsCode) {
    await page.locator(selectors.fields.hsCode).first().clear().catch(() => {});
  }

  await fillIfExists(page, selectors.fields.weightGrams, label.weightGrams);
  await fillIfExists(page, selectors.fields.sizeCmL, pickSizePart(label.sizeCm, 0));
  await fillIfExists(page, selectors.fields.sizeCmW, pickSizePart(label.sizeCm, 1));
  await fillIfExists(page, selectors.fields.sizeCmH, pickSizePart(label.sizeCm, 2));

  await fillIfExists(page, selectors.fields.receiverName, label.buyerName);
  await fillIfExists(page, selectors.fields.postalCode, label.postalCode);
  await fillIfExists(page, selectors.fields.countryCode, label.countryCode);
  await fillIfExists(page, selectors.fields.stateOrProv, label.stateOrProv);
  await fillIfExists(page, selectors.fields.city, label.city);
  await fillIfExists(page, selectors.fields.addressLine1, label.addressLine1);
  await fillIfExists(page, selectors.fields.addressLine2, label.addressLine2);
  await fillIfExists(page, selectors.fields.phone, label.phone);
  await fillIfExists(page, selectors.fields.itemTitle, label.itemTitle);
  await fillIfExists(page, selectors.fields.quantity, label.quantity);
  await fillIfExists(page, selectors.fields.vatNumber, label.vatNumber);
  await fillIfExists(page, selectors.fields.iossNumber, label.iossNumber);
  await fillIfExists(page, selectors.fields.rutNumber, label.rutNumber);

  if (selectors.autoSelectService !== false) {
    console.log("5) 配送方法（4択）が表示されるまで進めてから Enter してください。");
    await waitEnter("HS・重量・寸法の入力が反映され、SpeedPAK の4択が見えたら続行します。");
    await chooseCpassService(page, selectors, label.shippingService);
  }

  // バッテリー情報
  if (label.hasBattery === true) {
    await clickIfExists(page, selectors.clicks.hasBatteryCheckbox);
    await fillIfExists(page, selectors.fields.batteryType, label.batteryType);
  }

  if (selectors.clicks.salesItemRadio) await clickIfExists(page, selectors.clicks.salesItemRadio);
  if (selectors.clicks.nonDangerousCheckbox) await clickIfExists(page, selectors.clicks.nonDangerousCheckbox);

  await page.screenshot({ path: path.join(baseDir, "autofill_cpass_preview.png"), fullPage: true });
  console.log("入力完了。スクリーンショット: autofill_cpass_preview.png");

  await waitEnter("内容確認後、必要なら手動で確定してください。自動で確定したい場合は selectors の submit を有効化してください。");
  if (selectors.clicks.submit) {
    await clickIfExists(page, selectors.clicks.submit);
    console.log("submit を実行しました。");
  }

  await waitEnter("終了する場合は Enter を押してください。");
  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
