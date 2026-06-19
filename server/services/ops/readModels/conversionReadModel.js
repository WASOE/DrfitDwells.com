'use strict';

const { aggregateConversionSummary } = require('../../conversion/conversionSummaryService');

async function getConversionSummaryReadModel({ propertyKind, from, to }) {
  const summary = await aggregateConversionSummary({ propertyKind, from, to });
  return summary;
}

module.exports = {
  getConversionSummaryReadModel
};
