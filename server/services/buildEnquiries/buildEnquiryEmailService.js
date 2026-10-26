'use strict';

const BuildEnquiry = require('../../models/BuildEnquiry');
const { htmlEscape } = require('../../utils/htmlEscape');
const {
  buildDetailRowsTable,
  buildGuestTransactionalHtml,
  buildInternalNotificationHtml,
  GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS,
  INTERNAL_NOTIFICATION_EXTRA_CSS
} = require('../emailTemplates/guestLifecycleLayout');
const {
  EMAIL_LANES,
  EMAIL_VISIBILITY_TIMEOUT_MS,
  MODEL_DISPLAY_NAMES,
  OPTION_DISPLAY_NAMES,
  LAND_STATUSES,
  BUDGET_BANDS,
  TIMELINE_BANDS
} = require('./buildEnquiryConstants');

const SITE_ORIGIN = (process.env.APP_URL || 'https://driftdwells.com').replace(/\/$/, '');
const SUPPORT_CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'jose@driftdwells.com';

let emailServiceRef = null;

function getEmailService(override = null) {
  if (override) return override;
  if (emailServiceRef) return emailServiceRef;
  emailServiceRef = require('../emailService');
  return emailServiceRef;
}

/** Test seam — inject mock EmailService. */
function __setEmailServiceForTesting(svc) {
  emailServiceRef = svc || null;
}

function resolveInternalRecipient() {
  const to = process.env.ADMIN_EMAIL || process.env.BOOKING_NOTIFICATION_EMAIL;
  return to && String(to).trim() ? String(to).trim() : null;
}

function radioToObject(radio) {
  if (!radio) return {};
  if (radio instanceof Map) return Object.fromEntries(radio);
  if (typeof radio.toObject === 'function') return radio.toObject();
  return { ...radio };
}

function optionLabel(id) {
  return OPTION_DISPLAY_NAMES[id] || id;
}

function modelLabel(modelId) {
  return MODEL_DISPLAY_NAMES[modelId] || modelId;
}

function enumLabel(value, allowed) {
  if (!allowed.includes(value)) return value;
  return String(value).replace(/_/g, ' ');
}

function buildConfigSummaryLines(enquiry) {
  const config = enquiry.config || {};
  const lines = [`Model: ${modelLabel(config.modelId)}`];
  if (config.customDimensions?.length && config.customDimensions?.width) {
    lines.push(
      `Custom size: ${config.customDimensions.length} m × ${config.customDimensions.width} m`
    );
  }
  const radio = radioToObject(config.radio);
  for (const [category, optionId] of Object.entries(radio)) {
    lines.push(`${category}: ${optionLabel(optionId)}`);
  }
  const toggles = Array.isArray(config.toggles) ? config.toggles : [];
  if (toggles.length) {
    lines.push(`Options: ${toggles.map(optionLabel).join(', ')}`);
  }
  if (enquiry.configMeta?.isPartial) {
    lines.push('Note: configuration may be incomplete.');
  }
  return lines;
}

function formatIndicativeEstimate(estimate) {
  if (!estimate) return 'Not provided';
  if (estimate.displayLabel) return String(estimate.displayLabel);
  if (estimate.totalEur != null && Number.isFinite(Number(estimate.totalEur))) {
    const prefix = estimate.hasConsultationItems ? 'From ' : '';
    return `${prefix}€${Number(estimate.totalEur).toLocaleString('en-GB')}`;
  }
  return 'Not provided';
}

function resolveBrandLogoAbsoluteUrl() {
  const explicit = (process.env.EMAIL_BRAND_LOGO_URL || '').trim();
  if (explicit.startsWith('http')) return explicit;
  const path = (process.env.EMAIL_BRAND_LOGO_PATH || '/uploads/Logo/DRIFTS-01.png').trim();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const publicOrigin = (process.env.EMAIL_PUBLIC_ASSET_ORIGIN || SITE_ORIGIN).replace(/\/$/, '');
  return `${publicOrigin}${normalized}`;
}

