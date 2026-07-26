'use strict';

const { aggregateConversionSummary } = require('../../conversion/conversionSummaryService');

async function getConversionSummaryReadModel({
  propertyKind,
  from,
  to,
  cabinId = null,
  cabinTypeId = null,
  unitId = null
}) {
  return aggregateConversionSummary({
    propertyKind,
    from,
    to,
    cabinId,
    cabinTypeId,
    unitId
  });
}

module.exports = {
  getConversionSummaryReadModel
};
