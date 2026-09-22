/**
 * RatePlan Ops UI helpers — payload builders and safe error formatting.
 * Sends only RP2-allowlisted business fields. Never invents revisions or actor identity.
 * Error text is client-owned allowlist only (never server message passthrough).
 */

export const RATE_PLAN_TYPES = Object.freeze(['seasonal_stay', 'fixed_package']);
export const RATE_PLAN_STATUSES = Object.freeze(['draft', 'active', 'retired']);
export const PRICING_METHODS = Object.freeze([
  'nightly_per_unit',
  'nightly_base_plus_extra_guest',
  'fixed_per_unit',
  'fixed_per_participant'
]);
export const ENTITY_TYPES = Object.freeze(['cabin', 'cabinType']);

export const FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
  'status',
  'createdBy',
  'updatedBy',
  'activatedAt',
  'activatedBy',
  'retiredAt',
  'retiredBy',
  'ownerToken',
  '_id',
  'id',
  '__v',
  'createdAt',
  'updatedAt',
  'activationCommitted',
  'lockReleased',
  'operationalWarnings',
  'lockCleanupRequired',
  'revision',
  'operatorId'
]);

/** Fixed operator-facing messages — never derived from API body text. */
export const SAFE_ERROR_MESSAGES = Object.freeze({
  STALE_REVISION: 'This rate plan was changed elsewhere. Refresh the list and try again.',
  SEASONAL_OVERLAP: 'This seasonal window overlaps an active rate plan.',
  ACTIVATION_BUSY: 'Another activation is in progress. Try again later.',
  ACTIVATION_LOCK_UNCERTAIN:
    'Activation lock could not be confirmed. Do not retry without ops guidance.',
  VALIDATION: 'The rate plan data failed validation. Check required fields and try again.',
  NOT_FOUND: 'Rate plan was not found.',
  AUTH: 'You are not authorized to manage rate plans.',
  NETWORK: 'Network error. Check your connection and try again.',
  UNKNOWN: 'Something went wrong. Try again or contact ops if it continues.'
});

/** API codes that map to the fixed VALIDATION message. */
const VALIDATION_CODES = Object.freeze([
  'VALIDATION_FAILED',
  'ACCOMMODATION_NOT_FOUND',
  'ACCOMMODATION_INACTIVE',
  'CANCELLATION_POLICY_NOT_FOUND',
  'UNSUPPORTED_TYPE',
  'HARD_DELETE_FORBIDDEN',
  'FORBIDDEN_BODY_KEYS',
  'INVALID_REVISION'
]);

const AUTH_CODES = Object.freeze(['INVALID_OPERATOR', 'UNAUTHORIZED', 'FORBIDDEN']);

const CREATE_KEYS = Object.freeze([
  'code',
  'internalName',
  'version',
  'type',
  'currency',
  'arrivalWindowStart',
  'arrivalWindowEnd',
  'bookingWindowStart',
  'bookingWindowEnd',
  'minNights',
  'packageArrivalDate',
  'packageDepartureDate',
  'inventoryMode',
  'requiresFullPayment',
  'cancellationPolicyCode',
  'cancellationPolicyVersion',
  'paymentTermCode',
  'paymentTermVersion',
  'inclusions',
  'accommodations'
]);

export class RatePlanFormError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RatePlanFormError';
    this.isRatePlanValidation = true;
  }
}

function emptyAccommodation(type = 'seasonal_stay') {
  const seasonal = type !== 'fixed_package';
  return {
    accommodationKey: '',
    entityType: 'cabin',
    pricingMethod: seasonal ? 'nightly_per_unit' : 'fixed_per_participant',
    nightlyPerUnitAmount: '',
    includedGuests: '',
    additionalGuestNightlyAmount: '',
    fixedPerUnitAmount: '',
    adultPackageAmount: '',
    childPackageAmount: '',
    infantPackageAmount: ''
  };
}

export function createEmptyForm(type = 'seasonal_stay') {
  const seasonal = type === 'seasonal_stay';
  return {
    code: '',
    internalName: '',
    version: '1',
    type: seasonal ? 'seasonal_stay' : 'fixed_package',
    currency: 'EUR',
    arrivalWindowStart: '',
    arrivalWindowEnd: '',
    bookingWindowStart: '',
    bookingWindowEnd: '',
    minNights: seasonal ? '2' : '1',
    packageArrivalDate: '',
    packageDepartureDate: '',
    inventoryMode: seasonal ? 'shared' : 'exclusive',
    requiresFullPayment: true,
    cancellationPolicyCode: 'normal-stay-standard',
    cancellationPolicyVersion: '1',
    paymentTermCode: '',
    paymentTermVersion: '',
    inclusionsText: '',
    accommodations: [emptyAccommodation(type)]
  };
}

