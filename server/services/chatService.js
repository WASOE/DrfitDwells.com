/**
 * Drift & Dwells guest FAQ chat — intent + semantic retrieval.
 * 1. Intent classification (rule-based)
 * 2. Intent-gated retrieval (semantic fallback when intent imperfect)
 * 3. Semantic similarity via embeddings (startup cache)
 * 4. Confidence threshold — never return wrong answers
 * 5. Property-ambiguous → ask Cabin or Valley?
 * 6. Access answers: no fake certainty, WhatsApp for latest
 */

const path = require('path');
const fs = require('fs');
const { OUT_OF_SCOPE_PATTERNS } = require('../data/chatGuardrails');
const operationalConfig = require('../data/chatOperationalConfig');

const MIN_CONFIDENCE = 0.55;
/** For strong topical matches (wood+price, hot tub+included) only. Do NOT spread—keep constrained to these topics. */
const TOPICAL_CONFIDENCE = 0.48;
/** Score gap below which we ask "Cabin or Valley?" when top Cabin vs top Valley are close */
const PROPERTY_AMBIGUITY_GAP = 0.15;

const INTENT_TRIGGERS = {
  access: [
    /\bget\s+to\b/i,
    /\bget\s+there\b/i,
    /\bhow\s+to\s+(get|reach|access)\b/i,
    /\breach\b/i,
    /\baccess\b/i,
    /\broad\b/i,
    /\bdrive\b/i,
    /\btransport\b/i,
    /\b4x4\b/i,
    /\bcar\b/i,
    /\bvalley\b.*\b(get|reach|go|access)\b/i,
    /\b(get|reach|go)\b.*\bvalley\b/i,
    /\bcabin\b.*\b(get|reach|go|access)\b/i,
    /\b(get|reach|go)\b.*\bcabin\b/i,
  ],
  access_normal_car: [/\bnormal\s*car\b/i, /\bregular\s*car\b/i, /\bsedan\b/i, /\bcity\s*car\b/i, /\bdrive\b/i, /\breach\b/i],
  access_4x4: [/\b4x4\b/i, /\bsuv\b/i, /\bjeep\b/i, /\bnormal\s*car\s*can'?t\b/i],
  access_after_dark: [/\bafter\s*dark\b/i, /\barrive\s*late\b/i, /\blate\s*arrival\b/i, /\barrive\s*at\s*night\b/i, /\bcome\s*late\b/i, /\blate\s*check\b/i],
  access_google_maps: [/\bgoogle\s*maps\b/i, /\bmaps\s*wrong\b/i, /\bgps\b/i, /\bwrong\s*directions\b/i, /\bget\s+lost\b/i, /\bcan'?t\s+find\b/i],
  pricing_discounts: [
    /\breschedule\b/i,
    /\brefund\b/i,
    /\bcancel\b/i,
    /\bdiscount\b/i,
    /\bprice\b/i,
    /\bchange\s+dates\b/i,
  ],
  amenities: [/\bwifi\b/i, /\binternet\b/i, /\bphone\s+signal\b/i, /\bconnectivity\b/i, /\bstarlink\b/i],
  offgrid_basics: [
    /\belectricity\b/i,
    /\bpower\b/i,
    /\bwater\b/i,
    /\bshower\b/i,
    /\btoilet\b/i,
    /\bbathroom\b/i,
    /\bcomposting\b/i,
    /\boff-?grid\b/i,
    /\boffgrid\b/i,
    /\bexpect\b/i,
    /\bcamping\b/i,
  ],
  hot_tub: [/\bhot\s*tub\b/i, /\bjacuzzi\b/i, /\btub\b.*\bheat\b/i],
  hot_tub_included: [/\bhot\s*tub\b/i, /\bjacuzzi\b/i, /\btub\b/i],
  hot_tub_wood_cost: [/\bwood\b/i, /\bfirewood\b/i, /\blogs\b/i],
  hot_tub_heat_time: [/\bheat\b/i, /\bhow\s+long\b/i, /\bwarm\s*up\b/i, /\bhours?\b/i],
  hot_tub_winter: [/\bwinter\b/i, /\bcold\s+weather\b/i, /\bfreezing\b/i, /\bfrozen\b/i],
  hot_tub_how_it_works: [/\bhow\s+does\b/i, /\bwork\b/i, /\bwood\s*fired\b/i, /\bwood\s*burning\b/i],
  hot_tub_booking_process: [/\bhow\s+can\s+I\s+use\b/i, /\bhow\s+do\s+I\s+use\b/i, /\bhow\s+to\s+use\b/i, /\bwhat\s+do\s+I\s+need\s+to\s+do\b/i],
  firewood_included: [/\bfirewood\b/i, /\bwood\b/i, /\bincluded\b/i, /\bextra\s+charge\b/i],
  heating: [/\bheating\b/i, /\bfireplace\b/i, /\bwarm\b/i, /\bcold\b/i],
  kitchen_food: [/\bkitchen\b/i, /\bcook\b/i, /\bfridge\b/i, /\bshop\b/i, /\bgrocery\b/i, /\bbbq\b/i, /\bfood\b/i],
  nearest_shop_food: [/\bnearest\s*shop\b/i, /\bsupermarket\b/i, /\bgrocery\s*store\b/i, /\bbring\s*food\b/i, /\brestaurants\s*nearby\b/i],
  checkin_arrival: [/\bcheck-?in\b/i, /\bcheckin\b/i, /\barrive\b/i, /\blate\b/i, /\bkey\b/i, /\bdark\b/i],
  pets_allowed: [/\bpet\b/i, /\bdog\b/i, /\bpets\s*allowed\b/i, /\bpet\s*friendly\b/i],
  kids_baby: [/\bkids?\b/i, /\bchild\b/i, /\bbaby\b/i, /\btoddler\b/i, /\bfamily\b/i, /\bchildren\b/i],
  availability_capacity: [/\bavailable\b/i, /\bcapacity\b/i, /\bpeople\b/i, /\bsleeps\b/i],
  activities_upsell: [/\bhorse\b/i, /\briding\b/i, /\bhiking\b/i, /\bactivities\b/i, /\bromantic\b/i],
  atv_pricing: [/\batv\b/i, /\bquad\b/i],
};

const CLARIFY_BY_INTENT = {
  access:
    "I'm not fully sure from your question. Are you asking about road access, normal car vs 4x4, late arrival, or directions? Conditions vary with weather—WhatsApp is best for the latest status.",
  access_normal_car: "Are you asking about The Cabin or The Valley? The Cabin: normal car can sometimes reach. The Valley: transfer only.",
  access_4x4: "Are you asking if 4x4 is needed? The Cabin: recommended. The Valley: you don't drive—transfer by Jeep, ATV, or horse.",
  access_after_dark: "Are you asking about late arrival? The Cabin: strongly recommend before dark. The Valley: more flexible.",
  access_google_maps: "Are you asking about directions? We send detailed instructions and GPS after booking. Don't rely on Google Maps alone.",
  amenities: "Could you clarify—are you asking about WiFi, phone signal, or remote work? I can help with any of those.",
  offgrid_basics:
    "Are you asking about electricity, water, the toilet, or what to expect in general? I'm happy to explain any of these.",
  hot_tub: "Are you asking whether the hot tub is included, how much wood costs, how long it takes to heat, or if it works in winter? I can answer any of those.",
  hot_tub_included: "Are you asking whether the hot tub use is included or if wood costs extra?",
  hot_tub_wood_cost: "Are you asking about wood cost for the hot tub or firewood for heating?",
  hot_tub_heat_time: "Are you asking how long the hot tub takes to heat?",
  hot_tub_winter: "Are you asking if the hot tub works in winter?",
  hot_tub_how_it_works: "Are you asking how the wood-fired hot tub works?",
  hot_tub_booking_process: "Are you asking what to do to use the hot tub?",
  firewood_included: "Are you asking about cabin firewood or hot tub wood cost?",
  heating: "Are you asking about firewood, the fireplace, or whether it'll be warm enough?",
  kitchen_food: "Are you asking about the kitchen, fridge, or where to shop?",
  nearest_shop_food: "Are you asking about the nearest shop, groceries, or whether to bring food?",
  checkin_arrival: "Are you asking about self check-in, arrival time, or the key?",
  pets_allowed: "Are you asking about bringing a dog or pets?",
  kids_baby: "Are you asking about bringing kids or a baby?",
  availability_capacity: "Are you asking about availability for specific dates or capacity?",
  pricing_discounts:
    "For rescheduling, refunds, or discounts, it's best to reach me directly on WhatsApp so I can look at your booking.",
  activities_upsell: "Are you asking about horse riding, hiking, or what to do nearby?",
  atv_pricing: "Are you asking about ATV tour prices?",
};

const PROPERTY_CLARIFY = "Are you asking about The Cabin or The Valley? I can give you the right answer once I know.";

/**
 * Exact-match phrase map for high-frequency questions.
 * Checked before embeddings—strong match returns immediately.
 * Keys: normalized phrases (lowercase, trimmed). Values: FAQ entry id.
 */
function buildExactPhraseMap(faq) {
  const map = new Map();
  for (const e of faq.entries) {
    const phrases = [e.canonical_question, ...(e.alternative_phrasings || [])].map((p) =>
      normalize(p)
    );
    for (const p of phrases) {
      if (p && p.length > 3) map.set(p, e.id);
    }
  }
  return map;
}

/** Strong topical patterns: wood+price, hot tub+included/use, etc. Lower confidence threshold when matched. */
function hasStrongTopicalMatch(query) {
  const q = (query || '').toLowerCase();
  const hasWood = /\b(wood|firewood|logs)\b/.test(q);
  const hasPrice = /\b(price|cost|charge|extra|fee|how\s+much|included)\b/.test(q);
  const hasHotTub = /\b(hot\s*tub|hottub|jacuzzi|tub)\b/.test(q);
  const hasUse = /\b(use|using)\b/.test(q);
  return (hasWood && hasPrice) || (hasHotTub && hasPrice) || (hasHotTub && hasUse);
}

let faqCache = null;
let exactPhraseMap = null;
let embedder = null;
let embeddingCache = null;
let embeddingCacheReady = false;
let lastWarmTime = null;

function loadFaq() {
  if (faqCache) return faqCache;
  const p = path.join(__dirname, '..', 'data', 'faqKnowledgeBase.json');
  const raw = fs.readFileSync(p, 'utf8');
  faqCache = JSON.parse(raw);
  exactPhraseMap = buildExactPhraseMap(faqCache);
  return faqCache;
}

/** Resolve FAQ entry by exact phrase match. Returns entry or null. Prefers longest matching phrase. */
function exactPhraseMatch(query) {
  const faq = loadFaq();
  const qNorm = normalize(query);
  if (!qNorm) return null;
  const entryId = exactPhraseMap.get(qNorm);
  if (entryId) return faq.entries.find((e) => e.id === entryId);
  let best = null;
  let bestLen = 0;
  for (const [phrase, id] of exactPhraseMap) {
    if ((qNorm.includes(phrase) || phrase.includes(qNorm)) && phrase.length > bestLen) {
      best = faq.entries.find((e) => e.id === id);
      bestLen = phrase.length;
    }
  }
  return best;
}

/** Interpolate {{key}} placeholders in answer text from operational config */
function interpolateAnswer(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (operationalConfig[key] !== undefined) return String(operationalConfig[key]);
    return '{{' + key + '}}';
  });
}

