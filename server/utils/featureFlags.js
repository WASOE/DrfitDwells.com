/**
 * Feature Flags
 * 
 * Centralized feature flag management for enabling/disabling features
 * without code changes.
 */

const featureFlags = {
  // Generic helper to parse boolean env flags
  _parseBoolean(value) {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
  },

  /**
   * Parse env flag with explicit on/off tokens.
   * on: 1|true|on|yes ; off: 0|false|off|no ; unset/unknown → defaultValue
   */
  _parseBooleanWithDefault(value, defaultValue = false) {
    if (value == null || value === '') return defaultValue;
    if (typeof value !== 'string') return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no') {
      return false;
    }
    return defaultValue;
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

  // CheckoutSession V2: canonical PI per session (default off in all environments).
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
   * Batch 3–4: job execution must stay disabled. Explicit on is ignored by Batch 3 code paths.
   * Exposed for observability / future Batch 5 gating.
   */
  isFinalizeJobExecuteEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_JOB_EXECUTE, false);
  },

  /**
   * Batch 4: V2 frontend booking create uses finalizePaidCheckout domain service.
   * Default OFF (dual-path rollback). Enable: 1|true|on|yes.
   * FINALIZE_JOB_EXECUTE remains off — no worker.
   */
  isFinalizeDomainServiceEnabled() {
    return this._parseBooleanWithDefault(process.env.FINALIZE_DOMAIN_SERVICE, false);
  }
};

module.exports = featureFlags;