function buildInternalEmailContent(enquiry) {
  const contact = enquiry.contact || {};
  const project = enquiry.project || {};
  const estimateLabel = formatIndicativeEstimate(enquiry.estimate);
  const configLines = buildConfigSummaryLines(enquiry);

  const rows = [
    { label: 'Project reference', valueHtml: htmlEscape(enquiry.projectReference) },
    { label: 'Name', valueHtml: htmlEscape(contact.name) },
    { label: 'Email', valueHtml: htmlEscape(contact.email) },
    { label: 'Phone', valueHtml: htmlEscape(contact.phone || '—') },
    { label: 'Location', valueHtml: htmlEscape(project.location) },
    {
      label: 'Land status',
      valueHtml: htmlEscape(enumLabel(project.landStatus, LAND_STATUSES))
    },
    { label: 'Budget', valueHtml: htmlEscape(enumLabel(project.budget, BUDGET_BANDS)) },
    {
      label: 'Timeline',
      valueHtml: htmlEscape(enumLabel(project.timeline, TIMELINE_BANDS))
    },
    {
      label: 'Indicative estimate (unverified)',
      valueHtml: htmlEscape(estimateLabel)
    },
    {
      label: 'Configuration',
      valueHtml: htmlEscape(configLines.join(' · '))
    }
  ];
  if (project.message) {
    rows.push({ label: 'Message', valueHtml: htmlEscape(project.message) });
  }

  const bodyHtml = `
    <p class="lede">A new /build cabin enquiry was submitted.</p>
    ${buildDetailRowsTable(rows)}
    <p style="margin-top:18px;font-size:13px;color:#6a6860;">Enquiry id: ${htmlEscape(
      String(enquiry._id)
    )}</p>
  `;

  const html = buildInternalNotificationHtml({
    title: `Build enquiry ${enquiry.projectReference}`,
    preheader: `New build enquiry from ${contact.name || contact.email}`,
    logoUrl: resolveBrandLogoAbsoluteUrl(),
    siteHomeUrl: SITE_ORIGIN,
    headerAccentColor: '#b0aea6',
    headerLogoWidth: 160,
    headerTagline:
      '<span class="email-kicker">Inbox</span><span class="email-tagline-lead">Build enquiry.</span>',
    bodyHtml,
    extraHeadCss: INTERNAL_NOTIFICATION_EXTRA_CSS,
    footerHtml: `<div class="footer"><p>Drift &amp; Dwells internal notification</p></div>`
  });

  const text = [
    'New /build cabin enquiry',
    `Project reference: ${enquiry.projectReference}`,
    `Name: ${contact.name}`,
    `Email: ${contact.email}`,
    `Phone: ${contact.phone || '—'}`,
    `Location: ${project.location}`,
    `Land: ${project.landStatus}`,
    `Budget: ${project.budget}`,
    `Timeline: ${project.timeline}`,
    `Indicative estimate (unverified): ${estimateLabel}`,
    ...configLines,
    project.message ? `Message: ${project.message}` : null,
    `Enquiry id: ${enquiry._id}`
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject: `Build enquiry ${enquiry.projectReference} — ${contact.name || contact.email}`,
    html,
    text
  };
}