/** Classify intent. Returns array of matched intents (for multi-intent queries). */
function classifyIntent(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];

  const matched = [];
  for (const [intent, patterns] of Object.entries(INTENT_TRIGGERS)) {
    if (patterns.some((re) => re.test(q))) {
      matched.push(intent);
    }
  }

  if (matched.includes('pricing_discounts') && matched.includes('access')) {
    if (/\b(reschedule|refund|cancel|discount|price)\b/i.test(q)) {
      return ['pricing_discounts'];
    }
    return ['access'];
  }

  if (matched.includes('firewood_included') && matched.includes('hot_tub_wood_cost')) {
    if (/\b(included|free|extra\s*charge)\b/i.test(q)) return ['firewood_included'];
    if (/\b(price|cost|how\s+much|fee)\b/i.test(q)) return ['hot_tub_wood_cost'];
  }

  return matched;
}

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseOverlapScore(query, entry) {
  const qNorm = normalize(query);
  const phrases = [entry.canonical_question, ...(entry.alternative_phrasings || [])].map(normalize);

  let best = 0;
  for (const phrase of phrases) {
    if (!phrase) continue;
    if (qNorm === phrase || qNorm.includes(phrase) || phrase.includes(qNorm)) {
      best = Math.max(best, 0.95);
    }
    const qTokens = new Set(qNorm.split(/\s+/).filter((w) => w.length > 1));
    const pTokens = new Set(phrase.split(/\s+/).filter((w) => w.length > 1));
    const intersection = [...qTokens].filter((t) => pTokens.has(t)).length;
    const union = new Set([...qTokens, ...pTokens]).size;
    best = Math.max(best, union > 0 ? intersection / union : 0);
  }
  return best;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

async function getEmbedder() {
  if (embedder) return embedder;
  try {
    const { pipeline } = await import('@xenova/transformers');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: () => {},
    });
    return embedder;
  } catch (err) {
    console.warn('[chat] Embedding model failed to load:', err.message);
    return null;
  }
}

