'use strict';

/**
 * Claim filter for the dedicated Arrival Automation V2 scheduler worker.
 *
 * When ARRIVAL_AUTOMATION_WORKER_MODE=1 (set by runArrivalAutomationWorker):
 *   - Only Cabin/Valley T-3 allowlisted rule keys are claimable
 *   - Only jobs marked payloadSnapshot.arrivalAutomationV2 === true
 *   - Optional ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST restricts by guest email
 *
 * When mode is off, the shared scheduler keeps historical claim-all behaviour.
 */

const {
  isArrivalAutomationRuleKey
} = require('./arrivalFeatureFlags');

const ENV_WORKER_MODE = 'ARRIVAL_AUTOMATION_WORKER_MODE';
const ENV_EMAIL_ALLOWLIST = 'ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST';
const ENV_ALLOW_ALL_GUESTS = 'ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS';

function isArrivalAutomationWorkerMode(env = process.env) {
  return String(env[ENV_WORKER_MODE] || '').trim() === '1';
}

function parseEmailAllowlist(env = process.env) {
  const raw = String(env[ENV_EMAIL_ALLOWLIST] || '').trim();
  if (!raw) return null;
  const set = new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return set.size ? set : null;
}

function allowsAllGuests(env = process.env) {
  return String(env[ENV_ALLOW_ALL_GUESTS] || '').trim() === '1';
}

/**
 * Validate dedicated-worker env before start. Throws Error with reason.
 */
function assertArrivalWorkerEnv(env = process.env) {
  if (!isArrivalAutomationWorkerMode(env)) {
    throw new Error(`${ENV_WORKER_MODE} must be 1 for the dedicated arrival worker`);
  }
  if (String(env.ARRIVAL_EMAIL_V2 || '').trim() !== '1') {
    throw new Error('ARRIVAL_EMAIL_V2=1 required');
  }
  if (String(env.ARRIVAL_AUTOMATION_V2 || '').trim() !== '1') {
    throw new Error('ARRIVAL_AUTOMATION_V2=1 required');
  }
  if (String(env.MESSAGE_SCHEDULER_WORKER_ENABLED || '').trim() !== '1') {
    throw new Error('MESSAGE_SCHEDULER_WORKER_ENABLED=1 required');
  }
  if (String(env.MESSAGE_DISPATCHER_ENABLED || '').trim() === '1') {
    throw new Error(
      'MESSAGE_DISPATCHER_ENABLED must be 0 (V2 uses arrival adapter; GMA dispatcher must stay off)'
    );
  }
  if (String(env.MESSAGE_ORCHESTRATOR_ENABLED || '').trim() === '1') {
    throw new Error(
      'MESSAGE_ORCHESTRATOR_ENABLED must be 0 on the dedicated arrival worker (GMA isolation)'
    );
  }
  const allowlist = parseEmailAllowlist(env);
  if (!allowlist && !allowsAllGuests(env)) {
    throw new Error(
      `${ENV_EMAIL_ALLOWLIST} required unless ${ENV_ALLOW_ALL_GUESTS}=1 (guest production enablement)`
    );
  }
  return {
    emailAllowlist: allowlist,
    allowAllGuests: allowsAllGuests(env)
  };
}

/**
 * Decide whether a lean ScheduledMessageJob (+ optional booking) may be claimed
 * by this worker process.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function evaluateArrivalWorkerClaim({ job, booking = null, env = process.env } = {}) {
  if (!isArrivalAutomationWorkerMode(env)) {
    return { ok: true, reason: 'shared_scheduler_unfiltered' };
  }
  if (!job) return { ok: false, reason: 'job_missing' };
  if (!isArrivalAutomationRuleKey(job.ruleKey)) {
    return { ok: false, reason: 'not_arrival_allowlist' };
  }
  if (job.payloadSnapshot?.arrivalAutomationV2 !== true) {
    return { ok: false, reason: 'missing_v2_payload' };
  }

  const allowlist = parseEmailAllowlist(env);
  if (allowlist) {
    const email = String(booking?.guestInfo?.email || '').trim().toLowerCase();
    if (!email || !allowlist.has(email)) {
      return { ok: false, reason: 'email_not_allowlisted' };
    }
  } else if (!allowsAllGuests(env)) {
    return { ok: false, reason: 'allowlist_required' };
  }

  return { ok: true };
}

module.exports = {
  ENV_WORKER_MODE,
  ENV_EMAIL_ALLOWLIST,
  ENV_ALLOW_ALL_GUESTS,
  isArrivalAutomationWorkerMode,
  parseEmailAllowlist,
  allowsAllGuests,
  assertArrivalWorkerEnv,
  evaluateArrivalWorkerClaim
};
