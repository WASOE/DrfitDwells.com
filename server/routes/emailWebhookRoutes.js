const express = require('express');
const crypto = require('crypto');
const EmailEvent = require('../models/EmailEvent');
const router = express.Router();

// Raw body parser for webhook signature verification
const rawJson = express.raw({ type: 'application/json' });

// helper: verify Postmark webhook signature
function verifySignature(req, secret) {
  const sig = req.get('X-Postmark-Signature') || '';
  if (!secret || !sig) return false;
  // Postmark expects: base64(HMAC_SHA256(secret, rawBody))
  const raw = req.rawBody || ''; // ensure raw body middleware
  const hmac = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(sig));
}

router.post('/postmark', rawJson, async (req, res) => {
  try {
    const secret = process.env.POSTMARK_WEBHOOK_SECRET;
    
    // Capture raw body for signature verification
    req.rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!verifySignature(req, secret)) return res.status(401).json({ ok:false });
    
    // Parse JSON body
    let body = {};
    try { 
      body = JSON.parse(req.rawBody || '{}'); 
    } catch (e) {
      console.error('Failed to parse webhook JSON:', e);
      return res.status(400).json({ ok:false, error: 'Invalid JSON' });
    }
    const type = body.RecordType || body.Type || 'Unknown';

    // Common fields
    const messageId = body.MessageID || body.MessageId || undefined;
    const postmarkId = typeof body.ID === 'number' ? body.ID : undefined; // bounce/complaint ID
    const to = body.Recipient || (body.Email && body.Email.Recipient) || body.OriginalRecipient || body.To;
    const subject = body.Subject || (body.Message && body.Message.Subject);
    const tag = body.Tag || (body.Message && body.Message.Tag);
    const stream = body.MessageStream || body.MessageStreamType;

    // Try to extract bookingId from Tag or Metadata if we include it in send
    let bookingId;
    if (tag && /^booking:/.test(tag)) {
      bookingId = tag.split(':')[1];
    } else if (body.Metadata && body.Metadata.bookingId) {
      bookingId = body.Metadata.bookingId;
    }

    const doc = {
      provider: 'postmark',
      stream, type, messageId, postmarkId, bookingId, to, subject, tag,
      details: {
        DeliveryMessage: body.DeliveryMessage,
        BounceType: body.BounceType,
        BounceSubtype: body.BounceSubtype,
        Description: body.Description,
        SuppressSending: body.SuppressSending,
        Metadata: body.Metadata,
        ReceivedAt: body.ReceivedAt || body.ReceivedAtUtc || body.ReceivedAtLocal
      }
    };

   // upsert on unique key
    const filter = postmarkId ? { provider:'postmark', postmarkId } :
                  messageId ? { provider:'postmark', type, messageId, 'details.ReceivedAt': doc.details.ReceivedAt } :
                              { provider:'postmark', type, to, subject, 'details.ReceivedAt': doc.details.ReceivedAt };
    await EmailEvent.updateOne(filter, { $setOnInsert: doc }, { upsert: true });

    return res.json({ ok:true });
  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(500).json({ ok:false });
  }
});

module.exports = router;
