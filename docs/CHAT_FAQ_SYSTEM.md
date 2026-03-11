# Drift & Dwells Guest Chat / FAQ System

Intent + semantic FAQ retrieval. Answers from structured content first, suggests WhatsApp when confidence is low.

## Soft Launch — Do Not Trust For

- Payments, refunds, booking references
- Complaints, legal/policy-sensitive questions
- Anything requiring human judgment

Route these to WhatsApp. The chat is for FAQ and pre-booking questions only.

## Architecture

- **Intent classification**: Rule-based phrase patterns (access, amenities, pricing, etc.) — prevents wrong-intent matches
- **Intent-gated retrieval**: Only score FAQs that match the classified intent
- **Semantic + phrase scoring**: Embeddings (@xenova/transformers) + phrase overlap; fallback to phrase-only if model fails
- **Confidence threshold**: 0.55 default; 0.48 for strong topical matches (wood+price, hot tub+included)
- **Exact phrase layer**: High-frequency questions matched before embeddings (wood cost, firewood included, etc.)
- **Sub-intents**: Hot tub split into hot_tub_*; access split into access_normal_car, access_4x4, access_after_dark, access_google_maps
- **Lazy-loaded widget**: Chat JS loads only when user clicks — zero impact on initial page speed

## Files

| File | Purpose |
|------|---------|
| `server/data/faqKnowledgeBase.json` | FAQ entries: intent, canonical_question, alternative_phrasings, full_answer |
| `server/data/chatOperationalConfig.js` | **Operational pricing** (hot tub wood BGN, etc.) — single source of truth, not in FAQ text |
| `server/data/chatGuardrails.js` | Out-of-scope patterns |
| `server/services/chatService.js` | Intent classification, phrase + semantic retrieval, confidence threshold |
| `server/routes/chatRoutes.js` | `POST /api/chat`, `GET /api/chat/whatsapp` |
| `client/src/components/ChatWidget.jsx` | Chat UI (messages, input, WhatsApp CTA) |
| `client/src/components/ChatWidgetLazy.jsx` | Lazy wrapper — loads ChatWidget only on first click |
| `training-data/` | Training pack, unanswered log |

## API

**POST /api/chat**
```json
{ "query": "Can I reach with a normal car?", "propertyContext": "cabin" }
```

`propertyContext`: `"cabin"` | `"valley"` | omitted. When set, retrieval **hard-filters** FAQ entries to that property (or `both`). Page sends this from the current route.
Response:
```json
{
  "success": true,
  "answer": "It's an off-road place...",
  "suggestWhatsApp": false,
  "whatsAppLink": "https://wa.me/359876342540"
}
```

When no match:
```json
{
  "success": true,
  "answer": null,
  "suggestWhatsApp": true,
  "message": "I'd love to help with that personally...",
  "whatsAppLink": "https://wa.me/359876342540"
}
```

## Operational Config (Pricing)

`server/data/chatOperationalConfig.js` holds values that change over time:

- `hotTubWoodBgn` — cost when host provides wood for hot tub (default 50)
- `cabinFirewoodIncluded` — cabin heating firewood included in booking
- `horseRidingBgnPerHour` — horse riding at The Cabin

FAQ answers use `{{hotTubWoodBgn}}` placeholders; chatService interpolates at runtime. **Update config when prices change** — do not edit FAQ text.

## FAQ Entry Schema

```json
{
  "id": "access_valley",
  "property": "valley",
  "intent": "access",
  "canonical_question": "How do I get to The Valley?",
  "alternative_phrasings": ["how can I get to the valley", "can I reach the valley with a normal car", ...],
  "short_answer": "...",
  "full_answer": "...",
  "escalation_rule": "suggestWhatsApp",
  "upsell_hint": null
}
```

## Logs & Tuning

| File | Purpose |
|------|---------|
| `training-data/chat_interactions.jsonl` | Every query: query, intent, matchedId, **propertyContext**, **matchedProperty**, confidence, outcome, **matchType**, embeddingReady, scoreGapTop2, kbVersion, answerText, top3 |
| `training-data/chat_feedback.jsonl` | Thumbs: query, rating, matchedId, **answerText**, **top3**, **propertyDetected**, **embeddingReady** |
| `training-data/chat_unanswered.log` | Queries that fell through to WhatsApp |