function buildCustomerEmailContent(enquiry) {
  const contact = enquiry.contact || {};
  const estimateLabel = formatIndicativeEstimate(enquiry.estimate);
  const configLines = buildConfigSummaryLines(enquiry);
  const safeName = htmlEscape(contact.name || 'there');
  const safeRef = htmlEscape(enquiry.projectReference);
  const safeEstimate = htmlEscape(estimateLabel);
  const safeSupport = htmlEscape(SUPPORT_CONTACT_EMAIL);

  const configRows = configLines.map((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return { label: 'Detail', valueHtml: htmlEscape(line) };
    return {
      label: line.slice(0, idx),
      valueHtml: htmlEscape(line.slice(idx + 1).trim())
    };
  });

  const bodyHtml = `
    <p class="lede">Hi ${safeName},</p>
    <p>Thank you for sharing your cabin project with Drift &amp; Dwells. We have received your enquiry.</p>
    <p><strong>Project reference:</strong> ${safeRef}</p>
    <p>Please keep this reference handy if you write to us.</p>
    <h3 style="margin:22px 0 10px;font-family:'Playfair Display',Georgia,serif;font-size:18px;">Your configuration</h3>
    ${buildDetailRowsTable(configRows)}
    <p style="margin-top:18px;"><strong>Indicative estimate:</strong> ${safeEstimate}</p>
    <p style="font-size:14px;color:#5c5b56;">This figure is indicative only, based on what you selected in the configurator. It is not a binding quote. Final pricing is confirmed together after we review your site and requirements.</p>
    <div class="guidance-section">
      <h3>Next steps</h3>
      <ul style="margin:8px 0 0;padding-left:20px;">
        <li>Our team will review your enquiry and follow up by email.</li>
        <li>Reply to this message (or write to ${safeSupport}) with any extra details.</li>
        <li>If you would like, you can also schedule a free consultation from the Drift &amp; Dwells website.</li>
      </ul>
    </div>
  `;

  const year = new Date().getFullYear();
  const footerHtml = `
          <div class="footer">
            <p class="footer-tagline">Off-grid eco-retreat · Bulgaria</p>
            <p class="footer-home"><a href="${htmlEscape(SITE_ORIGIN)}">driftdwells.com</a></p>
            <p><a href="mailto:${safeSupport}">${safeSupport}</a></p>
            <p class="footer-legal">© ${year} Drift &amp; Dwells</p>
          </div>`;

  const html = buildGuestTransactionalHtml({
    title: `We received your build enquiry (${enquiry.projectReference})`,
    preheader: `Project reference ${enquiry.projectReference}`,
    logoUrl: resolveBrandLogoAbsoluteUrl(),
    siteHomeUrl: SITE_ORIGIN,
    headerTagline:
      '<p style="margin:0;font-family:Inter,sans-serif;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#7a7870;">Build enquiry received</p>',
    bodyHtml,
    extraHeadCss: GUEST_LIFECYCLE_RECEIVED_EXTRA_CSS,
    footerHtml
  });

  const text = [
    `Hi ${contact.name || 'there'},`,
    '',
    'Thank you for sharing your cabin project with Drift & Dwells. We have received your enquiry.',
    `Project reference: ${enquiry.projectReference}`,
    '',
    'Your configuration:',
    ...configLines.map((l) => `- ${l}`),
    '',
    `Indicative estimate: ${estimateLabel}`,
    'This figure is indicative only and is not a binding quote.',
    '',
    'Next steps:',
    '- Our team will review your enquiry and follow up by email.',
    `- Reply to this message or write to ${SUPPORT_CONTACT_EMAIL} with any extra details.`,
    '- You can also schedule a free consultation from the Drift & Dwells website.',
    '',
    `© ${year} Drift & Dwells`
  ].join('\n');

  return {
    subject: `We received your Drift & Dwells build enquiry (${enquiry.projectReference})`,
    html,
    text
  };
}

function computeNextAttemptAt(attemptCount, now = new Date()) {
  const capped = Math.min(24 * 60, 5 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + capped * 60 * 1000);
}

function lanePath(lane, field) {
  return `emails.${lane}.${field}`;
}

/**
 * Atomically claim a lane for send. Supports:
 * - pending/failed when nextAttemptAt is due (or null for not-yet-scheduled)
 * - expired sending claims (visibilityTimeoutAt <= now) for future worker recovery
 *
 * Exhausted lanes (attemptCount >= maxAttempts) are never claimable, even when
 * nextAttemptAt is null. The attemptCount < maxAttempts check is enforced in the
 * same MongoDB filter as the status/lease predicates ($expr), so the limit cannot
 * be bypassed by a concurrent claimer.
 *
 * At-least-once note: if SMTP accepts a message and the process crashes before
 * status is marked succeeded, an expired sending lease may be reclaimed and the
 * message resent (duplicate delivery). No outbox/dedupe layer is added here.
 */
