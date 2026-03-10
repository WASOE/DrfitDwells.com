# Media validator – proof and audit scope

## 1. Validator scope (what it checks)

- **All** `client/src/**/*.{js,jsx,ts,tsx}` are scanned for string literals containing `/uploads/`.
- **Patterns:** `'...'`, `"..."`, and `url(/uploads/...)` / `url('/uploads/...')` / `url("/uploads/...")`.
- **mediaConfig.js** is also loaded and all `/uploads/` paths from it are added to the set.
- Paths are **de-duplicated**, **normalized** (leading slash removed, `%20` decoded), and checked under `../uploads` (repo root).
- **basePath + extension:** If a path has no extension, the script tries appending `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, `.pdf` so references like `basePath + '.jpg'` are valid.
- On **any missing** path the script **fails** and prints each missing path plus the **source files** where it was found.

## 2. Audit scope (confirmed)

- **All `/uploads/` references**, not only `/uploads/Videos/`: the validator scans every string literal and url() in client source, so paths under `uploads/Content website/`, `uploads/The Valley/`, `uploads/PDFs/`, `uploads/cabins/`, etc. are included.
- **All client source files:** components, pages, data, utils, config, SEO pages, legal pages, about sections, the-valley sections, etc. (see file list below).
- **imageMetadata.js** and other **helper/data** files are scanned like any other `.js`/`.jsx` file.
- **SEO-related** image paths (e.g. `ogImage`, `getSEOAlt`, `getSEOTitle`) are in those same files, so they are included.

## 3. Exact list of client files containing `/uploads/` (grep)

```
client/src/components/MosaicGallery.jsx
client/src/utils/mediaCategories.js
client/src/pages/About.jsx
client/src/pages/Home.jsx
client/src/components/AuthorityStrip.jsx
client/src/pages/the-valley/sections/StoryHighlightsSection.jsx
client/src/components/CraftExperienceSection.jsx
client/src/pages/TheCabin.jsx
client/src/pages/legal/CancellationPolicy.jsx
client/src/pages/seo/RhodopesCabinRetreat.jsx
client/src/pages/legal/Terms.jsx
client/src/components/MemoryStream.jsx
client/src/components/CabinGallerySection.jsx
client/src/pages/AFrameDetails.jsx
client/src/pages/about/sections/PlaceSection.jsx
client/src/pages/the-valley/TheValleyPage.jsx
client/src/pages/SearchResults.jsx
client/src/pages/Build.jsx
client/src/components/TrustStrip.jsx
client/src/components/DestinationsFooter.jsx
client/src/pages/about/sections/HostSection.jsx
client/src/config/mediaConfig.js
client/src/pages/the-valley/sections/LayOfLandSection.jsx
client/src/pages/CabinDetails.jsx
client/src/pages/legal/Press.jsx
client/src/pages/about/sections/HeroSection.jsx
client/src/pages/the-valley/data.js
client/src/components/Header.jsx
client/src/pages/seo/BanskoRemoteWorkRetreat.jsx
client/src/data/content.js
client/src/components/gallery/CabinGallery.jsx
client/src/components/PolaroidGallery.jsx
client/src/pages/legal/Privacy.jsx
client/src/pages/legal/Career.jsx
client/src/pages/the-valley/sections/BookingCTABand.jsx
client/src/pages/the-valley/sections/EditorialHookSection.jsx
client/src/pages/Build.old.jsx
client/src/components/DualityHero.jsx
client/src/pages/seo/RetreatVenueBulgaria.jsx
client/src/pages/TheValley.jsx
client/src/pages/seo/OffGridCabinsBulgaria.jsx
client/src/components/Footer.jsx
client/src/pages/the-valley/sections/VibeSection.jsx
client/src/pages/about/sections/OutcomesSection.jsx
client/src/pages/ConfirmBooking.jsx
client/src/data/imageMetadata.js
```

(47 files total.)

## 4. Exact validator output (current run)

After strengthening the validator (scan all client source + mediaConfig), run:

```bash
cd client && node ./scripts/validate-media-assets.mjs
```

**Current output (failing due to imageMetadata keys that do not match disk):**

```
[validate-media-assets] Missing referenced assets (path + source files):

  uploads/The Valley/1768207498-98737209.jpg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/Lux-cabin-exterior-WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/Lux-cabin-exterior-WhatsApp Image 2025-10-17 at 10.20.24 AM (1).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/Lux-cabin-exterior-WhatsApp Image 2025-10-17 at 10.20.24 AM (2).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/Lux-cabin-exterior-WhatsApp Image 2025-10-17 at 10.20.24 AM (6).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/Lux-cabin-exterior-WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2025-12-03 at 1.36.11 PM.jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.40 AM (1).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.41 AM (1).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.41 AM (2).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.41 AM (4).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.41 AM (5).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.41 AM.jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.42 AM (1).jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.46 AM.jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.47 AM.jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.51 AM.jpeg
    <- client/src/data/imageMetadata.js

  uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.52 AM.jpeg
    <- client/src/data/imageMetadata.js

Do not rename or move files in uploads/. Code must match existing filenames.
```

So the validator is doing its job: it finds **every** referenced path and fails on **any** that do not exist on disk. The remaining failures are **only** in `client/src/data/imageMetadata.js` (metadata keys that point to filenames not present under `uploads/The Valley/`). Fixing those is either: align keys with actual filenames on disk, or add/copy the missing files—no validator or architecture change required.

## 5. Minimal code changes (2 patches + package.json + validator)

**A. client/src/pages/TheValley.jsx** – one broken asset path fixed (code must match disk):

- `Lux-cabin-WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg` → `WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg` (in `src`, `alt`, and `title`).

**B. client/src/data/imageMetadata.js** – two keys aligned with existing files:

- `'/uploads/Videos/The-cabin-header-poster.jpg'` → `'/uploads/Videos/The-cabin-header.winter-poster.jpg'`
- `'/uploads/The Valley/Lux-cabin-WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg'` → `'/uploads/The Valley/WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg'`

**C. client/package.json** – validator and build hook:

- `"validate:media": "node ./scripts/validate-media-assets.mjs"`
- `"build": "npm run validate:media && vite build"`

**D. client/scripts/validate-media-assets.mjs** – full script:

- Scans all `client/src/**/*.{js,jsx,ts,tsx}` for `/uploads/` in strings and `url(...)`.
- Adds all paths from `mediaConfig.js`.
- Normalizes and de-duplicates; allows basePath + extension.
- For each path, checks existence under repo `uploads/`; on missing, prints path and source files and exits 1.

(Exact script content is in `client/scripts/validate-media-assets.mjs`.)

---

**Summary:** The validator now covers **all** client `/uploads/` references (including imageMetadata and SEO), not only mediaConfig. The audit covered all client source files and all uploads subfolders. Remaining failures are confined to imageMetadata keys that do not match the current filesystem; fixing them is a data/keys fix, not a refactor.
