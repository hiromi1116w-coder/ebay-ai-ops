/**
 * 利益試算（還付金は含めない）。セルスタ表示と突合してから本番運用すること。
 */

const DEFAULT_RULES = {
  fxUsdJpy: 150,
  ebayFeeRate: 0.15,
  fixedFeeUsd: 0.3,
  minProfitMarginPercent: 1,
  marginDenominator: "cost",
  undercutUsd: 0.01,
};

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function mergeRules(rules = {}) {
  return { ...DEFAULT_RULES, ...rules };
}

/**
 * @param {object} listing
 * @param {number} itemPriceUsd - 試算する商品価格（USD）
 * @param {object} rules
 */
export function calcProfit(listing, itemPriceUsd, rules = {}) {
  const r = mergeRules(rules);
  const shippingChargedUsd = num(listing.shippingChargedUsd, 0);
  const costJpy = num(listing.costJpy, 0);
  const outboundShippingJpy = num(listing.outboundShippingJpy, 0);
  const packagingJpy = num(listing.packagingJpy, 0);

  const totalUsd = num(itemPriceUsd) + shippingChargedUsd;
  const revenueJpy =
    totalUsd * r.fxUsdJpy * (1 - r.ebayFeeRate) -
    r.fixedFeeUsd * r.fxUsdJpy;

  const costTotalJpy = costJpy + outboundShippingJpy + packagingJpy;
  const netProfitJpy = revenueJpy - costTotalJpy;

  let profitMarginPercent = 0;
  if (r.marginDenominator === "revenue" && revenueJpy > 0) {
    profitMarginPercent = (netProfitJpy / revenueJpy) * 100;
  } else if (costTotalJpy > 0) {
    profitMarginPercent = (netProfitJpy / costTotalJpy) * 100;
  }

  return {
    itemPriceUsd: num(itemPriceUsd),
    totalUsd,
    revenueJpy: Math.round(revenueJpy),
    costTotalJpy: Math.round(costTotalJpy),
    netProfitJpy: Math.round(netProfitJpy),
    profitMarginPercent: Math.round(profitMarginPercent * 100) / 100,
    meetsMinMargin: profitMarginPercent >= r.minProfitMarginPercent,
  };
}

export function totalUsd(listing) {
  return num(listing.currentPriceUsd) + num(listing.shippingChargedUsd, 0);
}
