'use strict';

const mongoose = require('mongoose');
const BuildEnquiry = require('../../models/BuildEnquiry');
const { SOURCE } = require('./buildEnquiryConstants');
const { validateBuildEnquiryCreateInput } = require('./buildEnquiryValidation');
const { attemptInitialBuildEnquiryEmails } = require('./buildEnquiryEmailService');

function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  return /E11000|duplicate key/i.test(String(err.message || ''));
}

function formatDateStamp(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Preallocate ObjectId, then derive projectReference before insert.
 * Format: BD-YYYYMMDD-XXXXXXXXXXXX (last 12 hex of ObjectId, uppercased).
 */
function buildProjectReference(objectId, now = new Date()) {
  const idStr = String(objectId);
  const suffix = idStr.slice(-12).toUpperCase();
  return `BD-${formatDateStamp(now)}-${suffix}`;
}

function toPublicResult(doc, { duplicate }) {
  return {
    success: true,
    data: {
      projectReference: doc.projectReference,
      enquiryId: String(doc._id),
      duplicate: Boolean(duplicate)
    }
  };
}

async function findByIdempotencyKey(idempotencyKey) {
  return BuildEnquiry.findOne({ idempotencyKey }).lean();
}

/**
 * Persist a build enquiry. Idempotent on idempotencyKey only.
 * On first create only, attempts internal + customer emails after persist.
 * Email failures never fail the create result.
 *
 * @returns {{ kind: 'honeypot' } | { kind: 'validation', errors: string[] } | { kind: 'created'|'replay', result: object, doc: object }}
 */
async function createBuildEnquiry(
  rawBody,
  { isTest = false, emailService = null, skipEmail = false } = {}
) {
  const validated = validateBuildEnquiryCreateInput(rawBody);
  if (validated.honeypot) {
    return { kind: 'honeypot' };
  }
  if (!validated.ok) {
    return { kind: 'validation', errors: validated.errors };
  }

  const input = validated.value;
  const existing = await findByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return {
      kind: 'replay',
      result: toPublicResult(existing, { duplicate: true }),
      doc: existing
    };
  }

  const _id = new mongoose.Types.ObjectId();
  const projectReference = buildProjectReference(_id);
  const now = new Date();

  const docPayload = {
    _id,
    projectReference,
    idempotencyKey: input.idempotencyKey,
    contact: input.contact,
    project: input.project,
    config: input.config,
    estimate: input.estimate,
    configMeta: input.configMeta,
    attribution: input.attribution,
    sessionKey: input.sessionKey,
    visitorKey: input.visitorKey,
    source: SOURCE,
    status: 'new',
    emails: {
      internal: { status: 'pending', attemptCount: 0, maxAttempts: 10, nextAttemptAt: now },
      customer: { status: 'pending', attemptCount: 0, maxAttempts: 10, nextAttemptAt: now }
    },
    isTest: Boolean(isTest)
  };

  try {
    const created = await BuildEnquiry.create(docPayload);
    const lean = created.toObject ? created.toObject() : created;

    if (!skipEmail) {
      try {
        await attemptInitialBuildEnquiryEmails(lean._id, { emailService });
      } catch (emailErr) {
        console.error(
          '[build-enquiries] initial email attempt failed',
          emailErr?.message || emailErr
        );
      }
    }

    return {
      kind: 'created',
      result: toPublicResult(lean, { duplicate: false }),
      doc: lean
    };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const raced = await findByIdempotencyKey(input.idempotencyKey);
      if (raced) {
        return {
          kind: 'replay',
          result: toPublicResult(raced, { duplicate: true }),
          doc: raced
        };
      }
    }
    throw err;
  }
}

module.exports = {
  createBuildEnquiry,
  buildProjectReference,
  findByIdempotencyKey,
  isDuplicateKeyError
};
