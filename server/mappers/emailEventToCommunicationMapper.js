function mapEmailEventToCommunicationCompatible(emailEventDoc = {}) {
  const event = emailEventDoc.toObject ? emailEventDoc.toObject() : emailEventDoc;

  const statusByType = {
    Delivered: 'sent',
    Opened: 'viewed',
    Clicked: 'viewed',
    Bounce: 'failed',
    SpamComplaint: 'failed'
  };

  return {
    communicationEventId: event._id ? String(event._id) : null,
    bookingId: event.bookingId ? String(event.bookingId) : null,
    channel: 'email',
    provider: event.provider || 'postmark',
    providerReference: event.messageId || (event.postmarkId != null ? String(event.postmarkId) : null),
    eventType: event.type || null,
    status: statusByType[event.type] || 'unknown',
    happenedAt: event.createdAt || null,
    recipient: event.to || null,
    subject: event.subject || null,
    source: 'webhook',
    sourceReference: event.messageId || null,
    importedAt: null,
    metadata: event.details || {}
  };
}

module.exports = {
  mapEmailEventToCommunicationCompatible
};
