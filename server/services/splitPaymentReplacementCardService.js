/**
 * SP6 — verified replacement card recovery after Hosted Invoice Page payment.
 * Uses Dahlia InvoicePayment → PaymentIntent → card/customer verification.
 * Never falls back to an arbitrary/default Customer PM as "the card that paid".
 * Updates Booking PM and future DRAFT (not-yet-finalized) invoices only.
 */
'use strict';

const Stripe = require('stripe');
const { STRIPE_API_VERSION } = require('../config/stripeApiVersion');
const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');

class ReplacementCardError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ReplacementCardError';
    this.code = code;
    this.details = details;
  }
}

function getStripe(stripeOverride) {
  if (stripeOverride) return stripeOverride;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
}

function stripeId(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim()) return String(value).trim();
  if (typeof value === 'object' && value.id) return String(value.id).trim();
  return null;
}

/**
 * List paid InvoicePayment records for an invoice via the installed Dahlia SDK.
 */
async function listPaidInvoicePayments({ stripe, invoiceId }) {
  const client = getStripe(stripe);
  if (!client?.invoicePayments?.list) {
    throw new ReplacementCardError(
      'INVOICE_PAYMENTS_API_REQUIRED',
      'Stripe invoicePayments.list is required for Dahlia payment provenance'
    );
  }
  const page = await client.invoicePayments.list({
    invoice: String(invoiceId),
    status: 'paid',
    limit: 100
  });
  return Array.isArray(page?.data) ? page.data : [];
}

/**
 * Resolve verified card PaymentIntent provenance from paid InvoicePayments.
 * Does NOT use legacy top-level invoice.payment_intent as primary.
 * Does NOT fall back to Customer default / invoice default PM.
 *
 * @returns {{
 *   settlementKind: 'card_payment_intent'|'invoice_settled_other',
 *   invoicePaymentId: string|null,
 *   paymentIntentId: string|null,
 *   paymentMethod: object|null,
 *   paidInvoicePayments: object[]
 * }}
 */
async function resolveInvoicePaymentProvenance({
  stripe,
  invoice,
  expectedCustomer
}) {
  const client = getStripe(stripe);
  if (!client) {
    throw new ReplacementCardError('STRIPE_REQUIRED', 'Stripe client required for payment provenance');
  }
  const invoiceId = stripeId(invoice?.id) || stripeId(invoice);
  if (!invoiceId) {
    throw new ReplacementCardError('INVOICE_REQUIRED', 'Invoice id required');
  }

  const paidPayments = await listPaidInvoicePayments({ stripe: client, invoiceId });

  for (const ip of paidPayments) {
    if (String(ip.status || '') !== 'paid') continue;
    const mappedInvoice = stripeId(ip.invoice);
    if (mappedInvoice && mappedInvoice !== invoiceId) continue;

    const payment = ip.payment || {};
    if (String(payment.type || '') !== 'payment_intent') {
      continue;
    }
    const paymentIntentId = stripeId(payment.payment_intent);
    if (!paymentIntentId || !client.paymentIntents?.retrieve) continue;

    const pi = await client.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method']
    });
    const piCustomer = stripeId(pi.customer);
    if (!piCustomer || piCustomer !== String(expectedCustomer || '')) {
      continue;
    }
    const piStatus = String(pi.status || '');
    if (!['succeeded', 'processing'].includes(piStatus) && piStatus !== 'succeeded') {
      // Only accept successful payment intents for card provenance.
      if (piStatus !== 'succeeded') continue;
    }
    if (piStatus !== 'succeeded') continue;

    let paymentMethod =
      typeof pi.payment_method === 'object' && pi.payment_method
        ? pi.payment_method
        : null;
    if (!paymentMethod && stripeId(pi.payment_method) && client.paymentMethods?.retrieve) {
      paymentMethod = await client.paymentMethods.retrieve(String(pi.payment_method));
    }
    if (!paymentMethod?.id) continue;
    if (String(paymentMethod.type || '') !== 'card') continue;
    const pmCustomer = stripeId(paymentMethod.customer);
    if (!pmCustomer || pmCustomer !== String(expectedCustomer || '')) continue;

    return {
      settlementKind: 'card_payment_intent',
      invoicePaymentId: String(ip.id),
      paymentIntentId: String(paymentIntentId),
      paymentMethod,
      paidInvoicePayments: paidPayments
    };
  }

  // Invoice may be economically settled (paid InvoicePayments of other types, or
  // invoice.status=paid) without a verified card PaymentIntent.
  const hasPaidIp = paidPayments.some((ip) => String(ip.status) === 'paid');
  return {
    settlementKind: hasPaidIp || String(invoice?.status) === 'paid'
      ? 'invoice_settled_other'
      : 'invoice_settled_other',
    invoicePaymentId: hasPaidIp ? String(paidPayments.find((p) => p.status === 'paid')?.id || '') || null : null,
    paymentIntentId: null,
    paymentMethod: null,
    paidInvoicePayments: paidPayments
  };
}

