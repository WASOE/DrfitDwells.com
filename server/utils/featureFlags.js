/**
 * Feature Flags
 * 
 * Centralized feature flag management for enabling/disabling features
 * without code changes.
 */

const {
  parseBooleanFlag,
  parseBooleanFlagWithDefault
} = require('../../shared/env/parseBooleanFlag.js');

const featureFlags = {
  // Generic helper — shared parser (1|true|on|yes).
  _parseBoolean(value) {
    return parseBooleanFlag(value);
  },

  /**
   * Parse env flag with explicit on/off tokens.
   * on: 1|true|on|yes ; off: 0|false|off|no ; unset/unknown → defaultValue
   */
  _parseBooleanWithDefault(value, defaultValue = false) {
    return parseBooleanFlagWithDefault(value, defaultValue);
  },

  // Returns whether multi-unit functionality is globally enabled
  isMultiUnitGloballyEnabled() {
    if (process.env.MULTI_UNIT_ENABLED !== undefined) {
      return this._parseBoolean(process.env.MULTI_UNIT_ENABLED);
    }
    // Production: multi-unit is off unless MULTI_UNIT_ENABLED is set (explicit ops choice).
    // Local/dev: on when unset so A-Frame flows work without extra .env.
    return process.env.NODE_ENV !== 'production';
  },

  // Returns configured multi-unit type slugs as an array (lowercased)
  getMultiUnitTypes() {
    const raw = process.env.MULTI_UNIT_TYPES || '';
    if (!raw) {
      // Local/dev default slug when MULTI_UNIT_TYPES unset. Production: empty list —
      // if multi-unit is enabled with no list, isMultiUnitType treats all CabinType slugs as allowed.
      return process.env.NODE_ENV !== 'production' ? ['a-frame'] : [];
    }
    return raw
      .split(',')
      .map((slug) => slug.trim().toLowerCase())
      .filter(Boolean);
  },

  // Checks if the provided slug is configured as multi-unit
  isMultiUnitType(slug) {
    if (!this.isMultiUnitGloballyEnabled()) {
      return false;
    }

    const configured = this.getMultiUnitTypes();
    if (configured.length === 0) {
      // Treat all slugs as enabled when no explicit list is provided
      return true;
    }

    if (!slug) {
      return false;
    }

    const normalized = slug.trim().toLowerCase();
    return configured.includes(normalized);
  },

  // CheckoutSession V2: canonical PI per session.
  // Explicit CHECKOUT_SESSION_V2 only. Do NOT infer from finalize-intent flags —
  // that made V2 impossible to disable (CHECKOUT_SESSION_V2=0 was ignored) and
  // coupled unrelated ops controls. Finalize attach is a separate concern.
  isCheckoutSessionV2Enabled() {
    return this._parseBoolean(process.env.CHECKOUT_SESSION_V2);
  },

  /** Batch 4B: quote-delivery recovery emails. Default OFF. */
  isRecoveryQuoteDeliveryEnabled() {
    return this._parseBoolean(process.env.RECOVERY_QUOTE_DELIVERY_ENABLED);
  },

  /** Batch 4B: booking-reminder recovery emails. Default OFF. */
  isRecoveryBookingReminderEnabled() {
    return this._parseBoolean(process.env.RECOVERY_BOOKING_REMINDER_ENABLED);
  },

  /** Batch 4B: provider send path for recovery. Default OFF. */
  isRecoveryEmailProviderEnabled() {
    return this._parseBoolean(process.env.RECOVERY_EMAIL_PROVIDER_ENABLED);
  },

  /**
   * Batch 2: persist finalizeIntent via API before payment confirm.
   * Default OFF (safe staged rollout). Unset → false.
   * Enabled: 1|true|on|yes. Disabled: 0|false|off|no.
   * Pair with client VITE_FINALIZE_INTENT_PERSIST (requires frontend rebuild/redeploy).
   */
  isFinalizeIntentPersistEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_INTENT_PERSIST, false);
  },

  /**
   * Batch 2: refuse accommodation canonical PI create/reuse when finalizeIntent/hash incomplete.
   * Default OFF. Enable only after persist soak. Gift-voucher PIs unaffected.
   * Pair with client VITE_FINALIZE_INTENT_REQUIRED_FOR_PI (requires frontend rebuild/redeploy).
   */
  isFinalizeIntentRequiredForPiEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_INTENT_REQUIRED_FOR_PI, false);
  },

  /**
   * Batch 3: mark CheckoutSession.paymentStatus=paid from verified accommodation webhook.
   * Default OFF. Gift-voucher PIs never use this path.
   */
  isCheckoutMarkPaidOnWebhookEnabled() {
    return this._parseBooleanWithDefault(process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK, false);
  },

  /**
   * Batch 3: ensure CheckoutFinalizationJob (scheduled only). Default OFF.
   * Requires CHECKOUT_MARK_PAID_ON_WEBHOOK — enqueue alone fails closed.
   * FINALIZE_JOB_EXECUTE remains off; no worker claims jobs in Batch 3.
   */
  isFinalizeJobEnqueueEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_JOB_ENQUEUE, false);
  },

  /**
   * Batch 5: CheckoutFinalizationJob worker may claim and execute via finalizePaidCheckout.
   * Default OFF. Enable: 1|true|on|yes.
   * Does not send confirmation email (see FINALIZE_WORKER_SEND_CONFIRMATION).
   */
  isFinalizeJobExecuteEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_JOB_EXECUTE, false);
  },

  /**
   * Batch 5–6: worker may enqueue/send confirmation email after finalize.
   * Default OFF — no confirmation SMTP from worker while off.
   */
  isFinalizeWorkerSendConfirmationEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_WORKER_SEND_CONFIRMATION, false);
  },

  /**
   * Batch 6: quote convert, alert resolve, and durable confirmation enqueue.
   * Default OFF (dual-path rollback). Enable: 1|true|on|yes.
   */
  isFinalizeSideEffectsEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_SIDE_EFFECTS, false);
  },

  /**
   * Batch 7: paid-checkout reconciliation may mutate (mark paid / ensure job / finalize)
   * when CLI/API passes execute=true. Default OFF. Dry-run always allowed.
   * Does not enable Batch 8 historical recovery.
   */
  isFinalizeReconcileEnqueueEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_RECONCILE_ENQUEUE, false);
  },

  /**
   * Batch 8: controlled historical recovery may mutate allowlisted subjects only
   * when CLI passes --execute and --allowlist. Default OFF.
   */
  isFinalizeReconcileHistoricalEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_RECONCILE_HISTORICAL, false);
  },

  /**
   * Batch 9: customer-facing post-payment recovery UX (polling / intermediate states).
   * Default OFF. Status endpoint is read-only and may be deployed independently;
   * this flag primarily gates guest-visible UX when mirrored as VITE_CHECKOUT_RECOVERY_UX.
   */
  isCheckoutRecoveryUxEnabled() {
    return this._parseBooleanWithDefault(process.env.CHECKOUT_RECOVERY_UX, false);
  },

  /**
   * Batch 4: V2 frontend booking create uses finalizePaidCheckout domain service.
   * Default OFF (dual-path rollback). Enable: 1|true|on|yes.
   */
  isFinalizeDomainServiceEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_DOMAIN_SERVICE, false);
  }
};

module.exports = featureFlags;

