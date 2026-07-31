'use strict';

const featureFlags = require('../../utils/featureFlags');
const {
  getBookingConfirmationDeliveryWorkerState,
  countConfirmationDeliveryBacklog
} = require('./bookingConfirmationDeliveryWorker');

function isSmtpConfigured() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const url = String(process.env.SMTP_URL || '').trim();
  return Boolean(host || url);
}

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Ops read model for confirmation backlog worker health.
 * SMTP credential presence alone must not imply healthy delivery.
 */
async function getBookingConfirmationDeliveryHealthReadModel({ now = new Date() } = {}) {
  const worker = getBookingConfirmationDeliveryWorkerState();
  const backlog = await countConfirmationDeliveryBacklog({ now });
  const smtpConfigured = isSmtpConfigured();
  const workerEnabled = featureFlags.isBookingConfirmationDeliveryWorkerEnabled();

  const overdueBacklog = backlog.pendingDueCount > 0;
  const hasTerminalProblems = backlog.failedCount > 0 || backlog.ambiguousCount > 0;

  let deliveryHealth = 'ok';
  if (!smtpConfigured) {
    deliveryHealth = 'smtp_not_configured';
  } else if (workerEnabled && !worker.running) {
    deliveryHealth = 'worker_enabled_but_not_running';
  } else if (overdueBacklog) {
    deliveryHealth = 'overdue_confirmation_backlog';
  } else if (hasTerminalProblems) {
    deliveryHealth = 'failed_or_ambiguous_present';
  } else if (!workerEnabled) {
    deliveryHealth = 'worker_disabled';
  }

  return {
    smtpConfigured,
    workerConfigured: worker.configured || workerEnabled,
    workerEnabled,
    workerRunning: Boolean(worker.running),
    deliveryHealth,
    healthy:
      smtpConfigured &&
      workerEnabled &&
      worker.running &&
      !overdueBacklog &&
      backlog.ambiguousCount === 0,
    interpretation: {
      smtpCredentialsDoNotImplyDelivery: true,
      overduePendingMeansUnhealthy: overdueBacklog
    },
    worker: {
      configured: worker.configured,
      enabled: worker.enabled,
      running: worker.running,
      workerId: worker.workerId,
      lastTickAt: toIso(worker.lastTickAt),
      lastSuccessfulTickAt: toIso(worker.lastSuccessfulTickAt),
      lastErrorAt: toIso(worker.lastErrorAt),
      lastError: worker.lastError,
      processed: worker.processedTotal,
      succeeded: worker.succeededTotal,
      retryableFailures: worker.retryableFailureTotal,
      ambiguous: worker.ambiguousTotal,
      abandoned: worker.abandonedTotal
    },
    backlog: {
      pendingDueCount: backlog.pendingDueCount,
      totalPendingCount: backlog.totalPendingCount,
      sendingCount: backlog.sendingCount,
      failedCount: backlog.failedCount,
      ambiguousCount: backlog.ambiguousCount,
      oldestDueAt: toIso(backlog.oldestDueAt)
    }
  };
}

module.exports = {
  getBookingConfirmationDeliveryHealthReadModel,
  isSmtpConfigured
};
