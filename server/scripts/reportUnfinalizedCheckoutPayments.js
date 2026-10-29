#!/usr/bin/env node
/**
 * Read-only reconciliation report for checkout sessions and PaymentIntents
 * that have no finalized booking in a UTC window.
 *
 *   node server/scripts/reportUnfinalizedCheckoutPayments.js \
 *     --since=2026-10-27T00:00:00.000Z \
 *     --until=2026-10-27T12:00:00.000Z
 *
 * --execute and other mutation flags are rejected. This script does not
 * refund, cancel, capture, finalize, email, or update records.
 */
'use strict';

const {
  buildUnfinalizedCheckoutPaymentReport,
  assertReadOnly,
  paginateReadOnly,
  collectStripePaymentIntents
} = require('../services/ops/unfinalizedCheckoutPaymentReport');

function publicErrorMessage(err) {
  if (err?.code === 'MUTATION_NOT_PERMITTED' || err?.code === 'INVALID_WINDOW' || err?.code === 'INVALID_ARGS') {
    return String(err.message || err.code);
  }
  return String(err?.message || 'report_failed')
    .replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://[redacted]')
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/whsec_\S+/g, '[redacted]')
    .slice(0, 300);
}

function printHelp() {
  console.log(`Usage: node server/scripts/reportUnfinalizedCheckoutPayments.js --since=<UTC> --until=<UTC>

Read-only JSON report. No refunds, cancels, captures, finalization, or email.
Mutation flags (--execute and similar) exit with MUTATION_NOT_PERMITTED.
A future mutation mode requires an explicit flag and a separately reviewed task.
The report is complete only when complete is true. A missing Stripe key, a failed
Stripe list, or a safety cap sets complete to false and names the source.
`);
}

function parseArgs(argv) {
  const out = { since: '', until: '' };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--execute' || arg === '--mutate' || arg === '--refund' || arg === '--cancel' || arg === '--capture' || arg === '--finalize' || arg === '--email') {
      const flag = arg.replace(/^--/, '');
      out[flag] = true;
    } else if (arg.startsWith('--since=')) out.since = arg.slice('--since='.length);
    else if (arg.startsWith('--until=')) out.until = arg.slice('--until='.length);
    else {
      const err = new Error(`Unknown argument: ${arg}`);
      err.code = 'INVALID_ARGS';
      throw err;
    }
  }
  return out;
}

function createReadOnlySources() {
  const mongoose = require('mongoose');
  const CheckoutSession = require('../models/CheckoutSession');
  const Booking = require('../models/Booking');

  return {
    async connect() {
      const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
      const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
      if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
      }
    },
    checkoutSessionSource: {
      async listCreatedBetween({ since, until }) {
        return paginateReadOnly(({ skip, limit }) => (
          CheckoutSession.find({
            createdAt: { $gte: since, $lt: until }
          })
            .select('checkoutId createdAt canonicalPaymentIntentId bookingId paymentStatus finalizeStatus')
            .sort({ _id: 1 })
            .skip(skip)
            .limit(limit)
            .lean()
        ), { pageSize: 200, maxItems: 5000 });
      }
    },
    bookingSource: {
      async listByCheckoutOrPaymentIntent({ checkoutIds, paymentIntentIds }) {
        const or = [];
        if (checkoutIds.length > 0) or.push({ checkoutId: { $in: checkoutIds } });
        if (paymentIntentIds.length > 0) or.push({ stripePaymentIntentId: { $in: paymentIntentIds } });
        if (or.length === 0) {
          return { items: [], available: true, complete: true, truncated: false, reason: null };
        }
        return paginateReadOnly(({ skip, limit }) => (
          Booking.find({ $or: or })
            .select('checkoutId status stripePaymentIntentId')
            .sort({ _id: 1 })
            .skip(skip)
            .limit(limit)
            .lean()
        ), { pageSize: 200, maxItems: 5000 });
      }
    },
    paymentIntentSource: createStripeListSource()
  };
}

function createStripeListSource() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) {
    return {
      async listCreatedBetween() {
        return {
          items: [],
          available: false,
          complete: false,
          truncated: false,
          reason: 'stripe_unavailable'
        };
      }
    };
  }
  const Stripe = require('stripe');
  const stripe = new Stripe(key);
  return {
    async listCreatedBetween(window) {
      try {
        return await collectStripePaymentIntents(
          (query) => stripe.paymentIntents.list(query),
          window
        );
      } catch {
        return {
          items: [],
          available: false,
          complete: false,
          truncated: false,
          reason: 'stripe_list_failed'
        };
      }
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  assertReadOnly(args);
  if (!args.since || !args.until) {
    const err = new Error('--since and --until are required.');
    err.code = 'INVALID_WINDOW';
    throw err;
  }
  const sources = createReadOnlySources();
  await sources.connect();
  const report = await buildUnfinalizedCheckoutPaymentReport({
    since: args.since,
    until: args.until,
    checkoutSessionSource: sources.checkoutSessionSource,
    bookingSource: sources.bookingSource,
    paymentIntentSource: sources.paymentIntentSource
  });
  console.log(JSON.stringify(report));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      const payload = {
        ok: false,
        mode: 'read_only',
        mutated: false,
        code: err?.code || 'REPORT_FAILED',
        error: publicErrorMessage(err)
      };
      console.error(JSON.stringify(payload));
      process.exit(err?.code === 'MUTATION_NOT_PERMITTED' ? 2 : 1);
    });
}

module.exports = { parseArgs, main };