function dateOnly(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

function amountToForm(value) {
  if (value == null || value === '') return '';
  return String(value);
}

export function planToForm(plan) {
  if (!plan || typeof plan !== 'object') return createEmptyForm();
  const type = plan.type === 'fixed_package' ? 'fixed_package' : 'seasonal_stay';
  return {
    code: plan.code || '',
    internalName: plan.internalName || '',
    version: plan.version != null ? String(plan.version) : '1',
    type,
    currency: plan.currency || 'EUR',
    arrivalWindowStart: dateOnly(plan.arrivalWindowStart),
    arrivalWindowEnd: dateOnly(plan.arrivalWindowEnd),
    bookingWindowStart: dateOnly(plan.bookingWindowStart),
    bookingWindowEnd: dateOnly(plan.bookingWindowEnd),
    minNights: plan.minNights != null ? String(plan.minNights) : '1',
    packageArrivalDate: dateOnly(plan.packageArrivalDate),
    packageDepartureDate: dateOnly(plan.packageDepartureDate),
    inventoryMode: plan.inventoryMode || (type === 'seasonal_stay' ? 'shared' : 'exclusive'),
    requiresFullPayment: plan.requiresFullPayment === true,
    cancellationPolicyCode: plan.cancellationPolicyCode || '',
    cancellationPolicyVersion:
      plan.cancellationPolicyVersion != null ? String(plan.cancellationPolicyVersion) : '1',
    paymentTermCode: plan.paymentTermCode || '',
    paymentTermVersion:
      plan.paymentTermVersion != null ? String(plan.paymentTermVersion) : '',
    inclusionsText: Array.isArray(plan.inclusions) ? plan.inclusions.join('\n') : '',
    accommodations:
      Array.isArray(plan.accommodations) && plan.accommodations.length
        ? plan.accommodations.map((row) => ({
            accommodationKey: row.accommodationKey || '',
            entityType: row.entityType || 'cabin',
            pricingMethod: row.pricingMethod || emptyAccommodation(type).pricingMethod,
            nightlyPerUnitAmount: amountToForm(row.nightlyPerUnitAmount),
            includedGuests: amountToForm(row.includedGuests),
            additionalGuestNightlyAmount: amountToForm(row.additionalGuestNightlyAmount),
            fixedPerUnitAmount: amountToForm(row.fixedPerUnitAmount),
            adultPackageAmount: amountToForm(row.adultPackageAmount),
            childPackageAmount: amountToForm(row.childPackageAmount),
            infantPackageAmount: amountToForm(row.infantPackageAmount)
          }))
        : [emptyAccommodation(type)]
  };
}

function roundEuro(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Parse a required euro amount from form text.
 * RP1: finite, non-negative, already two-decimal (zero allowed).
 * Blank / whitespace / null / invalid → throw (never coerce to 0 or null for submit).
 */
function parseRequiredEuro(raw, fieldLabel) {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    throw new RatePlanFormError(`${fieldLabel} is required`);
  }
  if (typeof raw === 'string' && raw.trim() !== raw) {
    // allow leading/trailing whitespace by trimming, but reject empty after trim above
  }
  const trimmed = typeof raw === 'string' ? raw.trim() : raw;
  if (trimmed === '' || trimmed == null) {
    throw new RatePlanFormError(`${fieldLabel} is required`);
  }
  const n = typeof trimmed === 'number' ? trimmed : Number(trimmed);
  if (typeof trimmed === 'string' && trimmed.toLowerCase() === 'nan') {
    throw new RatePlanFormError(`${fieldLabel} must be a valid number`);
  }
  if (!Number.isFinite(n)) {
    throw new RatePlanFormError(`${fieldLabel} must be a finite number`);
  }
  if (n < 0) {
    throw new RatePlanFormError(`${fieldLabel} cannot be negative`);
  }
  if (roundEuro(n) !== n) {
    throw new RatePlanFormError(`${fieldLabel} must use at most two decimal places`);
  }
  if (!Number.isSafeInteger(Math.round(n * 100))) {
    throw new RatePlanFormError(`${fieldLabel} is out of range`);
  }
  return n;
}

/** RP1: includedGuests must be a non-negative integer (zero allowed). */
function parseRequiredNonNegInt(raw, fieldLabel) {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    throw new RatePlanFormError(`${fieldLabel} is required`);
  }
  const trimmed = typeof raw === 'string' ? raw.trim() : raw;
  const n = typeof trimmed === 'number' ? trimmed : Number(trimmed);
  if (!Number.isInteger(n) || n < 0) {
    throw new RatePlanFormError(`${fieldLabel} must be a non-negative integer`);
  }
  return n;
}

