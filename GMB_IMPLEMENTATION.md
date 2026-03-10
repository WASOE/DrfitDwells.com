# Google My Business (GBP) – Implementation Status

## Implemented

### 1. **GMB locations config** (`client/src/data/gmbLocations.js`)
- **Phone:** +359 87 634 2540 ✓
- **The Cabin:** 2769 Bachevo area, Blagoevgrad Province ✓
- **The Valley:** 2787 Chereshovo area, Blagoevgrad Province ✓
- **Maps links:** Google Maps share URLs for exact GMB listing

### 2. **Address strategy (forest / coordinate-based locations)**
For locations without street addresses, best practice:
- **PostalAddress:** locality + postalCode + region + country (no street)
- **GeoCoordinates:** latitude/longitude for map placement
- **hasMap:** URL to Google Maps listing in schema
- Display: "Bachevo area, 2769" / "Chereshovo area, 2787"

### 3. **Schema.org structured data**
- LodgingBusiness: telephone, address, geo, hasMap, openingHours
- Organization on Home with telephone

### 4. **Get directions & Call**
- Links to Google Maps share URLs (Cabin + Valley)
- Override via `VITE_GMB_CABIN_MAPS_URL` / `VITE_GMB_VALLEY_MAPS_URL` if needed

---

## Manual steps (in GMB dashboard)

| Item | Action |
|------|--------|
| Valley verification | Complete verification in business.google.com |
| Facade photos, posts | Add in GMB profile |
| Reviews | Manage (no incentives) |
