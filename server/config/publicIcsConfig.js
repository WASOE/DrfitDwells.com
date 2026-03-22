/**
 * Public outbound ICS: optional strict eligibility (production default).
 * Pending stays without Payment evidence (paid/partial) are excluded from ICS when strict.
 */
function isPublicIcsStrictEligibility() {
  const v = String(process.env.PUBLIC_ICS_STRICT_ELIGIBILITY || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return process.env.NODE_ENV === 'production';
}

/** When true (default), public ICS excludes bookings that fail production-safety resolution. */
function isPublicIcsExportSafetyEnforced() {
  const v = String(process.env.PUBLIC_ICS_IGNORE_EXPORT_SAFETY || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return false;
  return true;
}

module.exports = {
  isPublicIcsStrictEligibility,
  isPublicIcsExportSafetyEnforced
};
