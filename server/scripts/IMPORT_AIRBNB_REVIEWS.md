# Import Airbnb Reviews for Bucephalus (797914705574649299)

**Goal:** Get all 4★ and 5★ reviews, convert 4★ to 5★, import into The Cabin.

---

## Option 1: Apify (Recommended – ~$0.42 for 140 reviews)

1. Go to [Apify Airbnb Reviews Scraper](https://apify.com/automation-lab/airbnb-reviews)
2. Click **Try for free** (free $5 credits)
3. Input: `https://nl.airbnb.com/rooms/797914705574649299` or just `797914705574649299`
4. Click **Start** → wait ~10–30 seconds
5. Download **JSON** from the dataset
6. Run:

```bash
cd server
node scripts/processAirbnbReviews.js --file /path/to/downloaded.json --listing 797914705574649299 --out reviews-processed.json
node scripts/importReviews.js --file reviews-processed.json --cabin "The Cabin"
```

---

## Option 2: Airbnb Official Data Export

1. Log in to Airbnb as host
2. **Account** → **Privacy & sharing** → **Request your personal data**
3. Choose **JSON** format
4. Wait for email (usually 24–48 hours)
5. Unzip → use `JSON/reviews.json`
6. Run:

```bash
cd server
node scripts/processAirbnbReviews.js --file /path/to/reviews.json --listing 797914705574649299 --out reviews-processed.json
node scripts/importReviews.js --file reviews-processed.json --cabin "The Cabin"
```

---

## Option 3: Chrome Extension

1. Install **Airbnb Review Exporter** from Chrome Web Store
2. Open the listing page, run the exporter
3. Save as CSV or JSON
4. Run `processAirbnbReviews.js` then `importReviews.js` as above

---

## What the processor does

- Keeps only 4★ and 5★ reviews
- Converts all 4★ to 5★
- Outputs JSON ready for `importReviews.js`