async function claimBuildEnquiryEmailLane({
  enquiryId,
  lane,
  workerId = 'initial',
  now = new Date(),
  visibilityTimeoutMs = EMAIL_VISIBILITY_TIMEOUT_MS
} = {}) {
  if (!EMAIL_LANES.includes(lane)) {
    throw new Error(`Unknown email lane: ${lane}`);
  }
  const at = now instanceof Date ? now : new Date(now);
  const vt = new Date(at.getTime() + visibilityTimeoutMs);
  const wid = String(workerId || 'initial').slice(0, 120);
  const attemptCountPath = `$emails.${lane}.attemptCount`;
  const maxAttemptsPath = `$emails.${lane}.maxAttempts`;

  return BuildEnquiry.findOneAndUpdate(
    {
      _id: enquiryId,
      $and: [
        {
          $expr: {
            $lt: [
              { $ifNull: [attemptCountPath, 0] },
              { $ifNull: [maxAttemptsPath, 10] }
            ]
          }
        },
        {
          $or: [
            {
              [lanePath(lane, 'status')]: { $in: ['pending', 'failed'] },
              $or: [
                { [lanePath(lane, 'nextAttemptAt')]: null },
                { [lanePath(lane, 'nextAttemptAt')]: { $lte: at } }
              ]
            },
            {
              [lanePath(lane, 'status')]: 'sending',
              [lanePath(lane, 'visibilityTimeoutAt')]: { $lte: at }
            }
          ]
        }
      ]
    },
    {
      $set: {
        [lanePath(lane, 'status')]: 'sending',
        [lanePath(lane, 'claimedBy')]: wid,
        [lanePath(lane, 'claimedAt')]: at,
        [lanePath(lane, 'visibilityTimeoutAt')]: vt,
        [lanePath(lane, 'smtpAttemptStartedAt')]: null,
        [lanePath(lane, 'lastError')]: null
      },
      $inc: { [lanePath(lane, 'attemptCount')]: 1 }
    },
    { new: true }
  );
}

async function markBuildEnquiryEmailSucceeded({
  enquiryId,
  lane,
  providerMessageId = null,
  now = new Date()
} = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const $set = {
    [lanePath(lane, 'status')]: 'succeeded',
    [lanePath(lane, 'claimedBy')]: null,
    [lanePath(lane, 'claimedAt')]: null,
    [lanePath(lane, 'visibilityTimeoutAt')]: null,
    [lanePath(lane, 'smtpAttemptStartedAt')]: null,
    [lanePath(lane, 'nextAttemptAt')]: null,
    [lanePath(lane, 'lastError')]: null
  };
  if (providerMessageId) {
    $set[lanePath(lane, 'providerMessageId')] = String(providerMessageId).slice(0, 500);
  }
  return BuildEnquiry.findOneAndUpdate({ _id: enquiryId }, { $set }, { new: true });
}

async function markBuildEnquiryEmailFailed({
  enquiryId,
  lane,
  error,
  now = new Date()
} = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const doc = await BuildEnquiry.findById(enquiryId).lean();
  if (!doc) return null;
  const laneState = doc.emails?.[lane] || {};
  const attemptCount = Number(laneState.attemptCount) || 0;
  const maxAttempts = Number(laneState.maxAttempts) || 10;
  const exhausted = attemptCount >= maxAttempts;
  const summary = String(error || 'send_failed').slice(0, 500);

  return BuildEnquiry.findOneAndUpdate(
    { _id: enquiryId },
    {
      $set: {
        [lanePath(lane, 'status')]: 'failed',
        [lanePath(lane, 'claimedBy')]: null,
        [lanePath(lane, 'claimedAt')]: null,
        [lanePath(lane, 'visibilityTimeoutAt')]: null,
        [lanePath(lane, 'smtpAttemptStartedAt')]: null,
        [lanePath(lane, 'lastError')]: summary,
        [lanePath(lane, 'nextAttemptAt')]: exhausted ? null : computeNextAttemptAt(attemptCount, at)
      }
    },
    { new: true }
  );
}

/**
 * Mark an expired sending lease that has already exhausted attempts.
 * Does not send mail. Safe under concurrent workers via status=sending filter.
 */
