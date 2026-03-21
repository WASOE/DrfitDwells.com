const MODULE_VERDICTS = {
  not_ready: 'not_ready',
  conditionally_ready: 'conditionally_ready',
  ready_for_restricted_cutover: 'ready_for_restricted_cutover',
  ready_for_primary_use: 'ready_for_primary_use'
};

const OVERLAP_STATUSES = {
  active: 'active',
  restricted: 'restricted',
  read_only: 'read_only',
  target_for_cutover: 'target_for_cutover'
};

// Verdict is computed from parity mismatch criticality + dependency degradation + evidence coverage.
// Thresholds are explicit; we do not "green" modules on insufficient evidence.
const PARITY_VERDICT_RULES = {
  // If any parity mismatch is critical => not_ready
  criticalMismatchTriggersNotReady: true,
  // If non-critical mismatches exist but no critical mismatches => conditionally_ready
  anyNonCriticalMismatchTriggersConditionallyReady: true,
  // If no mismatches but degraded dependencies exist => ready_for_restricted_cutover
  degradedDependenciesTriggersRestrictedCutover: true,
  // If no mismatches but evidence is insufficient => conditionally_ready
  insufficientEvidenceTriggersConditionallyReady: true
};

module.exports = {
  MODULE_VERDICTS,
  OVERLAP_STATUSES,
  PARITY_VERDICT_RULES
};

