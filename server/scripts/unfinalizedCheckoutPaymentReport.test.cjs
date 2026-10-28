'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const {
  buildUnfinalizedCheckoutPaymentReport
} = require('../services/ops/unfinalizedCheckoutPaymentReport');

const SINCE = '2026-10-27T10:00:00.000Z';
const UNTIL = '2026-10-27T12:00:00.000Z';

function sources() {
  const calls = { refund: 0, cancel: 0, capture: 0, update: 0, email: 0, listSessions: 0 };
  return {
    calls,
    checkoutSessionSource: {
      async listCreatedBetween() {
        calls.listSessions += 1;
        return [
          {
            checkoutId: 'chk_open_succeeded',
            createdAt: '2026-10-27T10:15:00.000Z',
            canonicalPaymentIntentId: 'pi_open_succeeded',
            guestEmail: 'guest@example.test',
            finalizeIntent: { guestInfo: { email: 'guest@example.test' } }
          },
          {
            checkoutId: 'chk_finalized',
            createdAt: '2026-10-27T10:20:00.000Z',
            canonicalPaymentIntentId: 'pi_finalized',
            guestEmail: 'other@example.test'
          },
          {
            checkoutId: 'chk_no_pi',
            createdAt: '2026-10-27T10:30:00.000Z',
            guestEmail: 'nobody@example.test'
          }
        ];
      }
    },
    bookingSource: {
      async listByCheckoutOrPaymentIntent() {
        return [
          {
            checkoutId: 'chk_finalized',
            status: 'confirmed',
            stripePaymentIntentId: 'pi_finalized',
            guestInfo: { email: 'other@example.test' }
          },
          {
            checkoutId: 'chk_open_succeeded',
            status: 'pending',
            stripePaymentIntentId: 'pi_open_succeeded'
          }
        ];
      }
    },
    paymentIntentSource: {
      async listCreatedBetween() {
        return [
          {
            id: 'pi_open_succeeded',
            status: 'succeeded',
            created: 1761560100,
            client_secret: 'pi_open_succeeded_secret_test',
            receipt_email: 'guest@example.test',
            metadata: { guestName: 'Hidden Guest' }
          },
          {
            id: 'pi_needs_action',
            status: 'requires_action',
            created: 1761560400,
            checkoutId: 'chk_needs_action',
            client_secret: 'pi_needs_action_secret_test'
          },
          {
            id: 'pi_processing',
            status: 'processing',
            created: 1761560500
          },
          {
            id: 'pi_method',
            status: 'requires_payment_method',
            created: 1761560600
          },
          {
            id: 'pi_cancelled',
            status: 'canceled',
            created: 1761560700
          },
          {
            id: 'pi_weird',
            status: 'requires_capture',
            created: 1761560800,
            client_secret: 'pi_weird_secret_test'
          }
        ];
      },
      async refund() {
        calls.refund += 1;
      },
      async cancel() {
        calls.cancel += 1;
      },
      async capture() {
        calls.capture += 1;
      },
      async update() {
        calls.update += 1;
      }
    },
    email() {
      calls.email += 1;
    }
  };
}

test('reconciliation is read-only and redacts guest data and client secrets', async () => {
  const fake = sources();
  const report = await buildUnfinalizedCheckoutPaymentReport({
    since: SINCE,
    until: UNTIL,
    checkoutSessionSource: fake.checkoutSessionSource,
    bookingSource: fake.bookingSource,
    paymentIntentSource: fake.paymentIntentSource
  });
  assert.equal(report.mode, 'read_only');
  assert.equal(report.mutated, false);
  assert.equal(report.mutationImplemented, false);
  assert.equal(fake.calls.refund, 0);
  assert.equal(fake.calls.cancel, 0);
  assert.equal(fake.calls.capture, 0);
  assert.equal(fake.calls.update, 0);
  assert.equal(fake.calls.email, 0);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('guest@example.test'), false);
  assert.equal(serialized.includes('secret_test'), false);
  assert.equal(serialized.includes('client_secret'), false);
  assert.equal(serialized.includes('Hidden Guest'), false);
  assert.equal(serialized.includes('other@example.test'), false);

  const byIntent = new Map(report.records.map((row) => [row.paymentIntentId, row]));
  assert.equal(byIntent.has('pi_finalized'), false);
  assert.equal(byIntent.get('pi_open_succeeded').classification, 'succeeded');
  assert.equal(byIntent.get('pi_open_succeeded').bookingFinalized, false);
  assert.equal(byIntent.get('pi_needs_action').classification, 'requires_action');
  assert.equal(byIntent.get('pi_processing').classification, 'processing');
  assert.equal(byIntent.get('pi_method').classification, 'requires_payment_method');
  assert.equal(byIntent.get('pi_cancelled').classification, 'cancelled');
  assert.equal(byIntent.get('pi_weird').classification, 'unknown');
  assert.equal(report.records.some((row) => row.checkoutId === 'chk_no_pi' && row.classification === 'unknown'), true);
  assert.equal(report.counts.succeeded, 1);
});

test('mutation flags are rejected before any adapter is called', async () => {
  const fake = sources();
  await assert.rejects(
    () =>
      buildUnfinalizedCheckoutPaymentReport({
        since: SINCE,
        until: UNTIL,
        execute: true,
        checkoutSessionSource: fake.checkoutSessionSource,
        bookingSource: fake.bookingSource,
        paymentIntentSource: fake.paymentIntentSource
      }),
    (err) => err.code === 'MUTATION_NOT_PERMITTED'
  );
  assert.equal(fake.calls.listSessions, 0);
});

test('CLI --execute exits nonzero without reading the database', async () => {
  const script = path.join(__dirname, 'reportUnfinalizedCheckoutPayments.js');
  const child = spawn(
    process.execPath,
    [script, '--execute', `--since=${SINCE}`, `--until=${UNTIL}`],
    {
      env: {
        ...process.env,
        MONGODB_URI: 'mongodb://user:supersecretpassword@127.0.0.1:9/unused',
        STRIPE_SECRET_KEY: 'sk_test_should_not_print'
      }
    }
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 2);
  assert.match(stderr, /MUTATION_NOT_PERMITTED/);
  assert.equal(stderr.includes('supersecretpassword'), false);
  assert.equal(stderr.includes('sk_test_should_not_print'), false);
});
