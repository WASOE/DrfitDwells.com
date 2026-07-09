/**
 * Flat per-property buyout rates for whole-location Valley quotes.
 * Guest count never affects price; pricingModel on entities is ignored.
 */

function resolveBuyoutRatePerNight(entity) {
  if (!entity) return 0;
  if (Number.isFinite(entity.buyoutPricePerNight) && entity.buyoutPricePerNight >= 0) {
    return entity.buyoutPricePerNight;
  }
  return Number.isFinite(entity.pricePerNight) ? entity.pricePerNight : 0;
}

function calculateFlatBuyoutLodgingSubtotal(buyoutRatePerNight, nights, unitCount = 1) {
  const rate = Math.max(0, Number(buyoutRatePerNight) || 0);
  const nightCount = Math.max(0, Number(nights) || 0);
  const units = Math.max(1, Number(unitCount) || 1);
  return Math.round(rate * nightCount * units * 100) / 100;
}

module.exports = {
  resolveBuyoutRatePerNight,
  calculateFlatBuyoutLodgingSubtotal
};