async function embed(text) {
  const ext = await getEmbedder();
  if (!ext) return null;
  try {
    const out = await ext(text, { pooling: 'mean', normalize: true });
    return out?.data ? Array.from(out.data) : null;
  } catch {
    return null;
  }
}

/** Precompute FAQ embeddings at startup. Call from server.js. */
async function warmEmbeddings() {
  if (embeddingCacheReady) return;
  try {
    const faq = loadFaq();
    const texts = faq.entries.map((e) => {
      const parts = [e.canonical_question, ...(e.alternative_phrasings || [])];
      return parts.join(' ');
    });
    const ext = await getEmbedder();
    if (!ext) {
      console.log('[chat] Embeddings skipped (model unavailable)');
      return;
    }
    const vecs = [];
    for (const t of texts) {
      const v = await embed(t);
      vecs.push(v);
    }
    embeddingCache = vecs;
    embeddingCacheReady = true;
    lastWarmTime = new Date().toISOString();
    console.log('[chat] FAQ embeddings warmed (' + vecs.length + ' entries)');
  } catch (err) {
    console.warn('[chat] Embedding warm failed:', err.message);
  }
}

async function ensureEmbeddingCache() {
  if (embeddingCache) return embeddingCache;
  const faq = loadFaq();
  const texts = faq.entries.map((e) => {
    const parts = [e.canonical_question, ...(e.alternative_phrasings || [])];
    return parts.join(' ');
  });
  const vecs = [];
  for (const t of texts) {
    const v = await embed(t);
    vecs.push(v);
  }
  embeddingCache = vecs;
  return embeddingCache;
}

