import { mergeRules } from "./profit_calc.mjs";
import { cpassPolicyForPrice } from "./shipping_policy.mjs";

function roundUsd(n) {
  return Math.round(n * 100) / 100;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * UK 実務フロー: 競合 total（価格+送料 USD）の −0.01 をセルスタの販売額($) にそのまま載せる。
 * 利益 OK/NG はセルスタ利益計算で人が確認（送料$=0, DDP=0）。
 */
export function proposeUkSellsta(listing, rules = {}) {
  const r = mergeRules(rules);
  const sku = listing.sku || listing.sellstaId || listing.ebayItemId || "(unknown)";

  const required = ["currentPriceUsd", "competitorLowestTotalUsd"];
  const missing = required.filter((k) => listing[k] === undefined || listing[k] === "");
  if (missing.length) {
    return baseRow(listing, sku, {
      action: "skip",
      reason: `missing: ${missing.join(", ")}`,
    });
  }

  const current = roundUsd(listing.currentPriceUsd);
  const competitorTotal = roundUsd(listing.competitorLowestTotalUsd);
  const targetPrice = roundUsd(competitorTotal - r.undercutUsd);

  if (targetPrice < 0.99) {
    return baseRow(listing, sku, {
      action: "skip",
      reason: "target price below 0.99",
    });
  }

  const currentPolicy = listing.currentShippingPolicy || "";
  const nextPolicy = cpassPolicyForPrice(targetPrice);
  const policyChange =
    nextPolicy.ok &&
    cpassPolicyForPrice(current).label !== nextPolicy.label;

  let action = "hold";
  if (current > targetPrice + 0.001) action = "lower";
  else if (current < targetPrice - 0.001) action = "raise";

  const competitorItem = num(listing.competitorItemUsd);
  const competitorShip = num(listing.competitorShippingUsd);

  return {
    ...baseRow(listing, sku, {
      action,
      reason:
        action === "hold"
          ? "already at UK target (competitor total - 0.01)"
          : `UK target ${targetPrice} USD (competitor total ${competitorTotal} - ${r.undercutUsd})`,
    }),
    shipTo: "United Kingdom",
    competitorItemUsd: competitorItem || null,
    competitorShippingUsd: competitorShip || null,
    competitorLowestTotalUsd: competitorTotal,
    targetPriceUsd: targetPrice,
    proposedPriceUsd: targetPrice,
    currentShippingPolicy: currentPolicy,
    proposedShippingPolicy: nextPolicy.ok ? nextPolicy.label : "",
    shippingPolicyChange: policyChange,
    profitCheckSellsta: {
      sellingPriceUsd: targetPrice,
      shippingUsd: 0,
      ddpPercentForCheck: 0,
      ddpPercentAfterUpdate: 25,
      minMarginPercent: r.minProfitMarginPercent,
      note: "セルスタ利益計算で利益率を確認。OKなら出品画面へ→更新",
    },
  };
}

function baseRow(listing, sku, extra) {
  return {
    sku,
    sellstaId: listing.sellstaId ?? "",
    ebayItemId: listing.ebayItemId ?? "",
    priority: listing.priority ?? "normal",
    currentPriceUsd: listing.currentPriceUsd != null ? roundUsd(listing.currentPriceUsd) : null,
    proposedPriceUsd: extra.proposedPriceUsd ?? null,
    approved_by_rule: extra.action !== "skip",
    profitMarginPercent: null,
    ...extra,
  };
}

export function proposeUkAll(listings, rules = {}) {
  return (listings || []).map((row) => proposeUkSellsta(row, rules));
}
