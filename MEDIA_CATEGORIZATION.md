# Media Categorization Guide
## Drift & Dwells Booking Portal - Image & Video Organization

This document categorizes all media files to prevent using Cabin images in Valley sections and vice versa.

---

## 📍 Location Definitions

- **THE CABIN (Bachevo)**: Off-grid mountain cabin near Bachevo in the Rhodope Mountains
- **THE VALLEY (Chereshovo/Ortsevo)**: Mountain village at 1,550m altitude with A-frames and Stone House

---

## 🏠 THE CABIN (Bachevo) - Images

### Direct Cabin Images
Located in: `/uploads/The Cabin/`
- All 57 images in this folder are cabin-specific
- These are duplicate of `/uploads/cabins/68b83f3dadecaa65dbbe560f/original/`
- ✅ **USE FOR: The Cabin page, cabin details, cabin galleries**

### Content Website - Cabin Images
Located in: `/uploads/Content website/`
- `drift-dwells-bulgaria-bucephalus-suite.avif` ✅ CABIN (interior suite)
- `drift-dwells-bulgaria-cabin-journal.avif` ✅ CABIN (interior/journal)
- `drift-dwells-bulgaria-cabin-path.png` ✅ CABIN (path to cabin)
- `drift-dwells-bulgaria-fern-study.png` ⚠️ NEEDS VERIFICATION (may be Valley)
- `drift-dwells-bulgaria-lake-dawn.png` ⚠️ NEEDS VERIFICATION (may be Valley)
- `drift-dwells-bulgaria-rainy-eaves.avif` ✅ CABIN (cabin exterior in rain)
- `drift-dwells-bulgaria-valley-haven.avif` ❌ **MISCLASSIFIED** - Actually CABIN (Bachevo interior), NOT Valley!
- `drift-dwells-bulgaria-campfire-night.avif` ❌ **MISCLASSIFIED** - Actually CABIN (front porch with 2 seats), NOT Valley!
- `drift-dwells-bulgaria-meadow-trail.avif` ⚠️ **NEEDS VERIFICATION** - May be Cabin, not Valley

### Decorative/Generic (Can be used for Cabin or general)
- `drift-dwells-bulgaria-firepit-sketch.png` ⚠️ GENERIC (sketch illustration)
- `drift-dwells-bulgaria-lantern-walk.png` ⚠️ GENERIC (could be either, used in gallery)
- `drift-dwells-bulgaria-pine-sketch.png` ⚠️ GENERIC (sketch illustration)
- `drift-dwells-bulgaria-vintage-map.png` ⚠️ GENERIC (map illustration)

---

## ⛰️ THE VALLEY (Chereshovo/Ortsevo) - Images

### Direct Valley Images
Located in: `/uploads/The Valley/`
- `1760891828283-4dj2r5qvw0p-WhatsApp-Image-2025-10-14-at-2.05.18-PM-(3).jpeg` ✅ VALLEY
- `1760891856097-tkq4ums108j-WhatsApp-Image-2025-10-14-at-2.05.18-PM.jpeg` ✅ VALLEY
- `1760891860480-135mocsa00t-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(6).jpeg` ✅ VALLEY
- `1760891864528-oo96olwh9l-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(1).jpeg` ✅ VALLEY

### Content Website - Valley Images
Located in: `/uploads/Content website/`
- `drift-dwells-bulgaria-valley-haven.avif` ❌ **MISCLASSIFIED** - Actually CABIN (Bachevo interior) - DO NOT USE FOR VALLEY!
- `drift-dwells-bulgaria-meadow-trail.avif` ⚠️ **NEEDS VERIFICATION** - May be Cabin, not Valley
- `drift-dwells-bulgaria-starlit-mountain.avif` ✅ VALLEY (mountain/starry sky - valley context)
- `drift-dwells-bulgaria-campfire-night.avif` ❌ **MISCLASSIFIED** - Actually CABIN (front porch with 2 seats) - DO NOT USE FOR VALLEY!
- `drift-dwells-bulgaria-fireside-lounge.avif` ⚠️ NEEDS VERIFICATION
- `drift-dwells-bulgaria-river-letters.avif` ⚠️ NEEDS VERIFICATION
- `SKy-view-Aframe.jpg` ✅ VALLEY (aerial view of A-frames in valley)

