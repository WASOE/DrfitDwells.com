# Image Metadata Verification Guide
## For Accurate Image Categorization and Selection

**Purpose:** This document helps verify and update image metadata so AI can select the correct images based on specific content requirements.

---

## ⚠️ Images Needing Verification

### Valley Images - Need to Identify Stone House Front

The following Valley images need to be visually verified to identify which one shows the **Stone House front exterior**:

1. **`1760891828283-4dj2r5qvw0p-WhatsApp-Image-2025-10-14-at-2.05.18-PM-(3).jpeg`**
   - Currently described as: Panoramic swing area (based on user feedback)
   - ⚠️ **DOES NOT show Stone House front**
   - Shows: Swing with mountain view

2. **`1760891856097-tkq4ums108j-WhatsApp-Image-2025-10-14-at-2.05.18-PM.jpeg`**
   - Currently described as: A-frame cabin exterior with front porch
   - ✅ Verified: A-frame (not Stone House)

3. **`1760891860480-135mocsa00t-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(6).jpeg`**
   - Currently described as: Panoramic valley landscape view
   - ❓ **VERIFY:** Does this show Stone House front?

4. **`1760891864528-oo96olwh9l-WhatsApp-Image-2025-10-14-at-2.05.17-PM-(1).jpeg`**
   - Currently described as: Luxury cabin interior
   - ✅ Verified: Interior (not Stone House front)

---

## 🔍 What to Look For - Stone House Front

The Stone House front exterior should show:
- ✅ Stone/brick walls (not wood)
- ✅ Front entrance/door
- ✅ Historic stone architecture
- ✅ Mountain backdrop
- ✅ Clear view of the building facade

**NOT:**
- ❌ Swing sets
- ❌ A-frame structures
- ❌ Interior views
- ❌ Just landscape without building

---

## 📝 Metadata Update Process

When verifying images, update `imageMetadata.js` with:

```javascript
'/path/to/image.jpeg': {
  location: 'valley',
  subject: 'EXACT SUBJECT (e.g., "Stone House Front Exterior")',
  perspective: 'exterior|interior|landscape|aerial',
  content: 'DETAILED description: What buildings, features, angles, time of day, weather, etc.',
  seo: {
    alt: 'SEO-optimized alt text: Location + subject + details + location context',
    title: 'Descriptive title',
    description: 'Full description for SEO and context'
  },
  tags: ['specific', 'searchable', 'tags'],
  useCases: ['when-to-use-this-image']
}
```

---

## 🎯 Current Status

- ✅ **Metadata system created** - Comprehensive database structure ready
- ✅ **Helper functions created** - Can search by location, subject, tags
- ✅ **SEO optimization** - Alt text and descriptions structured
- ⚠️ **Verification needed** - Valley images need visual verification to identify Stone House front

---

## 🔧 How to Use This System

### For AI/Code:
```javascript
import { findImagesByCriteria, getImageMetadata } from '../data/imageMetadata';

// Find images showing Stone House front
const stoneHouseImages = findImagesByCriteria({
  location: 'valley',
  subject: 'Stone House',
  tags: ['front', 'exterior', 'entrance']
});

// Get specific image metadata
const metadata = getImageMetadata('/path/to/image.jpg');
console.log(metadata.content); // Detailed description
console.log(metadata.seo.alt); // SEO alt text
```

### For Humans:
1. Open image file
2. Verify what it actually shows
3. Update metadata in `imageMetadata.js`
4. Use `findImagesByCriteria()` to find correct images

---

## 📋 Next Steps

1. ✅ System created - Metadata database structure ready
2. ⏳ **VERIFY** - Visually check which Valley image shows Stone House front
3. ⏳ **UPDATE** - Fix metadata for verified images
4. ⏳ **APPLY** - Update all components to use metadata system
5. ⏳ **EXTEND** - Add metadata for all 57 Cabin images with specific details
