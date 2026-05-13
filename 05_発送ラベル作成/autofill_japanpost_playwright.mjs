import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseDir = path.dirname(fileURLToPath(import.meta.url));

function argPath(idx, envKey, defaultName) {
  const argv = process.argv.slice(2);
  if (argv[idx]) return path.isAbsolute(argv[idx]) ? argv[idx] : path.join(baseDir, argv[idx]);
  if (process.env[envKey]) {
    const p = process.env[envKey];
    return path.isAbsolute(p) ? p : path.join(baseDir, p);
  }
  return path.join(baseDir, defaultName);
}

const labelPath = argPath(0, "JP_LABEL_INPUT", "label_input.json");
const selectorPath = argPath(1, "JP_SELECTORS_JSON", "playwright_selectors_japanpost.sample.json");

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

/** 3辺の合計(cm)。郵便局の「90サイズ」判定の簡易版（実務では公式表に合わせて調整可） */
function sumSizeCm(sizeCm) {
  const parts = String(sizeCm || "")
    .split(/x|×|\*/i)
    .map((v) => parseFloat(String(v).trim()))
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (parts.length === 0) return 0;
  return parts.reduce((a, b) => a + b, 0);
}

/**
 * eパケットライト vs EMS（運用手順.md と同じルールの骨子）
 * - 重量 2kg 超 → EMS
 * - 3辺の合計 90cm 超 → EMS
 * - label.shippingService が明示されていればそれを優先（epacket / ems を含む文字列）
 */
function decideJapanPostService(label) {
  const hint = String(label.shippingService || "").toLowerCase();
  if (hint.includes("ems")) return "EMS";
  if (hint.includes("epacket") || hint.includes("e-packet") || hint.includes("epacketlite")) return "EPACKET_LITE";

  const wG = Number(label.weightGrams) || 0;
  const sumCm = sumSizeCm(label.sizeCm);
  if (wG <= 0 || sumCm <= 0) {
    return "UNKNOWN";
  }
  if (wG > 2000 || sumCm > 90) return "EMS";
  return "EPACKET_LITE";
}

async function waitEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`${message}\nEnterで続行: `);
  rl.close();
}

/** JSON の文字列を RegExp に（先頭/末尾/ で囲めば正規表現として解釈） */
function patternFromJsonEntry(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  if (t.startsWith("/") && t.lastIndexOf("/") > 0) {
    const end = t.lastIndexOf("/");
    return new RegExp(t.slice(1, end), t.slice(end + 1) || "i");
  }
  return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** セレクタが空 or 未マッチのとき、ラベル／ロール名で入力を試す */
const BUILTIN_LABEL_PATTERNS = {
  receiverName: [/お届け先.*氏名/i, /受取人/i, /宛名/i, /Recipient/i, /Addressee/i],
  postalCode: [/郵便番号/i, /ZIP/i, /Postal\s*code/i],
  countryCode: [/国\s*・\s*地域/i, /仕向国/i, /Country/i],
  stateOrProv: [/州\s*・\s*県/i, /State/i, /Province/i, /都道府県/i],
  city: [/市区町村/i, /City/i, /Town/i],
  addressLine1: [/住所\s*1/i, /番地/i, /Address\s*1/i, /Street/i],
  addressLine2: [/住所\s*2/i, /建物名/i, /Address\s*2/i, /Apartment/i],
  phone: [/電話/i, /TEL/i, /Phone/i],
  itemTitle: [/品名/i, /内容品/i, /商品名/i, /Description/i],
  itemOriginCountry: [/原産国/i, /Country of origin/i, /COO/i],
  unitPriceJpy: [/単価/i, /一個あたり/i, /価格/i, /Price/i, /Declared value/i],
  quantity: [/個数/i, /数量/i, /Quantity/i],
  hsCode: [/HS/i, /品目番号/i, /Tariff/i],
  weightGrams: [/重量/i, /Weight/i, /グラム/i, /g\)/i],
  sizeCmL: [/長さ/i, /縦/i, /Length/i, /奥行/i],
  sizeCmW: [/幅/i, /横/i, /Width/i],
  sizeCmH: [/高さ/i, /厚さ/i, /Height/i],
  vatNumber: [/VAT/i],
  iossNumber: [/IOSS/i],
  rutNumber: [/RUT/i, /税/i],
  taxCode: [/税コード/i, /Tax\s*code/i, /TAX\s*番号/i],
  referenceNumber: [/参照番号/i, /Reference/i],
  step4FlightWeightGrams: [/請求重量/i, /課税重量/i, /航空.*重量/i, /重量\s*\(g\)/i],
};

