/**
 * Blocks validation/build scripts from writing to non-local MongoDB unless explicitly overridden.
 * Prevents accidental fixture data in production.
 */
function assertScriptWriteAllowedForMongoUri(uri) {
  const u = String(uri || '');
  const isLocal = /127\.0\.0\.1|localhost/.test(u);
  if (isLocal) return;

  const token = process.env.DRIFT_ALLOW_VALIDATE_WRITE;
  if (token !== 'I_UNDERSTAND_PRODUCTION_RISK') {
    throw new Error(
      '[scripts] Refusing to write to non-local MongoDB. Run against localhost, or set DRIFT_ALLOW_VALIDATE_WRITE=I_UNDERSTAND_PRODUCTION_RISK (explicit escape hatch only).'
    );
  }
}

/**
 * Maintenance scripts may apply destructive fixes to production only with explicit confirmation.
 */
function assertMaintenanceApplyAllowedForMongoUri(uri) {
  const u = String(uri || '');
  const isLocal = /127\.0\.0\.1|localhost/.test(u);
  if (isLocal) return;

  if (process.env.DRIFT_ALLOW_MAINTENANCE_APPLY !== '1') {
    throw new Error(
      '[maintenance] Refusing --apply on non-local MongoDB without DRIFT_ALLOW_MAINTENANCE_APPLY=1'
    );
  }
}

module.exports = {
  assertScriptWriteAllowedForMongoUri,
  assertMaintenanceApplyAllowedForMongoUri
};
