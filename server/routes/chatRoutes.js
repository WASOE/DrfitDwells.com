/**
 * Drift & Dwells guest FAQ chat API.
 * Supports debug mode, feedback, structured logging.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const chatService = require('../services/chatService');

const router = express.Router();

const WHATSAPP_NUMBER = '359876342540';
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`;

const chatLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, suggestWhatsApp: true, message: 'Too many messages. Please try again later or reach us on WhatsApp.' },
});

router.post(
  '/',
  chatLimiter,
  [
    body('query').trim().notEmpty().withMessage('Query is required').isLength({ max: 500 }).withMessage('Query must be at most 500 characters'),
    body('propertyContext').optional().isIn(['cabin', 'valley']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0]?.msg || 'Invalid request',
        suggestWhatsApp: true,
      });
    }

    const { query, propertyContext } = req.body;
    const debug = req.query.debug === '1' || req.headers['x-chat-debug'] === '1';

    let result;
    try {
      result = await chatService.retrieve(query, { debug, propertyContext: propertyContext || null });
    } catch (err) {
      console.error('[chat] retrieve error:', err);
      return res.json({
        success: true,
        answer: null,
        suggestWhatsApp: true,
        whatsAppLink: WHATSAPP_LINK,
        message: "Something went wrong. Reach me on WhatsApp and I'll help you directly.",
      });
    }

    if (result.answer) {
      const payload = {
        success: true,
        answer: result.answer,
        suggestWhatsApp: result.suggestWhatsApp || false,
        whatsAppLink: WHATSAPP_LINK,
        matchedId: result.matchedId,
        matchedProperty: result.matchedProperty || null,
      };
      if (debug && result._debug) payload._debug = result._debug;
      return res.json(payload);
    }

    chatService.logUnansweredQuestion(query);

    const payload = {
      success: true,
      answer: null,
      suggestWhatsApp: true,
      whatsAppLink: WHATSAPP_LINK,
      message: result.clarifyingQuestion || "I'd love to help with that personally. Reach me on WhatsApp and I'll get back to you.",
    };
    if (debug && result._debug) payload._debug = result._debug;
    return res.json(payload);
  }
);

/** Feedback: thumbs up/down on an answer */
router.post(
  '/feedback',
  chatLimiter,
  [
    body('query').trim().notEmpty(),
    body('rating').isIn(['up', 'down']),
    body('matchedId').optional().trim(),
    body('messageIndex').optional().isInt({ min: 0 }),
    body('answerText').optional().trim(),
    body('top3').optional().isArray(),
    body('propertyDetected').optional().trim(),
    body('embeddingReady').optional().isBoolean(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Invalid feedback' });
    }

    const { query, rating, matchedId, messageIndex, answerText, top3, propertyDetected, embeddingReady } = req.body;
    chatService.logFeedback({
      query,
      rating,
      matchedId,
      messageIndex,
      answerText: answerText || null,
      top3: Array.isArray(top3) ? top3 : null,
      propertyDetected: propertyDetected || null,
      embeddingReady: embeddingReady === true || embeddingReady === false ? embeddingReady : null,
    });
    res.json({ success: true });
  }
);

router.get('/whatsapp', (req, res) => {
  res.json({ whatsAppLink: WHATSAPP_LINK, number: `+${WHATSAPP_NUMBER}` });
});

/** Health: embeddings status, FAQ count, last warm time (for admin/monitoring) */
router.get('/health', (req, res) => {
  const health = chatService.getChatHealth();
  res.json(health);
});

module.exports = router;
