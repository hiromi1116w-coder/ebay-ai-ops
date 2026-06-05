/**
 * CPaSS Shipping Policy の 50 USD 帯（セルスタのドロップダウン命名に合わせる）
 */
export function cpassPolicyForPrice(priceUsd) {
  const p = Number(priceUsd);
  if (!Number.isFinite(p) || p < 1) {
    return { ok: false, reason: "invalid price" };
  }

  const bandIndex = Math.ceil(p / 50);
  const rangeMin = (bandIndex - 1) * 50 + 1;
  const rangeMax = bandIndex * 50;
  const code = String(bandIndex).padStart(4, "0");
  const label = `${code} cpass ${rangeMin}～${rangeMax} ドル`;

  return {
    ok: true,
    bandIndex,
    rangeMin,
    rangeMax,
    label,
    changed: (currentLabel, nextLabel) =>
      String(currentLabel || "").trim() !== String(nextLabel || "").trim(),
  };
}