/**
 * @deprecated Prefer resolveInvoicePaymentProvenance. Kept for tests that inspect PM only.
 */
async function resolvePaidInvoicePaymentMethod({ stripe, invoice, expectedCustomer = null }) {
  const customer =
    expectedCustomer ||
    stripeId(invoice?.customer) ||
    null;
  const prov = await resolveInvoicePaymentProvenance({
    stripe,
    invoice,
    expectedCustomer: customer
  });
  return {
    paymentMethod: prov.paymentMethod,
    paymentIntentId: prov.paymentIntentId,
    invoicePaymentId: prov.invoicePaymentId,
    settlementKind: prov.settlementKind
  };
}

async function applyReplacementCardFromPaidInvoice({
  invoice,
  booking,
  stripe = null,
  BookingModel = Booking,
  BookingInstallmentModel = BookingInstallment
}) {
  const client = getStripe(stripe);
  const expectedCustomer = booking.stripeCustomerId
    ? String(booking.stripeCustomerId).trim()
    : null;
  if (!expectedCustomer) {
    throw new ReplacementCardError('CUSTOMER_MISSING', 'Booking has no stripeCustomerId');
  }

  const provenance = await resolveInvoicePaymentProvenance({
    stripe: client,
    invoice,
    expectedCustomer
  });

  if (!provenance.paymentMethod?.id || provenance.settlementKind !== 'card_payment_intent') {
    // Retain previously verified reusable PM — do not invent a replacement.
    return {
      updated: false,
      reason: 'no_verified_card_payment_intent',
      settlementKind: provenance.settlementKind,
      invoicePaymentId: provenance.invoicePaymentId,
      paymentIntentId: null
    };
  }

  const paymentMethod = provenance.paymentMethod;
  if (String(paymentMethod.type || '') !== 'card') {
    throw new ReplacementCardError('PM_NOT_CARD', 'Replacement PaymentMethod must be card', {
      type: paymentMethod.type || null
    });
  }
  const pmCustomer = stripeId(paymentMethod.customer);
  if (!pmCustomer || pmCustomer !== expectedCustomer) {
    throw new ReplacementCardError(
      'PM_CUSTOMER_MISMATCH',
      'Replacement PaymentMethod Customer does not match Booking',
      { pmCustomer, expectedCustomer }
    );
  }

  const newPmId = String(paymentMethod.id);
  const previous = booking.stripeReusablePaymentMethodId
    ? String(booking.stripeReusablePaymentMethodId)
    : null;

  if (previous === newPmId) {
    return {
      updated: false,
      reason: 'unchanged',
      paymentMethodId: newPmId,
      settlementKind: provenance.settlementKind,
      invoicePaymentId: provenance.invoicePaymentId,
      paymentIntentId: provenance.paymentIntentId
    };
  }

  await BookingModel.updateOne(
    { _id: booking._id },
    { $set: { stripeReusablePaymentMethodId: newPmId } }
  );
  booking.stripeReusablePaymentMethodId = newPmId;

  // Update future DRAFT / not-yet-finalized invoices only.
  const future = await BookingInstallmentModel.find({
    bookingId: booking._id,
    sequence: { $gte: 2 },
    status: { $in: ['scheduled', 'processing', 'failed', 'requires_action', 'retry_exhausted'] },
    stripeInvoiceId: { $ne: null },
    stripeInvoiceStatus: { $in: ['draft', null] }
  });

  const updatedInvoiceIds = [];
  for (const row of future) {
    if (!row.stripeInvoiceId || !client?.invoices?.update) continue;
    try {
      const inv = await client.invoices.retrieve(String(row.stripeInvoiceId));
      if (String(inv.status || '') !== 'draft') continue;
      await client.invoices.update(String(row.stripeInvoiceId), {
        default_payment_method: newPmId
      });
      updatedInvoiceIds.push(String(row.stripeInvoiceId));
    } catch {
      /* leave for next reconcile / review */
    }
  }

  return {
    updated: true,
    paymentMethodId: newPmId,
    previousPaymentMethodId: previous,
    updatedInvoiceIds,
    settlementKind: provenance.settlementKind,
    invoicePaymentId: provenance.invoicePaymentId,
    paymentIntentId: provenance.paymentIntentId
  };
}

module.exports = {
  ReplacementCardError,
  listPaidInvoicePayments,
  resolveInvoicePaymentProvenance,
  resolvePaidInvoicePaymentMethod,
  applyReplacementCardFromPaidInvoice
};