async function markBuildEnquiryEmailNeedsManual({
  enquiryId,
  lane,
  error = 'expired_lease_exhausted',
  now = new Date()
} = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const summary = String(error || 'expired_lease_exhausted').slice(0, 500);
  const attemptCountPath = `$emails.${lane}.attemptCount`;
  const maxAttemptsPath = `$emails.${lane}.maxAttempts`;

  return BuildEnquiry.findOneAndUpdate(
    {
      _id: enquiryId,
      [lanePath(lane, 'status')]: 'sending',
      [lanePath(lane, 'visibilityTimeoutAt')]: { $lte: at },
      $expr: {
        $gte: [
          { $ifNull: [attemptCountPath, 0] },
          { $ifNull: [maxAttemptsPath, 10] }
        ]
      }
    },
    {
      $set: {
        [lanePath(lane, 'status')]: 'needs_manual',
        [lanePath(lane, 'claimedBy')]: null,
        [lanePath(lane, 'claimedAt')]: null,
        [lanePath(lane, 'visibilityTimeoutAt')]: null,
        [lanePath(lane, 'smtpAttemptStartedAt')]: null,
        [lanePath(lane, 'nextAttemptAt')]: null,
        [lanePath(lane, 'lastError')]: summary
      }
    },
    { new: true }
  );
}

function buildClaimableLaneMatch(lane, now) {
  const at = now instanceof Date ? now : new Date(now);
  const attemptCountPath = `$emails.${lane}.attemptCount`;
  const maxAttemptsPath = `$emails.${lane}.maxAttempts`;
  return {
    $and: [
      {
        $expr: {
          $lt: [
            { $ifNull: [attemptCountPath, 0] },
            { $ifNull: [maxAttemptsPath, 10] }
          ]
        }
      },
      {
        $or: [
          {
            [lanePath(lane, 'status')]: { $in: ['pending', 'failed'] },
            $or: [
              { [lanePath(lane, 'nextAttemptAt')]: null },
              { [lanePath(lane, 'nextAttemptAt')]: { $lte: at } }
            ]
          },
          {
            [lanePath(lane, 'status')]: 'sending',
            [lanePath(lane, 'visibilityTimeoutAt')]: { $lte: at }
          }
        ]
      }
    ]
  };
}

function buildExhaustedExpiredSendingMatch(lane, now) {
  const at = now instanceof Date ? now : new Date(now);
  const attemptCountPath = `$emails.${lane}.attemptCount`;
  const maxAttemptsPath = `$emails.${lane}.maxAttempts`;
  return {
    [lanePath(lane, 'status')]: 'sending',
    [lanePath(lane, 'visibilityTimeoutAt')]: { $lte: at },
    $expr: {
      $gte: [
        { $ifNull: [attemptCountPath, 0] },
        { $ifNull: [maxAttemptsPath, 10] }
      ]
    }
  };
}

/**
 * Scan due claimable work for one lane (pending/failed due or expired sending under max).
 */
async function findDueBuildEnquiryEmailCandidates(lane, { now = new Date(), limit = 20 } = {}) {
  if (!EMAIL_LANES.includes(lane)) {
    throw new Error(`Unknown email lane: ${lane}`);
  }
  const capped = Math.min(100, Math.max(1, Number(limit) || 20));
  return BuildEnquiry.find(buildClaimableLaneMatch(lane, now))
    .sort({ updatedAt: 1 })
    .limit(capped)
    .select('_id projectReference emails')
    .lean();
}

/**
 * Scan expired sending leases that already hit maxAttempts (manual intervention, no resend).
 */
async function findExhaustedExpiredSendingLanes(lane, { now = new Date(), limit = 20 } = {}) {
  if (!EMAIL_LANES.includes(lane)) {
    throw new Error(`Unknown email lane: ${lane}`);
  }
  const capped = Math.min(100, Math.max(1, Number(limit) || 20));
  return BuildEnquiry.find(buildExhaustedExpiredSendingMatch(lane, now))
    .sort({ updatedAt: 1 })
    .limit(capped)
    .select('_id projectReference emails')
    .lean();
}

