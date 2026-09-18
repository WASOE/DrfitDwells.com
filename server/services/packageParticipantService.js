/**
 * Package participant classification (B4).
 *
 * Age is calculated on the package arrival date (date-only calendar math).
 * Client-selected age categories and prices are never trusted.
 */
'use strict';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const CATEGORY_INFANT = 'infant';
const CATEGORY_CHILD = 'child';
const CATEGORY_ADULT = 'adult';

class PackageParticipantError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'PackageParticipantError';
    this.code = code;
    this.details = details;
  }
}

function parseDateOnly(input, field) {
  if (input == null || input === '') {
    throw new PackageParticipantError('MISSING_DATE', `${field} is required`);
  }
  let s;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new PackageParticipantError('INVALID_DATE', `${field} is invalid`);
    }
    const y = input.getUTCFullYear();
    const m = String(input.getUTCMonth() + 1).padStart(2, '0');
    const d = String(input.getUTCDate()).padStart(2, '0');
    s = `${y}-${m}-${d}`;
  } else {
    s = String(input).trim().slice(0, 10);
  }
  if (!DATE_ONLY_RE.test(s)) {
    throw new PackageParticipantError('INVALID_DATE', `${field} must be YYYY-MM-DD`);
  }
  const [yy, mm, dd] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) {
    throw new PackageParticipantError('INVALID_DATE', `${field} is not a real calendar date`);
  }
  return s;
}

function compareDateOnly(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Whole years of age on `onDate` (YYYY-MM-DD), using calendar birthday boundary.
 */
function ageOnArrivalDate(dateOfBirth, arrivalDate) {
  const dob = parseDateOnly(dateOfBirth, 'dateOfBirth');
  const on = parseDateOnly(arrivalDate, 'arrivalDate');
  const [by, bm, bd] = dob.split('-').map(Number);
  const [ay, am, ad] = on.split('-').map(Number);
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) {
    age -= 1;
  }
  return age;
}

function categoryFromAge(age) {
  if (!Number.isInteger(age) || age < 0) {
    throw new PackageParticipantError('INVALID_AGE', 'Calculated age is invalid');
  }
  if (age <= 3) return CATEGORY_INFANT;
  if (age <= 12) return CATEGORY_CHILD;
  return CATEGORY_ADULT;
}

function normalizeFullName(fullName) {
  if (fullName == null) return '';
  return String(fullName).trim().replace(/\s+/g, ' ');
}

function participantDedupeKey(fullName, dateOfBirth) {
  return `${normalizeFullName(fullName).toLowerCase()}|${dateOfBirth}`;
}

/**
 * Classify a raw participant list for a package arrival date.
 * Ignores client category / price fields; never trusts them.
 *
 * @param {Array<{ fullName: string, dateOfBirth: string }>} participants
 * @param {string} arrivalDate YYYY-MM-DD
 * @param {{ todayDateOnly?: string }} [opts] - for rejecting future DOBs vs "today"
 */