function parseRequiredInt(raw, field) {
  if (raw == null || (typeof raw === 'string' && String(raw).trim() === '')) {
    throw new RatePlanFormError(`${field} must be a positive integer`);
  }
  const n = Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new RatePlanFormError(`${field} must be a positive integer`);
  }
  return n;
}

function parseDateOrNull(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new RatePlanFormError(`Invalid date: ${fieldSafe(s)}`);
  }
  return s;
}

function fieldSafe(s) {
  return String(s).replace(/[^\w\-.:]/g, '').slice(0, 32);
}

function emptyPricingAmounts() {
  return {
    nightlyPerUnitAmount: null,
    includedGuests: null,
    additionalGuestNightlyAmount: null,
    fixedPerUnitAmount: null,
    adultPackageAmount: null,
    childPackageAmount: null,
    infantPackageAmount: null
  };
}

/**
 * RP1 pricingFieldsForMethod parity — required fields per method; unused → null.
 * Zero is permitted for euro amounts and includedGuests.
 */
function pricingFieldsForMethod(method, row, rowLabel) {
  const out = emptyPricingAmounts();
  out.pricingMethod = method;

  if (method === 'nightly_per_unit') {
    out.nightlyPerUnitAmount = parseRequiredEuro(
      row.nightlyPerUnitAmount,
      `${rowLabel} nightly amount`
    );
  } else if (method === 'nightly_base_plus_extra_guest') {
    out.nightlyPerUnitAmount = parseRequiredEuro(
      row.nightlyPerUnitAmount,
      `${rowLabel} nightly amount`
    );
    out.includedGuests = parseRequiredNonNegInt(row.includedGuests, `${rowLabel} included guests`);
    out.additionalGuestNightlyAmount = parseRequiredEuro(
      row.additionalGuestNightlyAmount,
      `${rowLabel} extra-guest nightly amount`
    );
  } else if (method === 'fixed_per_unit') {
    out.fixedPerUnitAmount = parseRequiredEuro(
      row.fixedPerUnitAmount,
      `${rowLabel} fixed unit amount`
    );
  } else if (method === 'fixed_per_participant') {
    out.adultPackageAmount = parseRequiredEuro(
      row.adultPackageAmount,
      `${rowLabel} adult package amount`
    );
    out.childPackageAmount = parseRequiredEuro(
      row.childPackageAmount,
      `${rowLabel} child package amount`
    );
    out.infantPackageAmount = parseRequiredEuro(
      row.infantPackageAmount,
      `${rowLabel} infant package amount`
    );
  } else {
    throw new RatePlanFormError(`${rowLabel}: unsupported pricing method`);
  }

  return out;
}

/**
 * Normalize accommodation identity the way RP1 duplicate detection does:
 * trimmed/lowercased accommodationKey. RP1 rejects duplicate keys even across
 * entityType values (seenKeys is key-only).
 */
export function normalizeAccommodationIdentity(row) {
  const accommodationKey =
    row?.accommodationKey == null ? '' : String(row.accommodationKey).trim().toLowerCase();
  const entityType = row?.entityType == null ? '' : String(row.entityType).trim();
  return { entityType, accommodationKey };
}

function buildAccommodationRow(row, type, index) {
  const rowLabel = `Accommodation ${index + 1}`;
  const { entityType, accommodationKey } = normalizeAccommodationIdentity(row);

  if (!entityType || !ENTITY_TYPES.includes(entityType)) {
    throw new RatePlanFormError(`${rowLabel}: entity type must be cabin or cabinType`);
  }
  if (!accommodationKey) {
    throw new RatePlanFormError(`${rowLabel}: accommodation key (slug) is required`);
  }

  const pricingMethod = row.pricingMethod == null ? '' : String(row.pricingMethod);
  if (!PRICING_METHODS.includes(pricingMethod)) {
    throw new RatePlanFormError(`${rowLabel}: unsupported pricing method`);
  }

  // UI separates seasonal vs fixed methods; enforce that separation locally.
  if (type === 'seasonal_stay' && !pricingMethod.startsWith('nightly')) {
    throw new RatePlanFormError(`${rowLabel}: seasonal plans require a nightly pricing method`);
  }
  if (type === 'fixed_package' && !pricingMethod.startsWith('fixed')) {
    throw new RatePlanFormError(`${rowLabel}: fixed packages require a fixed pricing method`);
  }

  const amounts = pricingFieldsForMethod(pricingMethod, row, rowLabel);
  return {
    accommodationKey,
    entityType,
    ...amounts
  };
}

