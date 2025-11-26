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
    return this._parseBoolean(process.env.MULTI_UNIT_ENABLED);
  },

  // Returns configured multi-unit type slugs as an array (lowercased)
  getMultiUnitTypes() {
    const raw = process.env.MULTI_UNIT_TYPES || '';
    if (!raw) return [];
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

