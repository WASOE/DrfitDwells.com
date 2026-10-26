'use strict';

const mongoose = require('mongoose');
const BuildEnquiry = require('../../../models/BuildEnquiry');
const {
  ENQUIRY_STATUSES,
  MODEL_DISPLAY_NAMES,
  OPTION_DISPLAY_NAMES
} = require('../../buildEnquiries/buildEnquiryConstants');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePage(raw) {
  const n = Number.parseInt(String(raw || '1'), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 10000);
}

function parseLimit(raw) {
  const n = Number.parseInt(String(raw || String(DEFAULT_LIMIT)), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function radioToObject(radio) {
  if (!radio) return {};
  if (radio instanceof Map) return Object.fromEntries(radio);
  if (typeof radio.toObject === 'function') return radio.toObject();
  return { ...radio };
}

function modelLabel(modelId) {
  return MODEL_DISPLAY_NAMES[modelId] || modelId || '—';
}

function optionLabel(id) {
  return OPTION_DISPLAY_NAMES[id] || id;
}

function formatEstimate(estimate) {
  if (!estimate) return { displayLabel: null, totalEur: null, hasConsultationItems: false };
  return {
    displayLabel: estimate.displayLabel || null,
    totalEur: estimate.totalEur != null ? Number(estimate.totalEur) : null,
    hasConsultationItems: Boolean(estimate.hasConsultationItems),
    unverified: estimate.unverified !== false
  };
}

function summarizeEmailLane(lane) {
  if (!lane || typeof lane !== 'object') {
    return { status: 'pending', attemptCount: 0, maxAttempts: 10, nextAttemptAt: null };
  }
  return {
    status: lane.status || 'pending',
    attemptCount: Number(lane.attemptCount) || 0,
    maxAttempts: Number(lane.maxAttempts) || 10,
    nextAttemptAt: lane.nextAttemptAt || null
  };
}

function emailAttention(emails) {
  const internal = emails?.internal?.status;
  const customer = emails?.customer?.status;
  const statuses = [internal, customer];
  return {
    hasNeedsManual: statuses.includes('needs_manual'),
    hasFailed: statuses.includes('failed'),
    hasPending: statuses.includes('pending') || statuses.includes('sending')
  };
}

function toListItem(doc) {
  const estimate = formatEstimate(doc.estimate);
  const attention = emailAttention(doc.emails);
  return {
    id: String(doc._id),
    projectReference: doc.projectReference,
    status: doc.status,
    customerName: doc.contact?.name || null,
    customerEmail: doc.contact?.email || null,
    modelId: doc.config?.modelId || null,
    modelLabel: modelLabel(doc.config?.modelId),
    estimateDisplayLabel: estimate.displayLabel,
    estimateTotalEur: estimate.totalEur,
    createdAt: doc.createdAt || null,
    emailAttention: attention
  };
}

function toDetail(doc) {
  const radio = radioToObject(doc.config?.radio);
  const toggles = Array.isArray(doc.config?.toggles) ? doc.config.toggles : [];
  const attention = emailAttention(doc.emails);

  return {
    id: String(doc._id),
    projectReference: doc.projectReference,
    status: doc.status,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    contact: {
      name: doc.contact?.name || null,
      email: doc.contact?.email || null,
      phone: doc.contact?.phone || null
    },
    project: {
      location: doc.project?.location || null,
      landStatus: doc.project?.landStatus || null,
      budget: doc.project?.budget || null,
      timeline: doc.project?.timeline || null,
      message: doc.project?.message || null
    },
    config: {
      modelId: doc.config?.modelId || null,
      modelLabel: modelLabel(doc.config?.modelId),
      customDimensions: doc.config?.customDimensions || null,
      radio,
      radioLabels: Object.fromEntries(
        Object.entries(radio).map(([k, v]) => [k, optionLabel(v)])
      ),
      toggles,
      toggleLabels: toggles.map(optionLabel)
    },
    configMeta: {
      currentStep: doc.configMeta?.currentStep ?? null,
      stepsVisited: Array.isArray(doc.configMeta?.stepsVisited)
        ? doc.configMeta.stepsVisited
        : [],
      isPartial: doc.configMeta?.isPartial !== false
    },
    estimate: formatEstimate(doc.estimate),
    attribution: {
      source: doc.attribution?.source || null,
      medium: doc.attribution?.medium || null,
      campaign: doc.attribution?.campaign || null,
      utmSource: doc.attribution?.utmSource || null,
      utmMedium: doc.attribution?.utmMedium || null,
      utmCampaign: doc.attribution?.utmCampaign || null,
      referrer: doc.attribution?.referrer || null
    },
    emails: {
      internal: summarizeEmailLane(doc.emails?.internal),
      customer: summarizeEmailLane(doc.emails?.customer),
      attention
    }
  };
}

async function listBuildEnquiries({
  status,
  q,
  page: pageRaw,
  limit: limitRaw,
  emailAttention: emailAttentionFilter
} = {}) {
  const page = parsePage(pageRaw);
  const limit = parseLimit(limitRaw);
  const match = {};

  if (status) {
    const s = String(status).trim();
    if (!ENQUIRY_STATUSES.includes(s)) {
      const err = new Error(`status must be one of: ${ENQUIRY_STATUSES.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }
    match.status = s;
  }

  const search = q != null ? String(q).trim().slice(0, 120) : '';
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    match.$or = [
      { projectReference: rx },
      { 'contact.name': rx },
      { 'contact.email': rx },
      { 'contact.emailNormalized': rx },
      { 'project.location': rx }
    ];
  }

  const attention = String(emailAttentionFilter || '').trim();
  if (attention === 'needs_manual') {
    match.$and = (match.$and || []).concat([
      {
        $or: [
          { 'emails.internal.status': 'needs_manual' },
          { 'emails.customer.status': 'needs_manual' }
        ]
      }
    ]);
  } else if (attention === 'failed') {
    match.$and = (match.$and || []).concat([
      {
        $or: [
          { 'emails.internal.status': 'failed' },
          { 'emails.customer.status': 'failed' }
        ]
      }
    ]);
  } else if (attention === 'alert') {
    match.$and = (match.$and || []).concat([
      {
        $or: [
          { 'emails.internal.status': { $in: ['failed', 'needs_manual'] } },
          { 'emails.customer.status': { $in: ['failed', 'needs_manual'] } }
        ]
      }
    ]);
  } else if (attention && attention !== '') {
    const err = new Error('emailAttention must be needs_manual, failed, or alert');
    err.statusCode = 400;
    throw err;
  }

  const total = await BuildEnquiry.countDocuments(match);
  const docs = await BuildEnquiry.find(match)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return {
    items: docs.map(toListItem),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
}

async function getBuildEnquiryDetail({ id }) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Invalid enquiry id');
    err.statusCode = 400;
    throw err;
  }
  const doc = await BuildEnquiry.findById(id).lean();
  if (!doc) {
    const err = new Error('Build enquiry not found');
    err.statusCode = 404;
    throw err;
  }
  return toDetail(doc);
}

async function updateBuildEnquiryStatus({ id, status }) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Invalid enquiry id');
    err.statusCode = 400;
    throw err;
  }
  const next = String(status || '').trim();
  if (!ENQUIRY_STATUSES.includes(next)) {
    const err = new Error(`status must be one of: ${ENQUIRY_STATUSES.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  const doc = await BuildEnquiry.findByIdAndUpdate(
    id,
    { $set: { status: next } },
    { new: true }
  ).lean();
  if (!doc) {
    const err = new Error('Build enquiry not found');
    err.statusCode = 404;
    throw err;
  }
  return toDetail(doc);
}

module.exports = {
  listBuildEnquiries,
  getBuildEnquiryDetail,
  updateBuildEnquiryStatus,
  toListItem,
  toDetail,
  DEFAULT_LIMIT,
  MAX_LIMIT
};