/**
 * Build create/update business payload from form state.
 * Throws RatePlanFormError with field-level message on validation failure.
 * Never emits incomplete accommodation pricing rows.
 */
export function buildBusinessPayload(form) {
  const type = form.type === 'fixed_package' ? 'fixed_package' : 'seasonal_stay';
  const inclusions = String(form.inclusionsText || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const rawRows = form.accommodations || [];
  if (!rawRows.length) {
    throw new RatePlanFormError('Add at least one accommodation pricing row');
  }

  const accommodations = rawRows.map((row, index) => buildAccommodationRow(row, type, index));

  // RP1 duplicate identity: accommodationKey only (entityType does not separate identities).
  const seenKeys = new Map();
  accommodations.forEach((row, index) => {
    if (seenKeys.has(row.accommodationKey)) {
      const first = seenKeys.get(row.accommodationKey);
      throw new RatePlanFormError(
        `Duplicate accommodation "${row.accommodationKey}" (rows ${first + 1} and ${index + 1}). ` +
          'Each accommodation key must be unique within the plan.'
      );
    }
    seenKeys.set(row.accommodationKey, index);
  });

  /** @type {Record<string, unknown>} */
  const payload = {
    code: String(form.code || '')
      .trim()
      .toLowerCase(),
    internalName: String(form.internalName || '').trim(),
    version: parseRequiredInt(form.version, 'version'),
    type,
    currency: form.currency === 'EUR' ? 'EUR' : 'EUR',
    bookingWindowStart: parseDateOrNull(form.bookingWindowStart),
    bookingWindowEnd: parseDateOrNull(form.bookingWindowEnd),
    minNights: parseRequiredInt(form.minNights, 'minNights'),
    inventoryMode: form.inventoryMode === 'exclusive' ? 'exclusive' : 'shared',
    requiresFullPayment: form.requiresFullPayment === true,
    cancellationPolicyCode: String(form.cancellationPolicyCode || '')
      .trim()
      .toLowerCase(),
    cancellationPolicyVersion: parseRequiredInt(
      form.cancellationPolicyVersion,
      'cancellationPolicyVersion'
    ),
    paymentTermCode: String(form.paymentTermCode || '')
      .trim()
      .toLowerCase() || null,
    paymentTermVersion: form.paymentTermVersion
      ? parseRequiredInt(form.paymentTermVersion, 'paymentTermVersion')
      : null,
    inclusions,
    accommodations
  };

  if (!payload.paymentTermCode) {
    payload.paymentTermCode = null;
    payload.paymentTermVersion = null;
  } else if (payload.paymentTermVersion == null) {
    throw new RatePlanFormError('Payment term version is required when a payment term code is set');
  }

  if (!payload.code) {
    throw new RatePlanFormError('Code is required');
  }
  if (!payload.internalName) {
    throw new RatePlanFormError('Internal name is required');
  }
  if (!payload.cancellationPolicyCode) {
    throw new RatePlanFormError('Cancellation policy code is required');
  }

  if (type === 'seasonal_stay') {
    payload.arrivalWindowStart = parseDateOrNull(form.arrivalWindowStart);
    payload.arrivalWindowEnd = parseDateOrNull(form.arrivalWindowEnd);
    payload.packageArrivalDate = null;
    payload.packageDepartureDate = null;
    if (!payload.arrivalWindowStart || !payload.arrivalWindowEnd) {
      throw new RatePlanFormError('Seasonal plans require arrival window start and end');
    }
  } else {
    payload.arrivalWindowStart = null;
    payload.arrivalWindowEnd = null;
    payload.packageArrivalDate = parseDateOrNull(form.packageArrivalDate);
    payload.packageDepartureDate = parseDateOrNull(form.packageDepartureDate);
    if (!payload.packageArrivalDate || !payload.packageDepartureDate) {
      throw new RatePlanFormError('Fixed packages require package arrival and departure dates');
    }
    payload.inventoryMode = 'exclusive';
  }

  for (const key of Object.keys(payload)) {
    if (!CREATE_KEYS.includes(key) || FORBIDDEN_PAYLOAD_KEYS.includes(key)) {
      throw new RatePlanFormError(`Refusing to send disallowed field: ${key}`);
    }
  }

  return payload;
}

export function buildCreatePayload(form) {
  return buildBusinessPayload(form);
}

/**
 * Update payload: business fields + exact expectedRevision from API (never invented).
 */
export function buildUpdatePayload(form, expectedRevision) {
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new RatePlanFormError('expectedRevision must be the exact revision from the server');
  }
  return {
    ...buildBusinessPayload(form),
    expectedRevision
  };
}

