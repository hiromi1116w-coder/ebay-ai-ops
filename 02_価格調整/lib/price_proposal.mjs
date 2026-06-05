import { calcProfit, mergeRules, totalUsd } from "./profit_calc.mjs";

function roundUsd(n) {
  return Math.round(n * 100) / 100;
}

/**
 * 利益率が min を満たす最大の商品価格（USD）を二分探索で求める（粗い floor）。
 */
function findFloorItemPrice(listing, rules) {
  const r = mergeRules(rules);
  const shipping = Number(listing.shippingChargedUsd) || 0;
  let lo = 0.99;
  let hi = Math.max(
    Number(listing.currentPriceUsd) || 1,
    Number(listing.competitorLowestTotalUsd) || 1,
    500
  );

  if (!calcProfit(listing, lo, r).meetsMinMargin) {
    return null;
  }

  while (hi - lo > 0.02) {
    const mid = roundUsd((lo + hi) / 2);
    if (calcProfit(listing, mid, r).meetsMinMargin) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return roundUsd(lo);
}

/**
 * @returns {object} 提案1件
 */
export function proposeForListing(listing, rules = {}) {
  const r = mergeRules(rules);
  const sku = listing.sku || listing.sellstaId || listing.ebayItemId || "(unknown)";

  const required = ["currentPriceUsd", "competitorLowestTotalUsd", "costJpy"];
  const missing = required.filter((k) => listing[k] === undefined || listing[k] === "");
  if (missing.length) {
    return {
      sku,
      action: "skip",
      approved_by_rule: false,
      reason: `missing: ${missing.join(", ")}`,
      proposedPriceUsd: null,
      proposedTotalUsd: null,
      profitMarginPercent: null,
    };
  }

  const currentTotal = totalUsd(listing);
  const competitiveTotal = num(listing.competitorLowestTotalUsd);
  const targetTotal = roundUsd(competitiveTotal - r.undercutUsd);
  const shippingChargedUsd = Number(listing.shippingChargedUsd) || 0;
  const targetItemPrice = roundUsd(targetTotal - shippingChargedUsd);

  if (targetItemPrice < 0.99) {
    return {
      sku,
      action: "skip",
      approved_by_rule: false,
      reason: "target item price below 0.99",
      proposedPriceUsd: null,
      proposedTotalUsd: null,
      profitMarginPercent: null,
    };
  }

  const atTarget = calcProfit(listing, targetItemPrice, r);

  if (atTarget.meetsMinMargin) {
    let action = "hold";
    if (currentTotal > targetTotal + 0.001) action = "lower";
    else if (currentTotal < targetTotal - 0.001) action = "raise";

    return {
      sku,
      sellstaId: listing.sellstaId ?? "",
      ebayItemId: listing.ebayItemId ?? "",
      priority: listing.priority ?? "normal",
      currentPriceUsd: roundUsd(listing.currentPriceUsd),
      currentTotalUsd: roundUsd(currentTotal),
      competitorLowestTotalUsd: competitiveTotal,
      targetTotalUsd: targetTotal,
      proposedPriceUsd: targetItemPrice,
      proposedTotalUsd: targetTotal,
      profitMarginPercent: atTarget.profitMarginPercent,
      netProfitJpy: atTarget.netProfitJpy,
      approved_by_rule: true,
      action,
      reason:
        action === "hold"
          ? "already at competitive target"
          : `competitive total ${targetTotal} USD (${r.undercutUsd} under lowest)`,
    };
  }

  const floorItem = findFloorItemPrice(listing, r);
  if (floorItem == null) {
    return {
      sku,
      action: "skip",
      approved_by_rule: false,
      reason: "cannot meet min margin at any practical price",
      proposedPriceUsd: null,
      proposedTotalUsd: null,
      profitMarginPercent: null,
    };
  }

  const floorProfit = calcProfit(listing, floorItem, r);
  const floorTotal = roundUsd(floorItem + shippingChargedUsd);
  let action = "hold";
  if (roundUsd(listing.currentPriceUsd) > floorItem + 0.001) {
    action = "hold";
  } else if (roundUsd(listing.currentPriceUsd) < floorItem - 0.001) {
    action = "raise";
  }

  return {
    sku,
    sellstaId: listing.sellstaId ?? "",
    ebayItemId: listing.ebayItemId ?? "",
    priority: listing.priority ?? "normal",
    currentPriceUsd: roundUsd(listing.currentPriceUsd),
    currentTotalUsd: roundUsd(currentTotal),
    competitorLowestTotalUsd: competitiveTotal,
    targetTotalUsd: targetTotal,
    proposedPriceUsd: floorItem,
    proposedTotalUsd: floorTotal,
    profitMarginPercent: floorProfit.profitMarginPercent,
    netProfitJpy: floorProfit.netProfitJpy,
    approved_by_rule: true,
    action,
    reason: `below min margin at competitive price; floor ~${floorItem} USD item`,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function proposeAll(listings, rules = {}) {
  return (listings || []).map((row) => proposeForListing(row, rules));
}
