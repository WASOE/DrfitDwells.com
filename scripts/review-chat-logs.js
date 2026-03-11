#!/usr/bin/env node
/**
 * Internal review script for chat logs.
 * Shows: query, answer, intent, matchedId, confidence, top3, thumbs result, embeddingReady.
 *
 * Usage:
 *   node scripts/review-chat-logs.js [--limit N] [--outcome answered|clarified|...]
 *
 * Reads: training-data/chat_interactions.jsonl, training-data/chat_feedback.jsonl
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INTERACTIONS = path.join(ROOT, 'training-data', 'chat_interactions.jsonl');
const FEEDBACK = path.join(ROOT, 'training-data', 'chat_feedback.jsonl');

const args = process.argv.slice(2);
let limit = 50;
let outcomeFilter = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10) || 50;
    i++;
  } else if (args[i] === '--outcome' && args[i + 1]) {
    outcomeFilter = args[i + 1];
    i++;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const interactions = readJsonl(INTERACTIONS);
const feedback = readJsonl(FEEDBACK);

// Build feedback lookup by query (most recent)
const feedbackByQuery = new Map();
for (const f of feedback) {
  const key = (f.query || '').trim().toLowerCase();
  feedbackByQuery.set(key, f); // overwrite = most recent
}

// Filter and sort interactions (newest first)
let filtered = interactions;
if (outcomeFilter) {
  filtered = filtered.filter((r) => r.outcome === outcomeFilter);
}
filtered = filtered.slice(-limit).reverse();

function truncate(s, len = 80) {
  if (!s) return '—';
  return s.length <= len ? s : s.slice(0, len) + '…';
}

console.log('\n--- Chat Log Review ---\n');
console.log(`Interactions: ${interactions.length} total, showing ${filtered.length}`);
console.log(`Feedback entries: ${feedback.length}\n`);

for (const r of filtered) {
  const fb = feedbackByQuery.get((r.query || '').trim().toLowerCase());
  const sep = '─'.repeat(60);

  console.log(sep);
  console.log(`Query:    ${truncate(r.query, 100)}`);
  console.log(`Outcome:  ${r.outcome || '—'}`);
  console.log(`Match:    ${r.matchType || '—'}`);
  console.log(`Page:     ${r.propertyContext || '—'} (null = both/ambiguous)`);
  console.log(`Matched: ${r.matchedProperty || r.property || '—'}`);
  if (r.propertyContext && r.matchedProperty && r.matchedProperty !== 'both' && r.matchedProperty !== r.propertyContext) {
    console.log(`⚠️  MISMATCH: page=${r.propertyContext} but answer is for ${r.matchedProperty}`);
  }
  console.log(`Intent:   ${r.intent || '—'}`);
  console.log(`Matched:  ${r.matchedId || '—'}`);
  console.log(`Conf:     ${r.confidence != null ? r.confidence.toFixed(3) : '—'}`);
  console.log(`Gap:      ${r.scoreGapTop2 != null ? r.scoreGapTop2.toFixed(3) : '—'}`);
  console.log(`Embed:    ${r.embeddingReady === true ? 'yes' : r.embeddingReady === false ? 'NO (fallback)' : '—'}`);
  if (r.kbVersion) console.log(`KB:       ${r.kbVersion}`);
  if (r.answerText) {
    console.log(`Answer:   ${truncate(r.answerText, 120)}`);
  }
  if (r.top3 && r.top3.length) {
    console.log(`Top3:     ${r.top3.map((t) => `${t.id}:${t.score?.toFixed(2)}`).join(' | ')}`);
  }
  if (fb) {
    console.log(`Thumbs:   ${fb.rating} (${fb.ts})`);
  }
  console.log('');
}

console.log('--- End ---\n');