export function buildRevisionOnlyPayload(expectedRevision) {
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new RatePlanFormError('expectedRevision must be the exact revision from the server');
  }
  return { expectedRevision };
}

export function isDraftEditable(plan) {
  return plan && plan.status === 'draft';
}

export function assertNoForbiddenKeys(payload) {
  const banned = [
    'createdBy',
    'updatedBy',
    'activatedBy',
    'retiredBy',
    'ownerToken',
    'status',
    'revision',
    '_id',
    'id',
    'operatorId',
    '__v',
    'activationCommitted',
    'lockReleased'
  ];
  for (const key of Object.keys(payload || {})) {
    if (banned.includes(key)) {
      throw new RatePlanFormError(`Forbidden key present: ${key}`);
    }
  }
  return true;
}

/**
 * Map transport/API failures to fixed client-owned strings.
 * Never reads or renders server `message`, `details`, stacks, or secrets.
 */
export function safeErrorMessage(error, _fallback = SAFE_ERROR_MESSAGES.UNKNOWN) {
  if (error?.isRatePlanValidation || error?.name === 'RatePlanFormError') {
    const msg = typeof error.message === 'string' ? error.message.trim() : '';
    return msg || SAFE_ERROR_MESSAGES.VALIDATION;
  }

  const code = error?.response?.data?.code;
  if (code === 'STALE_REVISION') return SAFE_ERROR_MESSAGES.STALE_REVISION;
  if (code === 'SEASONAL_OVERLAP') return SAFE_ERROR_MESSAGES.SEASONAL_OVERLAP;
  if (code === 'ACTIVATION_BUSY') return SAFE_ERROR_MESSAGES.ACTIVATION_BUSY;
  if (code === 'ACTIVATION_LOCK_UNCERTAIN') return SAFE_ERROR_MESSAGES.ACTIVATION_LOCK_UNCERTAIN;
  if (code === 'NOT_FOUND') return SAFE_ERROR_MESSAGES.NOT_FOUND;
  if (typeof code === 'string' && AUTH_CODES.includes(code)) {
    return SAFE_ERROR_MESSAGES.AUTH;
  }
  if (typeof code === 'string' && VALIDATION_CODES.includes(code)) {
    return SAFE_ERROR_MESSAGES.VALIDATION;
  }

  const status = error?.response?.status;
  if (status === 401 || status === 403) return SAFE_ERROR_MESSAGES.AUTH;
  if (status === 404) return SAFE_ERROR_MESSAGES.NOT_FOUND;
  if (status === 400 || status === 422) return SAFE_ERROR_MESSAGES.VALIDATION;

  if (error?.code === 'ERR_NETWORK' || error?.message === 'Network Error') {
    return SAFE_ERROR_MESSAGES.NETWORK;
  }

  return SAFE_ERROR_MESSAGES.UNKNOWN;
}

export function describeActivationResult(data) {
  const committed = data?.activationCommitted === true;
  const lockReleased = data?.lockReleased === true;
  const warnings = Array.isArray(data?.operationalWarnings) ? data.operationalWarnings : [];
  const hasCleanupWarning = warnings.some((w) => w && w.code === 'ACTIVATION_LOCK_RELEASE_FAILED');
  return {
    committed,
    lockReleased,
    hasCleanupWarning,
    successMessage: committed
      ? hasCleanupWarning && !lockReleased
        ? 'Rate plan activated. Operational warning: activation lock cleanup failed — contact ops; do not retry activation.'
        : 'Rate plan activated.'
      : 'Activation response was incomplete.'
  };
}

export function statusBadgeClass(status) {
  if (status === 'active') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (status === 'retired') return 'bg-gray-100 text-gray-600 border-gray-200';
  return 'bg-amber-50 text-amber-900 border-amber-200';
}

export function formatWindow(plan) {
  if (!plan) return '—';
  if (plan.type === 'fixed_package') {
    const a = dateOnly(plan.packageArrivalDate);
    const d = dateOnly(plan.packageDepartureDate);
    return a && d ? `${a} → ${d}` : '—';
  }
  const a = dateOnly(plan.arrivalWindowStart);
  const b = dateOnly(plan.arrivalWindowEnd);
  return a && b ? `${a} → ${b}` : '—';
}

export { emptyAccommodation };