function inferProperty(query) {
  const q = (query || '').toLowerCase();
  if (/\bvalley\b|starlink|a-?frame|stone\s*house|rhodope/i.test(q)) return 'valley';
  if (/\bcabin\b|bucephalus|pirin|off-?grid|offgrid|hot\s*tub|wood\s*fired/i.test(q)) return 'cabin';
  return null;
}

function isOutOfScope(query) {
  return OUT_OF_SCOPE_PATTERNS.some((re) => re.test(query));
}

/** Structured log for tuning and analytics */
function logInteraction(payload) {
  const logPath = path.join(__dirname, '..', '..', 'training-data', 'chat_interactions.jsonl');
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  }) + '\n';
  try {
    fs.appendFileSync(logPath, line);
  } catch {
    // Non-fatal
  }
}

function logUnansweredQuestion(query) {
  const logPath = path.join(__dirname, '..', '..', 'training-data', 'chat_unanswered.log');
  const line = `${new Date().toISOString()}\t${(query || '').replace(/\t/g, ' ')}\n`;
  try {
    fs.appendFileSync(logPath, line);
  } catch {
    // Non-fatal
  }
}

/**
 * Check if FAQ entry matches property context.
 * @param {string} entryProperty - 'cabin' | 'valley' | 'both'
 * @param {string|null} propertyContext - from page: 'cabin' | 'valley' | null
 */
function entryMatchesProperty(entryProperty, propertyContext) {
  if (!propertyContext) return true;
  return entryProperty === propertyContext || entryProperty === 'both';
}

/**
 * Retrieve best FAQ answer.
 * @param {string} query
 * @param {{ debug?: boolean, propertyContext?: 'cabin'|'valley'|null }} opts
 */