**embeddingReady** = false means phrase-only fallback (Xenova model failed). Critical for debugging quality drops.

### Review script

```bash
npm run chat:review [-- --limit 20] [-- --outcome answered]
```

Shows query, answer, intent, matchedId, confidence, top3, thumbs, embeddingReady. Use to clean up from real traffic.

## Chat Health (admin)

`GET /api/chat/health` returns:

```json
{
  "embeddingsLoaded": true,
  "faqCountEmbedded": 15,
  "lastWarmTime": "2025-03-11T12:00:00.000Z",
  "kbVersion": "2.0"
}
```

Use to monitor Xenova model load and fallback mode.

## Debug Mode

Add `?debug=1` to the request or header `X-Chat-Debug: 1` to get `_debug: { top3: [{ id, score }] }` in the response.

## Startup Embedding Cache

`chatService.warmEmbeddings()` is called at server startup. FAQ embeddings are precomputed once; no per-request recompute.

## Expanding the FAQ

1. Review `training-data/chat_interactions.jsonl` and `chat_feedback.jsonl` periodically
2. Add new entries to `server/data/faqKnowledgeBase.json` with `intent`, `canonical_question`, `alternative_phrasings`
3. Add intent triggers in `chatService.js` `INTENT_TRIGGERS` if needed
4. Adjust `MIN_CONFIDENCE` (0.55) in `chatService.js` based on logs

### Phrasing coverage

- **10–20 phrasings per entry** for common questions (wood, hot tub, firewood)
- Use real guest wording from logs: "how much is wood", "do we pay for wood", "firewood for inside"
- Add **negative variants**: "so wood is not included?", "we need to pay separately?", "there is an extra charge right?", "not free?"
- Split broad intents into sub-intents (e.g. hot_tub → hot_tub_included, hot_tub_wood_cost, hot_tub_heat_time, hot_tub_winter)
- Put operational pricing in `chatOperationalConfig.js`, not in FAQ text

### Answer formatting (pricing questions)

- **Yes/no first** — e.g. "Yes." or "No—hot tub wood is extra."
- **Price second** — e.g. "50 BGN when we provide it."
- **One practical detail third** — e.g. "Let us know in advance if you want to use it."

### Intent splits (avoid overloaded buckets)

When one topic hides multiple user intents, split into separate entries:

| Topic | Split | Example questions |
|-------|-------|-------------------|
| Hot tub | inclusion vs process | "is it included?" vs "how can I use it?" |
| Access | permission vs process | "can a normal car reach?" vs "how do I get there?" |
| Shower | availability vs expectations | "is there a shower?" vs "how does it work?" |
| WiFi | existence vs reliability | "is there wifi?" vs "how strong is it?" |
| Pets | allowed vs conditions | "are pets allowed?" vs "what are the rules?" |

### Property scope

- Every FAQ entry has `property: cabin | valley | both`.
- **Page context**: Chat sends `propertyContext` from the current route (`/cabin` → cabin, `/valley` → valley).
- **Retrieval**: When `propertyContext` is set, candidates are hard-filtered to that property (or `both`). Cabin entries never surface on Valley page unless user overrides.
- Valley-specific entries (e.g. `valley_no_hot_tub`) handle questions that only apply to Cabin: "Is there a hot tub?" on Valley page → "No. The hot tub is at The Cabin. The Valley has showers, ATV, horse riding."

## Cloudflare Deployment (Future)

The chat endpoint is stateless and uses only JSON + file reads. To move to Cloudflare Workers:

- Replace `fs.readFileSync` with KV or D1 for FAQ storage
- Use `@cloudflare/ai` for optional LLM fallback (Workers AI)
- Deploy as a Worker in front of or instead of the Express route

Current setup runs fine on any Node host (Railway, Render, Fly, etc.) at low scale.
