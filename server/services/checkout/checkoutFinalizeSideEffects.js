'use strict';

/**
 * Batch 4 stubs — Batch 6+ will implement quote convert, alert resolve, email enqueue.
 * Domain finalize must not SMTP-inline or invent side effects here yet.
 */

async function enqueuePostFinalizeSideEffects({
  booking = null,
  session = null,
  source = null,
  adoptedExisting = false
} = {}) {
  void booking;
  void session;
  void source;
  void adoptedExisting;
  return {
    deferred: true,
    quoteConvert: 'pending_batch_6',
    alertResolve: 'pending_batch_6',
    confirmationEmail: 'pending_batch_6'
  };
}

module.exports = {
  enqueuePostFinalizeSideEffects
};
