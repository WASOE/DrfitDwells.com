'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BookingFunnelEvent = require('../models/BookingFunnelEvent');
const {
  aggregateConversionSummary,
  validateConversionQuery,
  sessionContinuedSequential,
  SEARCH_RESULTS_NOTE
} = require('../services/conversion/conversionSummaryService');

let mongoServer;

function at(day, hour = 12) {
  return new Date(`2026-06-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`);
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await BookingFunnelEvent.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await BookingFunnelEvent.deleteMany({});
});

test('validateConversionQuery rejects ranges over 180 days', () => {
  assert.throws(
    () =>
      validateConversionQuery({
        propertyKind: 'cabin',
        from: '2026-01-01',
        to: '2026-07-15'
      }),
    /cannot exceed 180 days/i
  );
});

test('sessionContinuedSequential requires ordered progression', () => {
  const timeline = [
    { eventType: 'property_view', createdAt: at(1, 10) },
    { eventType: 'confirm_page_view', createdAt: at(1, 11) },
    { eventType: 'quote_received', createdAt: at(1, 12) }
  ];
  assert.equal(sessionContinuedSequential(timeline, 'property_view', 'confirm_page_view'), true);
  assert.equal(sessionContinuedSequential(timeline, 'property_view', 'checkout_started'), false);
});

test('aggregateConversionSummary counts zone funnel and supplementary search_results', async () => {
  const sessionA = 'sess-funnel-a';
  const sessionB = 'sess-search-only';

  await BookingFunnelEvent.insertMany([
    {
      eventType: 'property_view',
      source: 'client',
      dedupeKey: 'pv:a',
      sessionKey: sessionA,
      propertyKind: 'valley',
      createdAt: at(5, 10)
    },
    {
      eventType: 'confirm_page_view',
      source: 'client',
      dedupeKey: 'cp:a',
      sessionKey: sessionA,
      propertyKind: 'valley',
      createdAt: at(5, 11)
    },
    {
      eventType: 'quote_received',
      source: 'server',
      dedupeKey: 'qr:a',
      sessionKey: sessionA,
      propertyKind: 'valley',
      createdAt: at(5, 12)
    },
    {
      eventType: 'checkout_started',
      source: 'client',
      dedupeKey: 'cs:a',
      sessionKey: sessionA,
      propertyKind: 'valley',
      createdAt: at(5, 13)
    },
    {
      eventType: 'booking_converted',
      source: 'server',
      dedupeKey: 'bc:a',
      sessionKey: sessionA,
      propertyKind: 'valley',
      createdAt: at(5, 14)
    },
    {
      eventType: 'search_results',
      source: 'client',
      dedupeKey: 'sr:b',
      sessionKey: sessionB,
      createdAt: at(6, 10)
    },
    {
      eventType: 'quote_received',
      source: 'server',
      dedupeKey: 'qr:orphan:1',
      sessionKey: null,
      propertyKind: 'valley',
      createdAt: at(6, 11)
    },
    {
      eventType: 'quote_failed',
      source: 'server',
      dedupeKey: 'qf:orphan:1',
      sessionKey: null,
      propertyKind: 'valley',
      quoteFailureClass: 'unavailable',
      createdAt: at(6, 12)
    }
  ]);

  const data = await aggregateConversionSummary({
    propertyKind: 'valley',
    from: '2026-06-01',
    to: '2026-06-30'
  });

  const propertyView = data.steps.find((step) => step.eventType === 'property_view');
  const quoteReceived = data.steps.find((step) => step.eventType === 'quote_received');
  assert.equal(propertyView.sessionCount, 1);
  assert.equal(quoteReceived.orphanEventCount, 1);
  assert.equal(data.supplementary.searchResults.sessionCount, 1);
  assert.equal(data.supplementary.searchResults.note, SEARCH_RESULTS_NOTE);
  assert.equal(data.supplementary.quoteFailed.eventCount, 1);
  assert.equal(data.supplementary.quoteFailed.byClass.unavailable, 1);
  assert.equal(data.dropOff.length, 4);
  assert.equal(data.dropOff[0].from, 'property_view');
  assert.equal(data.dropOff[0].to, 'confirm_page_view');
  assert.equal(data.dropOff[0].fromSessionCount, 1);
  assert.equal(data.dropOff[0].continuedSessionCount, 1);
  assert.equal(data.dropOff[0].dropOffRate, 0);
});

test('aggregateConversionSummary excludes other propertyKind from zone funnel', async () => {
  await BookingFunnelEvent.insertMany([
    {
      eventType: 'property_view',
      source: 'client',
      dedupeKey: 'pv:cabin',
      sessionKey: 'sess-cabin',
      propertyKind: 'cabin',
      createdAt: at(8, 10)
    },
    {
      eventType: 'property_view',
      source: 'client',
      dedupeKey: 'pv:valley',
      sessionKey: 'sess-valley',
      propertyKind: 'valley',
      createdAt: at(8, 11)
    }
  ]);

  const data = await aggregateConversionSummary({
    propertyKind: 'cabin',
    from: '2026-06-01',
    to: '2026-06-30'
  });

  const propertyView = data.steps.find((step) => step.eventType === 'property_view');
  assert.equal(propertyView.sessionCount, 1);
});