function mergeLabelPatterns(fieldKey, selectors) {
  const fromJson = selectors.fallbackLabels?.[fieldKey];
  const extra = Array.isArray(fromJson)
    ? fromJson.map(patternFromJsonEntry).filter(Boolean)
    : [];
  const builtin = BUILTIN_LABEL_PATTERNS[fieldKey] || [];
  return [...extra, ...builtin];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** メインページか、input が多い子 iframe を入力のルートとして選ぶ */
async function pickFillRoot(page) {
  async function countEditable(ctx) {
    try {
      return await ctx.locator("input, textarea").count();
    } catch {
      return 0;
    }
  }
  let best = page;
  let bestN = await countEditable(page);
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const n = await countEditable(frame);
      if (n > bestN) {
        bestN = n;
        best = frame;
      }
    } catch {
      /* ignore */
    }
  }
  if (best !== page) {
    console.log(`入力ルート: 子 iframe（input/textarea 数=${bestN}）。メインでは見つからない場合に有効。`);
  } else {
    console.log(`入力ルート: メインフレーム（input/textarea 数=${bestN}）。`);
  }
  return best;
}

function wizardClickFallbackEnabled() {
  return String(process.env.JP_WIZARD_CLICK_FALLBACK || "").toLowerCase() === "1";
}

/** JP_WIZARD_CLICK_FALLBACK=1 のとき、セレクタ未設定の clickAfter などで試す（誤クリック防止のため既定オフ） */
const WIZARD_CLICK_FALLBACK_PATTERNS = {
  step3Next: [/次へ/, /次のステップ/, /進む/, /続ける/],
  confirmNext: [/次へ/, /確認へ/, /確認画面/],
  step4WizardNext: [/次へ/, /進む/],
  step4ExpandOtherShippingInfo: [/その他.*情報/, /発送.*その他/, /詳細を表示/, /追加情報/, /開く/],
  step5ContentConfirm: [/内容.{0,6}確認/, /内容確認/, /確認して/, /入力内容の確認/],
};

/**
 * @param {import('playwright').Frame | import('playwright').Page} root
 * @param {string} clickKey selectors.clicks のキー名
 */
async function tryWizardClickFallback(root, clickKey) {
  const patterns = WIZARD_CLICK_FALLBACK_PATTERNS[clickKey];
  if (!patterns || !wizardClickFallbackEnabled()) return false;
  const timeout = 3500;
  const tryOnce = async (locator) => {
    if ((await locator.count()) === 0) return false;
    try {
      await locator.first().click({ timeout });
      return true;
    } catch {
      return false;
    }
  };
  for (const re of patterns) {
    if (await tryOnce(root.getByRole("button", { name: re }))) return true;
    if (await tryOnce(root.getByRole("link", { name: re }))) return true;
  }
  return false;
}

/**
 * 全フレームの input/textarea/select と、ウィザードで使う button/link を列挙（format 2）。
 * Step3〜5 の画面まで進んでから JP_DUMP_INPUTS=1 を実行すると clicks.* に転記しやすい。
 */
async function dumpInputSnapshot(page, outPath) {
  try {
    const frames = page.frames();
    const payload = {
      format: 2,
      dumpedAt: new Date().toISOString(),
      frames: [],
    };
    for (const frame of frames) {
      let frameUrl = "";
      try {
        frameUrl = frame.url();
      } catch {
        frameUrl = "";
      }
      try {
        const data = await frame.evaluate(() => {
          function snapInputs() {
            const els = [...document.querySelectorAll("input, textarea, select")];
            return els.map((el, i) => ({
              i,
              tag: el.tagName,
              type: el.type || "",
              name: el.name || "",
              id: el.id || "",
              placeholder: el.placeholder || "",
              ariaLabel: el.getAttribute("aria-label") || "",
              className: typeof el.className === "string" ? el.className.slice(0, 160) : "",
            }));
          }
          function snapButtons() {
            const els = [
              ...document.querySelectorAll(
                'button, input[type="submit"], input[type="button"], input[type="reset"], a[href], [role="button"]'
              ),
            ];
            return els.map((el, i) => {
              const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
              const value =
                el.tagName === "INPUT" && "value" in el ? String(el.value || "").trim().slice(0, 120) : "";
              const labelText = text || value;
              return {
                i,
                tag: el.tagName,
                type: el.type || "",
                id: el.id || "",
                name: el.name || "",
                text: labelText,
                value,
                ariaLabel: el.getAttribute("aria-label") || "",
                className: typeof el.className === "string" ? el.className.slice(0, 160) : "",
                href: el.tagName === "A" ? (el.getAttribute("href") || "").slice(0, 120) : "",
              };
            });
          }
          return { inputs: snapInputs(), buttons: snapButtons() };
        });
        payload.frames.push({ frameUrl, ...data });
      } catch (e) {
        payload.frames.push({ frameUrl, error: String(e?.message || e) });
      }
    }
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(
      `JP_DUMP_INPUTS=1 → DOM スナップショット（format=${payload.format}, ${payload.frames.length} frames）: ${outPath}`
    );
    console.log("ヒント: frames[].buttons の text / id を selectors.clicks（step3Next, step5ContentConfirm 等）に転記。");
  } catch (e) {
    console.warn("DOM スナップショット出力に失敗:", e.message);
  }
}

