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
    return normalized === 'true' || normalized === '1';
  },

  // Returns whether multi-unit functionality is globally enabled
  isMultiUnitGloballyEnabled() {
    if (process.env.MULTI_UNIT_ENABLED !== undefined) {
      return this._parseBoolean(process.env.MULTI_UNIT_ENABLED);
    }
    // Default ON in all environments when unset (A-Frame / pooled types in search + admin).
    // Set MULTI_UNIT_ENABLED=false or 0 to disable.
    return true;
  },

  // Returns configured multi-unit type slugs as an array (lowercased)
  getMultiUnitTypes() {
    const raw = process.env.MULTI_UNIT_TYPES || '';
    if (!raw) {
      // Default slug when unset — same in production and dev so LIVE search matches local.
      return ['a-frame'];
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
  }
};

module.exports = featureFlags;