function classifyPackageParticipants(participants, arrivalDate, opts = {}) {
  const arrival = parseDateOnly(arrivalDate, 'arrivalDate');
  const today =
    opts.todayDateOnly != null
      ? parseDateOnly(opts.todayDateOnly, 'todayDateOnly')
      : null;

  if (!Array.isArray(participants) || participants.length === 0) {
    throw new PackageParticipantError(
      'PARTICIPANTS_REQUIRED',
      'At least one participant is required'
    );
  }

  const seen = new Set();
  const classified = [];

  for (let i = 0; i < participants.length; i += 1) {
    const raw = participants[i];
    if (!raw || typeof raw !== 'object') {
      throw new PackageParticipantError(
        'INVALID_PARTICIPANT',
        `participants[${i}] must be an object`
      );
    }

    // Never trust client classification / pricing fields.
    void raw.isAdult;
    void raw.isChild;
    void raw.isInfant;
    void raw.ageCategory;
    void raw.category;
    void raw.price;
    void raw.amount;
    void raw.participantPrice;

    const fullName = normalizeFullName(raw.fullName);
    if (!fullName) {
      throw new PackageParticipantError(
        'MISSING_FULL_NAME',
        `participants[${i}].fullName is required`
      );
    }

    let dob;
    try {
      dob = parseDateOnly(raw.dateOfBirth, `participants[${i}].dateOfBirth`);
    } catch (err) {
      if (err instanceof PackageParticipantError && err.code === 'MISSING_DATE') {
        throw new PackageParticipantError(
          'MISSING_DATE_OF_BIRTH',
          `participants[${i}].dateOfBirth is required`
        );
      }
      throw err;
    }

    if (today && compareDateOnly(dob, today) > 0) {
      throw new PackageParticipantError(
        'FUTURE_DATE_OF_BIRTH',
        `participants[${i}].dateOfBirth cannot be in the future`
      );
    }
    if (compareDateOnly(dob, arrival) > 0) {
      throw new PackageParticipantError(
        'FUTURE_DATE_OF_BIRTH',
        `participants[${i}].dateOfBirth cannot be after package arrival`
      );
    }

    const key = participantDedupeKey(fullName, dob);
    if (seen.has(key)) {
      throw new PackageParticipantError(
        'DUPLICATE_PARTICIPANT',
        `Duplicate participant: ${fullName} (${dob})`
      );
    }
    seen.add(key);

    const ageOnArrival = ageOnArrivalDate(dob, arrival);
    const category = categoryFromAge(ageOnArrival);

    classified.push({
      fullName,
      dateOfBirth: dob,
      ageOnArrival,
      category
    });
  }

  const adults = classified.filter((p) => p.category === CATEGORY_ADULT).length;
  const children = classified.filter((p) => p.category === CATEGORY_CHILD).length;
  const infants = classified.filter((p) => p.category === CATEGORY_INFANT).length;

  return {
    participants: classified,
    counts: {
      adults,
      children,
      infants,
      total: classified.length
    }
  };
}

/**
 * Eligibility for hosted packages by RatePlan code family.
 */
function assertPackageEligibility(planCode, counts) {
  const code = String(planCode || '')
    .trim()
    .toLowerCase();
  const adults = counts.adults || 0;
  const children = counts.children || 0;
  const infants = counts.infants || 0;

  if (code === 'parent-child' || code.startsWith('parent-child-')) {
    if (children < 1) {
      throw new PackageParticipantError(
        'PARENT_CHILD_REQUIRES_CHILD',
        'Parent & Child requires at least one child aged 4 to 12'
      );
    }
    if (adults < 1) {
      throw new PackageParticipantError(
        'PARENT_CHILD_REQUIRES_ADULT',
        'Parent & Child requires at least one adult-priced participant'
      );
    }
    // Infants may join but cannot replace the required child (already enforced by children >= 1).
    void infants;
    return { kind: 'parent_child' };
  }

  // Christmas and future hosted packages: at least one adult-priced participant.
  if (adults < 1) {
    throw new PackageParticipantError(
      'PACKAGE_REQUIRES_ADULT',
      'This package requires at least one adult-priced participant'
    );
  }
  return { kind: code === 'christmas' || code.startsWith('christmas-') ? 'christmas' : 'hosted_package' };
}

function assertCapacity(counts, capacityMax) {
  const max = Number(capacityMax);
  if (!Number.isInteger(max) || max < 1) {
    throw new PackageParticipantError('INVALID_CAPACITY', 'Accommodation capacity is invalid');
  }
  const used = counts.total;
  if (used > max) {
    throw new PackageParticipantError(
      'CAPACITY_EXCEEDED',
      `This stay can only accommodate ${max} guests (including infants)`
    );
  }
  return { capacityUsed: used, capacityMaximum: max };
}

module.exports = {
  PackageParticipantError,
  CATEGORY_INFANT,
  CATEGORY_CHILD,
  CATEGORY_ADULT,
  parseDateOnly,
  ageOnArrivalDate,
  categoryFromAge,
  normalizeFullName,
  classifyPackageParticipants,
  assertPackageEligibility,
  assertCapacity
};