async function logFormDiagnostics(page) {
  const url = page.url();
  let title = "";
  try {
    title = await page.title();
  } catch {
    /* */
  }
  let tb = 0;
  let visIn = 0;
  try {
    tb = await page.getByRole("textbox").count();
  } catch {
    /* */
  }
  try {
    visIn = await page.locator("input:visible, textarea:visible").count();
  } catch {
    /* */
  }
  console.log(`診断: URL=${url}`);
  console.log(`診断: title=${title}`);
  console.log(`診断: メインフレーム textbox 数=${tb}, 可視 input/textarea 数=${visIn}`);
}

function countryTryValues(code, label, selectors) {
  const raw = String(code || "").trim();
  const list = [];
  if (label?.countrySelectLabel) list.push(String(label.countrySelectLabel).trim());
  if (raw) list.push(raw);
  const mapped = selectors.countryOptionLabels?.[raw];
  if (Array.isArray(mapped)) list.push(...mapped.map((x) => String(x).trim()));
  else if (mapped != null && mapped !== "") list.push(String(mapped).trim());
  return [...new Set(list.filter(Boolean))];
}

/**
 * @returns {Promise<boolean>} 成功したら true
 */
async function selectOrFillControl(locator, fieldKey, strVal, timeout, clear, selectors, label) {
  const tagName = await locator.evaluate((n) => n.tagName).catch(() => "");
  if (tagName === "SELECT") {
    if (fieldKey === "countryCode") {
      const tries = countryTryValues(strVal, label, selectors);
      for (const t of tries) {
        try {
          await locator.selectOption(t, { timeout });
          return true;
        } catch {
          /* next */
        }
        try {
          await locator.selectOption({ label: t }, { timeout });
          return true;
        } catch {
          /* next */
        }
      }
      return false;
    }
    try {
      await locator.selectOption(strVal, { timeout });
      return true;
    } catch {
      try {
        await locator.selectOption({ label: strVal }, { timeout });
        return true;
      } catch {
        return false;
      }
    }
  }
  try {
    if (clear) await locator.clear({ timeout });
    await locator.fill(strVal, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function fillSmart(root, fieldKey, selector, value, selectors, { clear = false, label = null } = {}) {
  if (value === undefined || value === null) return { field: fieldKey, ok: false, how: "empty" };
  const str = String(value).trim();
  if (str === "" && fieldKey !== "hsCode") return { field: fieldKey, ok: false, how: "empty" };

  const strVal = fieldKey === "hsCode" && value ? String(value).replace(/\s/g, "") : String(value);
  const timeout = 4000;

  if (selector) {
    const el = root.locator(selector).first();
    if ((await el.count()) > 0) {
      try {
        const ok = await selectOrFillControl(el, fieldKey, strVal, timeout, clear, selectors, label);
        if (ok) {
          const tagName = await el.evaluate((n) => n.tagName).catch(() => "");
          const how = tagName === "SELECT" ? "selector-select" : "selector";
          return { field: fieldKey, ok: true, how };
        }
      } catch {
        /* fall through */
      }
    }
  }

  if (String(process.env.JP_NO_LABEL_FALLBACK || "").toLowerCase() === "1") {
    return { field: fieldKey, ok: false, how: "miss" };
  }

  const patterns = mergeLabelPatterns(fieldKey, selectors);
  const roles =
    fieldKey === "quantity" || fieldKey === "weightGrams"
      ? ["spinbutton", "textbox"]
      : ["textbox", "spinbutton"];

  for (const re of patterns) {
    const byLabel = root.getByLabel(re, { exact: false }).first();
    if ((await byLabel.count()) > 0) {
      try {
        const ok = await selectOrFillControl(byLabel, fieldKey, strVal, timeout, clear, selectors, label);
        if (ok) {
          const tagName = await byLabel.evaluate((n) => n.tagName).catch(() => "");
          const how = tagName === "SELECT" ? "getByLabel-select" : "getByLabel";
          return { field: fieldKey, ok: true, how, re: String(re) };
        }
      } catch {
        /* next */
      }
    }
  }

  for (const re of patterns) {
    for (const role of roles) {
      const loc = root.getByRole(role, { name: re }).first();
      if ((await loc.count()) === 0) continue;
      try {
        const ok = await selectOrFillControl(loc, fieldKey, strVal, timeout, clear, selectors, label);
        if (ok) {
          const tagName = await loc.evaluate((n) => n.tagName).catch(() => "");
          const how = tagName === "SELECT" ? `getByRole:${role}-select` : `getByRole:${role}`;
          return { field: fieldKey, ok: true, how, re: String(re) };
        }
      } catch {
        /* next */
      }
    }
  }

  return { field: fieldKey, ok: false, how: "miss" };
}

async function clickIfExists(root, selector) {
  if (!selector) return false;
  const el = root.locator(selector).first();
  if ((await el.count()) === 0) return false;
  await el.click();
  return true;
}

/** 同意・確認用チェックボックスをオンにする（未チェックのときだけ check） */
async function ensureCheckboxChecked(root, selector) {
  if (!selector) return false;
  const el = root.locator(selector).first();
  if ((await el.count()) === 0) return false;
  try {
    await el.check({ timeout: 4000 });
    return true;
  } catch {
    try {
      await el.click({ timeout: 4000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * fillPhases の各要素に clickAfter: "step3Next" または ["step3Next","confirmNext"] を書ける。
 * 値は selectors.clicks のキー名（そのキーに CSS セレクタが入っていること）。
 */
async function runPhaseClickAfter(fillRoot, selectors, step) {
  const raw = step.clickAfter;
  if (raw == null) return;
  const keys = Array.isArray(raw) ? raw : [raw];
  const c = selectors.clicks || {};
  for (const key of keys) {
    if (typeof key !== "string" || !key.trim()) continue;
    const k = key.trim();
    const sel = c[k];
    let clicked = false;
    let viaFallback = false;
    if (sel && String(sel).trim()) clicked = await clickIfExists(fillRoot, sel);
    if (!clicked) {
      viaFallback = await tryWizardClickFallback(fillRoot, k);
      clicked = viaFallback;
    }
    if (clicked && viaFallback) console.log(`clickAfter ${k}: テキストフォールバックでクリック（JP_WIZARD_CLICK_FALLBACK=1）`);
  }
}

/**
 * セレクタ未設定時のフォールバック: 画面上のラベル／ラジオから配送サービスを選ぶ。
 * DOM が想定と違う場合は失敗してよい（手動選択に任せる）。
 */
async function trySelectJapanPostServiceByText(root, svc) {
  const timeout = 2500;
  const tryClick = async (locator) => {
    if ((await locator.count()) === 0) return false;
    try {
      await locator.first().click({ timeout });
      return true;
    } catch {
      return false;
    }
  };

  if (svc === "EMS") {
    const patterns = [/EMS/i, /ＥＭＳ/];
    for (const re of patterns) {
      if (await tryClick(root.getByRole("radio", { name: re }))) return true;
      if (await tryClick(root.locator("label").filter({ hasText: re }).first())) return true;
      const row = root.locator("tr, li, div[role='row']").filter({ hasText: re }).first();
      if ((await row.count()) > 0) {
        const radio = row.locator('input[type="radio"]').first();
        if (await tryClick(radio)) return true;
      }
    }
    return false;
  }

  if (svc === "EPACKET_LITE") {
    const patterns = [/国際\s*eパケット\s*ライト/i, /eパケット\s*ライト/i, /エパケット\s*ライト/i];
    for (const re of patterns) {
      if (await tryClick(root.getByRole("radio", { name: re }))) return true;
      if (await tryClick(root.locator("label").filter({ hasText: re }).first())) return true;
      const row = root.locator("tr, li, div[role='row']").filter({ hasText: re }).first();
      if ((await row.count()) > 0) {
        const radio = row.locator('input[type="radio"]').first();
        if (await tryClick(radio)) return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * @param {(key: string, sel: string, val: unknown, opts?: object) => Promise<void>} track
 */
async function fillRecipientTracks(track, label, selectors, addr1, addr2) {
  await track("receiverName", selectors.fields.receiverName, label.buyerName);
  await track("postalCode", selectors.fields.postalCode, label.postalCode);
  await track("countryCode", selectors.fields.countryCode, label.countryCode);
  await track("stateOrProv", selectors.fields.stateOrProv, label.stateOrProv);
  if (selectors.fields.city && String(selectors.fields.city).trim()) {
    await track("city", selectors.fields.city, label.city);
  }
  const citySel = selectors.fields.city && String(selectors.fields.city).trim();
  let addrForBox = addr1;
  if (!citySel && label.city && String(label.city).trim()) {
    addrForBox = [addr1, label.city].filter((x) => String(x || "").trim()).join("\n");
  }
  await track("addressLine1", selectors.fields.addressLine1, addrForBox);
  await track("addressLine2", selectors.fields.addressLine2, addr2);
  await track("phone", selectors.fields.phone, label.phone);
}

/**
 * 国際マイページ Step3（発送種別→内容品種別「販売品」→内容品行→品目入力→意見確認チェック→次へ）に合わせた入力順。
 * セレクタが空のステップはスキップ。実DOMに合わせて playwright_selectors_japanpost.sample.json の clicks / fields を埋める。
 * 画面遷移の「次へ」は fillPhases の clickAfter（例: ["step3Next"]）で selectors.clicks に記載する。
 *
 * @param {(key: string, sel: string, val: unknown, opts?: object) => Promise<void>} track
 */
async function fillItemTracks(track, label, selectors, sizeParts, fillRoot) {
  const c = selectors.clicks || {};
  const f = selectors.fields || {};
  const shipSvc = decideJapanPostService(label);

  if (c.step3ShippingEMS && shipSvc === "EMS") {
    await clickIfExists(fillRoot, c.step3ShippingEMS);
  } else if (c.step3ShippingEpacketLite && shipSvc === "EPACKET_LITE") {
    await clickIfExists(fillRoot, c.step3ShippingEpacketLite);
  }

  const shipSel = f.step3ShipmentTypeSelect && String(f.step3ShipmentTypeSelect).trim();
  if (shipSel) {
    let opt = (label.jpShipmentSelectValue && String(label.jpShipmentSelectValue).trim()) || "";
    if (!opt && String(label.shippingService || "").trim()) opt = String(label.shippingService).trim();
    if (!opt && shipSvc === "EMS") opt = "EMS";
    if (opt) {
      await track("step3ShipmentTypeSelect", shipSel, opt);
    }
  }

  if (c.step3CategorySales) await clickIfExists(fillRoot, c.step3CategorySales);
  if (c.step3ContentLine) await clickIfExists(fillRoot, c.step3ContentLine);

  await track("itemTitle", f.itemTitle, label.itemTitle);
  await track(
    "itemOriginCountry",
    f.itemOriginCountry,
    label.originCountryCode || label.countryOfOrigin || ""
  );
  await track("weightGrams", f.weightGrams, label.weightGrams);
  if (label.hsCode) {
    await track("hsCode", f.hsCode, String(label.hsCode).replace(/\s/g, ""), { clear: true });
  }
  await track("unitPriceJpy", f.unitPriceJpy, label.unitPriceJpy);
  await track("quantity", f.quantity, label.quantity);

  await track("sizeCmL", f.sizeCmL, sizeParts[0]);
  await track("sizeCmW", f.sizeCmW, sizeParts[1]);
  await track("sizeCmH", f.sizeCmH, sizeParts[2]);
  await track("vatNumber", f.vatNumber, label.vatNumber);
  await track("iossNumber", f.iossNumber, label.iossNumber);
  await track("rutNumber", f.rutNumber, label.rutNumber);

  if (c.step3OpinionConfirm) await clickIfExists(fillRoot, c.step3OpinionConfirm);
}

async function fillConfirmTracks(track, label, selectors, sizeParts) {
  await track("weightGrams", selectors.fields.weightGrams, label.weightGrams);
  await track("sizeCmL", selectors.fields.sizeCmL, sizeParts[0]);
  await track("sizeCmW", selectors.fields.sizeCmW, sizeParts[1]);
  await track("sizeCmH", selectors.fields.sizeCmH, sizeParts[2]);
  await track("vatNumber", selectors.fields.vatNumber, label.vatNumber);
  await track("iossNumber", selectors.fields.iossNumber, label.iossNumber);
  await track("rutNumber", selectors.fields.rutNumber, label.rutNumber);
}

/** マイページ Step4: 請求／航空重量(g) → 同意チェック → 発送のその他情報を開く → 税コード・VAT・参照番号など */
async function fillStep4ExtrasTracks(track, label, selectors, fillRoot) {
  const f = selectors.fields;
  const c = selectors.clicks;
  const step4Weight =
    label.step4FlightWeightGrams ?? label.billableWeightGrams ?? label.weightGrams ?? "";
  await track("step4FlightWeightGrams", f.step4FlightWeightGrams, step4Weight);

  if (c.step4AgreementCheckbox) await ensureCheckboxChecked(fillRoot, c.step4AgreementCheckbox);
  let expanded = false;
  if (c.step4ExpandOtherShippingInfo && String(c.step4ExpandOtherShippingInfo).trim()) {
    expanded = await clickIfExists(fillRoot, c.step4ExpandOtherShippingInfo);
  }
  if (!expanded) await tryWizardClickFallback(fillRoot, "step4ExpandOtherShippingInfo");

  await track("taxCode", f.taxCode, label.taxCode);
  await track("vatNumber", f.vatNumber, label.vatNumber);
  await track("iossNumber", f.iossNumber, label.iossNumber);
  await track("rutNumber", f.rutNumber, label.rutNumber);
  await track("referenceNumber", f.referenceNumber, label.referenceNumber);
}

/** マイページ Step5: 内容確認（確定前の最終ボタン） */
async function clickStep5ContentConfirm(fillRoot, selectors) {
  const c = selectors.clicks;
  if (c.step5ContentConfirm && String(c.step5ContentConfirm).trim()) {
    if (await clickIfExists(fillRoot, c.step5ContentConfirm)) return true;
  }
  return await tryWizardClickFallback(fillRoot, "step5ContentConfirm");
}

async function main() {
  const label = readJson(labelPath);
  const selectors = readJson(selectorPath);
  selectors.urls = selectors.urls || {};
  selectors.fields = selectors.fields || {};
  selectors.clicks = selectors.clicks || {};
  selectors.fallbackLabels = selectors.fallbackLabels || {};

  console.log(`label_input: ${labelPath}`);
  console.log(`selectors:   ${selectorPath}`);

  const carrier = String(label.carrier || "JapanPost");
  if (carrier.toLowerCase() === "cpass") {
    console.warn("注意: label_input.json の carrier が CPASS です。郵便局用なら carrier を JapanPost にしてください。");
  }

  const slowMo = Number(process.env.JP_SLOW_MO || 120);
  const headless = String(process.env.JP_HEADLESS || "").toLowerCase() === "1";
  const noServiceText = String(process.env.JP_NO_SERVICE_TEXT || "").toLowerCase() === "1";

  const authPath = path.join(baseDir, "japanpost_auth.json");
  const cdpUrl = String(process.env.JP_CONNECT_CDP || "").trim();
  const persistentDir = String(process.env.JP_USER_DATA_DIR || "").trim();
  const useAuthFile =
    fs.existsSync(authPath) && String(process.env.JP_IGNORE_AUTH || "").toLowerCase() !== "1";

  /** @type {import('playwright').Browser | null} */
  let browser = null;
  /** @type {import('playwright').BrowserContext} */
  let context;
  /** @type {import('playwright').Page} */
  let page;

  if (cdpUrl) {
    browser = await chromium.connectOverCDP(cdpUrl);
    const contexts = browser.contexts();
    context = contexts[0] || (await browser.newContext());
    const pages = context.pages();
    page =
      pages.find((p) => {
        try {
          const u = p.url();
          return u && !u.startsWith("about:") && !u.startsWith("chrome://");
        } catch {
          return false;
        }
      }) ||
      pages[0] ||
      (await context.newPage());
    console.log("JP_CONNECT_CDP: 起動済み Chrome に接続（新しい Chromium の起動をスキップ）。");
  } else if (persistentDir) {
    context = await chromium.launchPersistentContext(persistentDir, {
      headless,
      slowMo,
      channel: process.env.JP_CHROME_CHANNEL?.trim() || undefined,
    });
    const pages = context.pages();
    page = pages[0] || (await context.newPage());
    console.log(`JP_USER_DATA_DIR: 永続プロファイル ${persistentDir}（Cookie が残りやすい）。`);
  } else {
    browser = await chromium.launch({ headless, slowMo });
    context = await browser.newContext(useAuthFile ? { storageState: authPath } : {});
    page = await context.newPage();
    if (useAuthFile) {
      console.log(`ログイン状態を読み込み: ${authPath}（使わないときは JP_IGNORE_AUTH=1）`);
    }
  }

  const skipFormGoto = String(process.env.JP_SKIP_FORM_GOTO || "").toLowerCase() === "1";
  const formUrlRaw = selectors.urls?.form;
  const formUrl = formUrlRaw && String(formUrlRaw).trim() ? String(formUrlRaw).trim() : "";
  const useFormGoto = Boolean(formUrl) && !skipFormGoto;

  console.log("1) 国際マイページ（ログイン）を開きます。");
  await page.goto(selectors.urls.login, { waitUntil: "domcontentloaded" });

  if (useFormGoto) {
    await waitEnter(
      "【ステップA】ブラウザでログインしてください。\nログインできたら Enter（このあと指定 URL に自動で移動します）。"
    );
    console.log("2) ラベル入力ページへ自動移動します。");
    await page.goto(formUrl, { waitUntil: "domcontentloaded" });
    await sleep(2500);
    await logFormDiagnostics(page);
    await waitEnter(
      "【ステップB】これから自動入力します。\n宛先氏名・品名・重量などの入力欄がこの画面に見えているか確認してください。\n会員情報やメニューだけの画面なら、ブラウザでラベル入力フォームまで進んでから Enter。"
    );
  } else {
    if (formUrl && skipFormGoto) {
      console.log("（JP_SKIP_FORM_GOTO=1 のため urls.form への自動遷移をスキップしました。）");
    }
    await waitEnter(
      "【一度だけ】ログインし、国際ラベル作成で宛先・品名・重量などを入れる「入力フォーム」までブラウザで進めてください。\n" +
        "マイページのトップや会員情報だけの画面のまま Enter しないでください。\n" +
        "入力欄が見えた状態で Enter（urls.form が空のときはこの手順。URL 自動遷移を使う場合は selectors の urls.form を設定し JP_SKIP_FORM_GOTO は外す）。"
    );
  }

  let fillRoot = await pickFillRoot(page);

  if (String(process.env.JP_SAVE_AUTH || "").toLowerCase() === "1" && !cdpUrl) {
    await context.storageState({ path: authPath });
    console.log(`JP_SAVE_AUTH=1 → ${authPath} に Cookie を保存しました。次回から自動読込。`);
  }

  if (String(process.env.JP_DUMP_INPUTS || "").toLowerCase() === "1") {
    await dumpInputSnapshot(page, path.join(baseDir, "jp_form_fields_snapshot.json"));
  }

  const svc = decideJapanPostService(label);
  console.log(`3) 推奨サービス（重量・寸法から）: ${svc}（手動で変えてもよい）`);

  console.log("4) label_input.json の値を入力します。fillPhases ありなら画面ごとに Enter で区切ります。");

  const fillResults = [];
  const track = async (key, sel, val, opts) => {
    const r = await fillSmart(fillRoot, key, sel, val, selectors, { ...(opts || {}), label });
    fillResults.push(r);
    return r;
  };

  const forceSeparate = String(process.env.JP_SEPARATE_ADDRESS || "").toLowerCase() === "1";
  const mergeAddress =
    !forceSeparate &&
    (selectors.mergeAddressLines === undefined ? true : selectors.mergeAddressLines === true);
  let addr1 = label.addressLine1;
  let addr2 = label.addressLine2;
  if (mergeAddress) {
    const parts = [label.addressLine1, label.addressLine2]
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      addr1 = parts.join(", ");
      addr2 = "";
      console.log("住所: addressLine1+2 を1欄にまとめて入力します（二段フォームは mergeAddressLines:false または JP_SEPARATE_ADDRESS=1）。");
    }
  }

  const sizeParts = [pickSizePart(label.sizeCm, 0), pickSizePart(label.sizeCm, 1), pickSizePart(label.sizeCm, 2)];

  const baseFields = { ...selectors.fields };

  const phases =
    Array.isArray(selectors.fillPhases) && selectors.fillPhases.length > 0
      ? selectors.fillPhases
      : [{ mode: "all" }];

  for (let pi = 0; pi < phases.length; pi++) {
    const step = phases[pi];
    const overrides =
      step.fieldOverrides && typeof step.fieldOverrides === "object" && !Array.isArray(step.fieldOverrides)
        ? step.fieldOverrides
        : {};
    selectors.fields = { ...baseFields, ...overrides };

    const mode = String(step.mode || "all").toLowerCase();
    if (pi > 0) {
      const msg =
        typeof step.prompt === "string" && step.prompt.trim()
          ? step.prompt.trim()
          : "ブラウザで「次へ」などを押し、次の入力画面を表示してから Enter。";
      await waitEnter(msg);
      fillRoot = await pickFillRoot(page);
    }
    if (mode === "recipient" || mode === "all") {
      await fillRecipientTracks(track, label, selectors, addr1, addr2);
    }
    if (mode === "item" || mode === "all") {
      await fillItemTracks(track, label, selectors, sizeParts, fillRoot);
    }
    if (mode === "confirm") {
      await fillConfirmTracks(track, label, selectors, sizeParts);
    }
    if (mode === "step4extras") {
      await fillStep4ExtrasTracks(track, label, selectors, fillRoot);
    }
    if (mode === "step5confirm") {
      await clickStep5ContentConfirm(fillRoot, selectors);
    }
    await runPhaseClickAfter(fillRoot, selectors, step);
    const knownPhase = new Set(["recipient", "item", "all", "confirm", "step4extras", "step5confirm"]);
    if (!knownPhase.has(mode)) {
      console.warn(
        `fillPhases[${pi}].mode が不明 (${mode}) — recipient / item / confirm / step4extras / step5confirm / all のいずれかにしてください。`
      );
    }
  }

  selectors.fields = baseFields;
  const okCount = fillResults.filter((r) => r.ok).length;
  const missFields = fillResults.filter((r) => !r.ok && r.how === "miss").map((r) => r.field);
  const labelHits = fillResults.filter((r) => r.ok && r.how !== "selector");

  if (String(process.env.JP_NO_LOG || "").toLowerCase() !== "1") {
    const logPath = path.join(baseDir, "jp_autofill_run_log.jsonl");
    const logLine =
      JSON.stringify({
        ts: new Date().toISOString(),
        orderId: label.orderId || "",
        carrier: label.carrier || "",
        serviceHint: svc,
        ok: okCount,
        total: fillResults.length,
        miss: missFields,
      }) + "\n";
    fs.appendFileSync(logPath, logLine, "utf8");
    console.log(`実行ログ追記: ${logPath}（止める: JP_NO_LOG=1）`);
  }

  console.log(`入力サマリ: 成功 ${okCount}/${fillResults.length} 件`);
  if (missFields.length) console.log("セレクタ・ラベルとも未ヒット:", missFields.join(", "));
  if (labelHits.length) console.log("ラベル／ロール推測で入力:", labelHits.map((h) => `${h.field}(${h.how})`).join(", "));
  if (String(process.env.JP_VERBOSE || "").toLowerCase() === "1") {
    console.log(JSON.stringify(fillResults, null, 2));
  }

  if (selectors.clicks.salesItemRadio) await clickIfExists(fillRoot, selectors.clicks.salesItemRadio);
  if (selectors.clicks.nonDangerousCheckbox) await clickIfExists(fillRoot, selectors.clicks.nonDangerousCheckbox);

  if (svc === "UNKNOWN") {
    console.log("重量またはサイズが未入力のため、eパケット/EMS の自動判定をスキップしました。画面で手動選択してください。");
  } else {
    let clicked = false;
    if (svc === "EPACKET_LITE" && selectors.clicks?.serviceEpacketLite) {
      clicked = await clickIfExists(fillRoot, selectors.clicks.serviceEpacketLite);
      if (clicked) console.log("eパケットライトをクリックしました（セレクタ）。");
    } else if (svc === "EMS" && selectors.clicks?.serviceEMS) {
      clicked = await clickIfExists(fillRoot, selectors.clicks.serviceEMS);
      if (clicked) console.log("EMS をクリックしました（セレクタ）。");
    }
    if (!clicked && !noServiceText && (svc === "EPACKET_LITE" || svc === "EMS")) {
      const byText = await trySelectJapanPostServiceByText(fillRoot, svc);
      if (byText) {
        console.log(`サービスをテキスト一致でクリックしました（${svc}）。`);
        clicked = true;
      }
    }
    if (!clicked && svc !== "UNKNOWN") {
      console.log(
        `サービス自動クリックは未実施。推奨: ${svc}（セレクタ設定 or 画面テキスト一致）。手動で選ぶか、JP_NO_SERVICE_TEXT=1 でテキスト推測を無効化できます。`
      );
    }
  }

  await page.screenshot({ path: path.join(baseDir, "autofill_japanpost_preview.png"), fullPage: true });
  console.log("入力完了。スクリーンショット: autofill_japanpost_preview.png");

  await waitEnter(
    "内容確認後、必要なら手動で確定してください。\n（このメッセージは PowerShell に貼らず、表示を読んだうえで Enter のみ押してください。submit を selectors に書くと自動クリックできます。）"
  );
  if (selectors.clicks.submit) {
    await clickIfExists(fillRoot, selectors.clicks.submit);
    console.log("submit を実行しました。");
  }

  await waitEnter("ブラウザを閉じて終了する場合は Enter（説明文は貼らないでください）。");
  if (persistentDir && !browser) {
    await context.close();
  } else if (browser) {
    await browser.close();
  } else {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  try {
    if (String(process.env.JP_NO_LOG || "").toLowerCase() !== "1") {
      const logPath = path.join(baseDir, "jp_autofill_run_log.jsonl");
      const line =
        JSON.stringify({
          ts: new Date().toISOString(),
          error: true,
          message: String(err.message || err),
        }) + "\n";
      fs.appendFileSync(logPath, line, "utf8");
      console.error(`実行ログに error 行を追記: ${logPath}`);
    }
  } catch {
    /* ignore */
  }
  process.exit(1);
});