async function markSmtpAttemptStarted({ enquiryId, lane, now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  return BuildEnquiry.findOneAndUpdate(
    {
      _id: enquiryId,
      [lanePath(lane, 'status')]: 'sending',
      [lanePath(lane, 'smtpAttemptStartedAt')]: null
    },
    { $set: { [lanePath(lane, 'smtpAttemptStartedAt')]: at } },
    { new: true }
  );
}

function isDefinitiveSendSuccess(result) {
  if (!result || result.success !== true) return false;
  // 'logged' means SMTP was not configured — treat as failure so a worker can retry.
  if (result.method === 'logged') return false;
  if (result.method === 'unavailable') return false;
  return true;
}

async function sendLaneEmail(enquiry, lane, emailService) {
  if (lane === 'internal') {
    const to = resolveInternalRecipient();
    if (!to) {
      return { success: false, method: 'unavailable', error: 'no_admin_email' };
    }
    const content = buildInternalEmailContent(enquiry);
    return emailService.sendEmail({
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      trigger: 'build_enquiry_internal',
      skipIdempotencyWindow: true,
      omitBodyFromLogs: true,
      postmarkTag: 'build_enquiry_internal',
      postmarkMetadata: {
        enquiryId: String(enquiry._id),
        projectReference: enquiry.projectReference
      },
      onProviderAttemptStarted: async () => {
        await markSmtpAttemptStarted({ enquiryId: enquiry._id, lane: 'internal' });
      }
    });
  }

  const to = enquiry.contact?.email;
  if (!to) {
    return { success: false, method: 'unavailable', error: 'missing_customer_email' };
  }
  const content = buildCustomerEmailContent(enquiry);
  return emailService.sendEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    trigger: 'build_enquiry_customer',
    skipIdempotencyWindow: true,
    omitBodyFromLogs: true,
    postmarkTag: 'build_enquiry_customer',
    postmarkMetadata: {
      enquiryId: String(enquiry._id),
      projectReference: enquiry.projectReference
    },
    onProviderAttemptStarted: async () => {
      await markSmtpAttemptStarted({ enquiryId: enquiry._id, lane: 'customer' });
    }
  });
}

/**
 * Claim + send + persist status for one lane. Never throws for send failures.
 * Persistence errors are returned in result.persistenceError (does not throw).
 */
async function attemptBuildEnquiryEmailLane(enquiryId, lane, { emailService = null, workerId = 'initial' } = {}) {
  const svc = getEmailService(emailService);
  const claimed = await claimBuildEnquiryEmailLane({ enquiryId, lane, workerId });
  if (!claimed) {
    return { lane, skipped: true, reason: 'not_claimable' };
  }

  let sendResult;
  try {
    sendResult = await sendLaneEmail(claimed, lane, svc);
  } catch (err) {
    sendResult = {
      success: false,
      method: 'failed',
      error: err?.message || 'send_threw'
    };
  }

  try {
    if (isDefinitiveSendSuccess(sendResult)) {
      await markBuildEnquiryEmailSucceeded({
        enquiryId,
        lane,
        providerMessageId: sendResult.messageId || null
      });
      return { lane, skipped: false, status: 'succeeded', sendResult };
    }
    await markBuildEnquiryEmailFailed({
      enquiryId,
      lane,
      error: sendResult.error || sendResult.method || 'send_failed'
    });
    return { lane, skipped: false, status: 'failed', sendResult };
  } catch (persistErr) {
    console.error('[build-enquiries] email status persistence failed', {
      enquiryId: String(enquiryId),
      lane,
      error: persistErr?.message || persistErr
    });
    return {
      lane,
      skipped: false,
      status: 'persistence_failed',
      sendResult,
      persistenceError: persistErr?.message || String(persistErr)
    };
  }
}

/**
 * After a successful create only. Independent attempts for internal + customer.
 */
async function attemptInitialBuildEnquiryEmails(enquiryId, { emailService = null } = {}) {
  const internal = await attemptBuildEnquiryEmailLane(enquiryId, 'internal', {
    emailService,
    workerId: 'initial'
  });
  const customer = await attemptBuildEnquiryEmailLane(enquiryId, 'customer', {
    emailService,
    workerId: 'initial'
  });
  return { internal, customer };
}

module.exports = {
  attemptInitialBuildEnquiryEmails,
  attemptBuildEnquiryEmailLane,
  claimBuildEnquiryEmailLane,
  markBuildEnquiryEmailSucceeded,
  markBuildEnquiryEmailFailed,
  markBuildEnquiryEmailNeedsManual,
  markSmtpAttemptStarted,
  findDueBuildEnquiryEmailCandidates,
  findExhaustedExpiredSendingLanes,
  buildClaimableLaneMatch,
  buildExhaustedExpiredSendingMatch,
  computeNextAttemptAt,
  buildInternalEmailContent,
  buildCustomerEmailContent,
  resolveInternalRecipient,
  isDefinitiveSendSuccess,
  __setEmailServiceForTesting
};