async function retrieve(query, opts = {}) {
  const trimmed = (query || '').trim();
  const debug = !!opts.debug;
  const propertyContext = opts.propertyContext && ['cabin', 'valley'].includes(opts.propertyContext) ? opts.propertyContext : null;

  const faq = loadFaq();
  const kbVersion = faq.version || 'unknown';

  const logPayload = (outcome, extra = {}) => {
    logInteraction({
      query: trimmed,
      outcome,
      kbVersion,
      propertyContext: propertyContext || null,
      ...extra,
    });
  };

  if (!trimmed) {
    return { answer: null, suggestWhatsApp: true };
  }

  if (isOutOfScope(trimmed)) {
    logPayload('out_of_scope', { matchType: 'clarify', embeddingReady: embeddingCacheReady });
    return { answer: null, suggestWhatsApp: true };
  }
  const intents = classifyIntent(trimmed);
  const intent = intents[0] || null;
  const property = inferProperty(trimmed);

  // Exact phrase match: high-frequency questions, bypass embeddings
  // Only use if entry matches propertyContext (page context overrides)
  const exactEntry = exactPhraseMatch(trimmed);
  if (exactEntry && entryMatchesProperty(exactEntry.property, propertyContext)) {
    const ans = interpolateAnswer(exactEntry.full_answer || exactEntry.short_answer);
    logPayload('answered', {
      matchType: 'exact_phrase',
      intent: exactEntry.intent,
      matchedId: exactEntry.id,
      matchedProperty: exactEntry.property,
      confidence: 0.98,
      property: exactEntry.property,
      embeddingReady: embeddingCacheReady,
      answerText: ans,
    });
    const suggestWhatsApp = exactEntry.escalation_rule === 'suggestWhatsApp';
    return {
      answer: ans,
      suggestWhatsApp,
      matchedId: exactEntry.id,
      matchedProperty: exactEntry.property,
      confidence: 0.98,
      embeddingReady: embeddingCacheReady,
      propertyDetected: property,
    };
  }

  // Multi-intent: broaden candidates. hot_tub matches hot_tub_*, access matches access_*.
  const intentMatches = (eIntent, qIntent) => {
    if (qIntent === 'hot_tub') return eIntent.startsWith('hot_tub');
    if (qIntent === 'access') return eIntent.startsWith('access') || eIntent === 'access';
    return eIntent === qIntent;
  };

  // Property filter: page context overrides query inference. When set, hard-filter to that property.
  const effectiveProperty = propertyContext || property;

  let candidates = faq.entries.filter((e) => {
    if (effectiveProperty && !entryMatchesProperty(e.property, effectiveProperty)) return false;
    if (intents.length === 0) return true;
    if (intents.length > 1) {
      if (intents.some((i) => intentMatches(e.intent, i))) return true;
    } else if (!intentMatches(e.intent, intent)) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    const clarify = intent ? CLARIFY_BY_INTENT[intent] : null;
    logPayload('clarified', {
      matchType: 'clarify',
      intent,
      clarifyingQuestion: !!clarify,
      embeddingReady: embeddingCacheReady,
    });
    const fallbackClarify = propertyContext
      ? propertyContext === 'valley'
        ? "You're on The Valley page. I didn't find a direct match. The Valley has showers, ATV, and horse riding—the hot tub is at The Cabin. Reach me on WhatsApp for more."
        : "You're on The Cabin page. I didn't find a direct match. The Cabin has the hot tub and off-grid setup. Reach me on WhatsApp for more."
      : "I'm not sure I understood. Are you asking about access, amenities, the hot tub, or something else? You can also reach me on WhatsApp.";
    return {
      answer: null,
      suggestWhatsApp: true,
      clarifyingQuestion: clarify || fallbackClarify,
    };
  }

  const queryEmbedding = await embed(trimmed);
  const embeddingReady = queryEmbedding !== null;
  const cache = await ensureEmbeddingCache();
  const entryToIndex = new Map(faq.entries.map((e, idx) => [e.id, idx]));

  const scored = [];

  for (const entry of candidates) {
    const phraseScore = phraseOverlapScore(trimmed, entry);
    let semanticScore = 0;
    const cacheIdx = entryToIndex.get(entry.id);
    if (queryEmbedding && cacheIdx != null && cache[cacheIdx]) {
      semanticScore = cosineSimilarity(queryEmbedding, cache[cacheIdx]);
    }
    const combined =
      phraseScore >= 0.9
        ? phraseScore
        : phraseScore >= 0.5
          ? Math.max(phraseScore, semanticScore)
          : semanticScore > 0
            ? semanticScore * 0.9
            : phraseScore;

    scored.push({ entry, score: combined, phraseScore, semanticScore });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  const top3 = scored.slice(0, 3);
  const scoreGapTop2 = best && second ? best.score - second.score : null;

  // Property ambiguous: top Cabin vs top Valley have small score gap
  const topCabin = scored.find((s) => s.entry.property === 'cabin');
  const topValley = scored.find((s) => s.entry.property === 'valley');
  const scoreGap = topCabin && topValley
    ? Math.abs(topCabin.score - topValley.score)
    : 1;
  const needsPropertyClarify =
    !property &&
    best?.entry?.property !== 'both' &&
    scoreGap < PROPERTY_AMBIGUITY_GAP;

  if (needsPropertyClarify) {
    logPayload('property_clarify', {
      matchType: 'clarify',
      intent,
      matchedId: best.entry.id,
      matchedProperty: best.entry.property,
      confidence: best.score,
      embeddingReady,
      scoreGapTop2,
      top3: top3.map((s) => ({ id: s.entry.id, score: s.score })),
    });
    return {
      answer: null,
      suggestWhatsApp: true,
      clarifyingQuestion: PROPERTY_CLARIFY,
      confidence: best.score,
      embeddingReady,
      propertyDetected: property,
      top3: top3.map((s) => ({ id: s.entry.id, score: s.score })),
      ...(debug && { _debug: { top3: top3.map((s) => ({ id: s.entry.id, score: s.score })) } }),
    };
  }

  const effectiveMin = hasStrongTopicalMatch(trimmed) ? TOPICAL_CONFIDENCE : MIN_CONFIDENCE;
  const canAnswer = best?.entry && best.score >= effectiveMin;

  if (!canAnswer) {
    const clarify = intent ? CLARIFY_BY_INTENT[intent] : "I'm not sure I understood. Are you asking about access, amenities, the hot tub, or something else? You can also reach me on WhatsApp.";
    logPayload('low_confidence', {
      matchType: 'clarify',
      intent,
      matchedId: best?.entry?.id,
      matchedProperty: best?.entry?.property,
      confidence: best?.score,
      embeddingReady,
      scoreGapTop2,
      top3: top3.map((s) => ({ id: s.entry.id, score: s.score })),
    });
    return {
      answer: null,
      suggestWhatsApp: true,
      clarifyingQuestion: clarify,
      confidence: best?.score,
      embeddingReady,
      propertyDetected: property,
      top3: top3.map((s) => ({ id: s.entry.id, score: s.score })),
      ...(debug && { _debug: { top3: top3.map((s) => ({ id: s.entry.id, score: s.score })) } }),
    };
  }

  const { entry, score } = best;
  let ans = interpolateAnswer(entry.full_answer || entry.short_answer);

  // Access answers: append no-fake-certainty note when not already present
  const hasConditionCaveat = /vary|weather|season|latest|whatsapp|reach out/i.test(ans);
  if (entry.intent === 'access' && !hasConditionCaveat) {
    ans += ' Conditions can vary with weather and season—WhatsApp is best for the latest status.';
  }

  const suggestWhatsApp = entry.escalation_rule === 'suggestWhatsApp' || entry.intent === 'access';

  logPayload('answered', {
    matchType: 'semantic',
    intent,
    matchedId: entry.id,
    matchedProperty: entry.property,
    confidence: score,
    property: entry.property,
    embeddingReady,
    scoreGapTop2,
    answerText: ans,
    top3: top3.map((s) => ({ id: s.entry.id, score: s.score })),
  });

  return {
    answer: ans,
    suggestWhatsApp,
    matchedId: entry.id,
    matchedProperty: entry.property,
    confidence: score,
    embeddingReady,
    propertyDetected: property,
    top3: top3.map((s) => ({ id: s.entry.id, score: s.score })),
    ...(debug && { _debug: { top3: top3.map((s) => ({ id: s.entry.id, score: s.score })) } }),
  };
}

function logFeedback(payload) {
  const logPath = path.join(__dirname, '..', '..', 'training-data', 'chat_feedback.jsonl');
  const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n';
  try {
    fs.appendFileSync(logPath, line);
  } catch {
    // Non-fatal
  }
}

/** Health info for admin/monitoring: embeddings status, FAQ count, last warm time */
function getChatHealth() {
  const faq = loadFaq();
  return {
    embeddingsLoaded: embeddingCacheReady,
    faqCountEmbedded: embeddingCache ? embeddingCache.length : 0,
    lastWarmTime: lastWarmTime || null,
    kbVersion: faq.version || 'unknown',
  };
}

module.exports = {
  retrieve,
  warmEmbeddings,
  getChatHealth,
  logUnansweredQuestion,
  logFeedback,
  loadFaq,
  classifyIntent,
  MIN_CONFIDENCE,
};