**⚠️ IMPORTANT:** Use only images from `/uploads/The Valley/` folder for Valley pages until Content website images are verified!

---

## 🎥 Videos

### THE CABIN Videos
Located in: `/uploads/Videos/`
- `The-cabin-header.mp4` ✅ CABIN (hero video)
- `Dark-fire-cabin.mp4` ✅ CABIN (cabin fire scene)
- `Dark-fire-cabin-poster.jpg` ✅ CABIN (video poster)

### THE VALLEY Videos
Located in: `/uploads/Videos/`
- `The-Valley-firaplace-video.mp4` ✅ VALLEY (valley fireplace)
- `The-Valley-From-the-Sky.mp4` ✅ VALLEY (aerial view)
- `The-Valley-Night-Stars.mp4` ✅ VALLEY (night/stars)
- `Light-aframes.mp4` ✅ VALLEY (A-frames in valley)
- `Light-aframes-poster.jpg` ✅ VALLEY (video poster)

### Unclassified Videos (Need Review)
Located in: `/uploads/Videos/Video content/`
- `download (15).mp4` ⚠️ UNKNOWN (needs review)
- `download (22).mp4` ⚠️ UNKNOWN (needs review)
- `download (27).mp4` ⚠️ UNKNOWN (needs review)

---

## 🚫 Known Issues / Misplacements

### Currently Used Incorrectly

1. **`drift-dwells-bulgaria-cabin-path.png`**
   - Used in: `TheValley.jsx` line 706 (A-Frames portal)
   - Should be: VALLEY image (cabin-path might be confusing, but it's used for Valley A-frames section)
   - ✅ Actually correct - "cabin-path" refers to path between A-frames in valley

2. **Mixed Usage in MemoryStream & PolaroidGallery**
   - These components mix cabin and valley images for general ambiance
   - ✅ This is intentional for homepage/general galleries

---

## 📋 Usage Rules

### DO ✅
- Use Cabin images ONLY in `/cabin` routes and Cabin-related components
- Use Valley images ONLY in `/valley` routes and Valley-related components
- Use generic/decorative images in shared sections (homepage, general galleries)
- Check this document when adding new images

### DON'T ❌
- Use Cabin images in Valley pages/components
- Use Valley images in Cabin pages/components
- Mix location-specific images without explicit reason
- Use images from wrong location folder

---

## 🔍 Quick Reference

### Cabin Image Paths (Use in TheCabin.jsx, CabinDetails.jsx)
```
/uploads/The Cabin/*.jpeg
/uploads/Content website/drift-dwells-bulgaria-bucephalus-suite.avif
/uploads/Content website/drift-dwells-bulgaria-cabin-journal.avif
/uploads/Content website/drift-dwells-bulgaria-cabin-path.png
/uploads/Content website/drift-dwells-bulgaria-fern-study.png
/uploads/Content website/drift-dwells-bulgaria-lake-dawn.png
/uploads/Content website/drift-dwells-bulgaria-rainy-eaves.avif
```

### Valley Image Paths (Use in TheValley.jsx, AFrameDetails.jsx)
```
/uploads/The Valley/*.jpeg
/uploads/Content website/drift-dwells-bulgaria-valley-haven.avif
/uploads/Content website/drift-dwells-bulgaria-meadow-trail.avif
/uploads/Content website/drift-dwells-bulgaria-starlit-mountain.avif
/uploads/Content website/drift-dwells-bulgaria-campfire-night.avif
/uploads/Content website/drift-dwells-bulgaria-fireside-lounge.avif
/uploads/Content website/drift-dwells-bulgaria-river-letters.avif
/uploads/Content website/SKy-view-Aframe.jpg
```

### Generic/Shared Images (Can be used anywhere)
```
/uploads/Content website/drift-dwells-bulgaria-firepit-sketch.png
/uploads/Content website/drift-dwells-bulgaria-lantern-walk.png
/uploads/Content website/drift-dwells-bulgaria-pine-sketch.png
/uploads/Content website/drift-dwells-bulgaria-vintage-map.png
```

---

## 📝 Notes

- All images in `/uploads/The Cabin/` folder are duplicates of `/uploads/cabins/68b83f3dadecaa65dbbe560f/original/`
- The "Content website" folder contains mixed content - always verify location before use
- Decorative/illustration files (sketches, maps) can be used generically
- When in doubt, check the filename for "cabin" vs "valley" keywords
