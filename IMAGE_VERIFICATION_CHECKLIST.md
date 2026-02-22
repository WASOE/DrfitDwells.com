# Image Verification Checklist
## Identify Correct Images by Visual Inspection

**Purpose:** This checklist helps verify which image shows what, so we can update metadata accurately and fix the Stone House image selection issue.

---

## 🔍 Valley Images - Visual Verification Needed

Please open each image file and check what it shows, then update the metadata accordingly:

### Image 1: `1760891828283-4dj2r5qvw0p-WhatsApp-Image-2025-10-14-at-2.05.18-PM-(3).jpeg`
- **Current Metadata:** Panoramic swing area
- **Currently Used For:** Stone House portal (WRONG - needs fixing)
- **✅ Verified Content:** ____________________ (Fill in what you see)
- **Shows Stone House Front?** ❌ YES / ✅ NO
- **If not Stone House, what does it show?** ____________________

### Image 2: `1760891856097-tkq4ums108j-WhatsApp-Image-2025-10-14-at-2.05.18-PM.jpeg`
- **Current Metadata:** A-frame cabin exterior with front porch
- **Currently Used For:** A-frame showcase, "The Vibe" gallery
- **✅ Verified Content:** ____________________ (Fill in what you see)
- **Shows A-Frame?** ❌ YES / ✅ NO
- **Details:** ____________________

### Image 3: `1760891860480-135mocsa00t-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(6).jpeg`
- **Current Metadata:** ⚠️ NEEDS VERIFICATION - May be Stone House Front or Valley Landscape
- **Currently Used For:** Stone House portal (temporarily), "The Vibe" gallery bottom right
- **✅ Verified Content:** ____________________ (Fill in what you see)
- **🔍 CRITICAL: Shows Stone House Front Exterior?** ❌ YES / ✅ NO
- **If YES:** Update metadata with: "Front exterior of historic stone house showing stone walls, entrance..."
- **If NO:** What does it show? ____________________

### Image 4: `1760891864528-oo96olwh9l-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(1).jpeg`
- **Current Metadata:** Luxury cabin interior
- **Currently Used For:** Luxury Cabin portal
- **✅ Verified Content:** ____________________ (Fill in what you see)
- **Shows Interior?** ❌ YES / ✅ NO
- **Which room/space?** ____________________

---

## 🏠 Content Website Images - Verification

### Valley-Related (Verify these are actually Valley images):

**`drift-dwells-bulgaria-fireside-lounge.avif`**
- Currently used in: "The Vibe" gallery top right
- Shows: Communal fireplace/Stone House interior?
- **Verify:** Is this Stone House interior or another space? ____________________

**`drift-dwells-bulgaria-river-letters.avif`**
- Currently used in: "The Vibe" gallery bottom left
- Shows: River/stream scene
- **Verify:** Is this in The Valley area or near Cabin? ____________________

**`drift-dwells-bulgaria-starlit-mountain.avif`**
- Currently used in: "The Vibe" gallery large hero image
- Shows: Night landscape with stars
- **Verify:** Is this Valley area or generic mountain? ____________________

---

## ✅ Action Items

### Immediate (Critical):
1. **Identify Stone House Front Image**
   - Check all 4 Valley images visually
   - Which one shows: Stone walls, front entrance, Stone House architecture?
   - If none show it, we may need to add a new image or use a different source

2. **Update Metadata**
   - Once identified, update `imageMetadata.js` with accurate description
   - Mark the correct image for Stone House portal use

3. **Fix TheValley.jsx**
   - Update Stone House portal to use verified correct image
   - Update SEO alt text

### Secondary:
4. Verify all Content website images are correctly categorized
5. Add detailed metadata for all 57 Cabin images
6. Update all components to use metadata system

---

## 📝 Template for Adding New Image Metadata

```javascript
'/path/to/image.jpg': {
  location: 'valley', // or 'cabin' or 'generic'
  subject: 'EXACT SUBJECT - Be Specific', // e.g., 'Stone House Front Exterior'
  perspective: 'exterior', // or 'interior', 'landscape', 'aerial', 'detail'
  content: 'DETAILED DESCRIPTION: What buildings/features are visible? What angle? What time of day? What's in foreground/background?',
  seo: {
    alt: 'SEO alt text: Location + Subject + Key Details + Geographic Context',
    title: 'Descriptive Title for SEO',
    description: 'Full paragraph description for SEO meta tags and image context'
  },
  tags: ['specific', 'searchable', 'tags', 'stone-house', 'front', 'exterior'],
  useCases: ['when-to-use-this-specific-image']
}
```

---

## 🎯 Success Criteria

✅ **Stone House Front Image:**
- [ ] Identified which image shows Stone House front exterior
- [ ] Metadata updated with accurate description
- [ ] TheValley.jsx updated to use correct image
- [ ] SEO alt text reflects: "Front exterior of historic stone house..."

✅ **All Images:**
- [ ] Every image has detailed content description
- [ ] Every image has SEO-optimized alt text
- [ ] Every image has proper categorization (location, subject, perspective)
- [ ] All images searchable by criteria (e.g., "Stone House front exterior")

---

**Next Step:** Visual inspection of Valley images to identify Stone House front, then update metadata accordingly.
