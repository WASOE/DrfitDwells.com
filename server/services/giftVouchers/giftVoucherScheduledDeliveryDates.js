const { sofiaDateIso } = require('./giftVoucherDeliveryOption');

function isScheduledDeliveryDue(deliveryDate, now = new Date()) {
  if (!deliveryDate) return false;
  return sofiaDateIso(deliveryDate) <= sofiaDateIso(now);
}

function isDeliveryDateBeforeExpiry(deliveryDate, expiresAt) {
  if (!deliveryDate || !expiresAt) return false;
  return sofiaDateIso(deliveryDate) < sofiaDateIso(expiresAt);
}

function isDeliveryDateOnOrAfterExpiry(deliveryDate, expiresAt) {
  if (!deliveryDate || !expiresAt) return false;
  return sofiaDateIso(deliveryDate) >= sofiaDateIso(expiresAt);
}

module.exports = {
  isScheduledDeliveryDue,
  isDeliveryDateBeforeExpiry,
  isDeliveryDateOnOrAfterExpiry
};
