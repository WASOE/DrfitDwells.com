# Drift & Dwells Booking Widget - v1.1.0 Update

## 🎯 New Features

### Inline Booking Form Shortcode
- **New shortcode**: `[drift_dwells_inline]` 
- Renders a fixed inline booking form (no modal popup)
- Perfect for hero sections and prominent page placement
- Same functionality as modal widget but embedded directly

### Enhanced Modal Shortcode
- **Backward compatible**: `[drift_dwells_booking]` works exactly as before
- **New parameters** added for both shortcodes:
  - `default_adults` - Set default number of adults
  - `default_children` - Set default number of children  
  - `min_nights` - Minimum nights for auto-correction
  - `prefill` - Auto-prefill from URL parameters

### Auto-Prefill Functionality
- Reads `checkIn`, `checkOut`, `adults`, `children` from page URL
- Automatically fills form fields when `prefill="auto"` (default)
- Seamless integration with deep-linking

### Enhanced Validation & Auto-Correction
- **Smart date handling**:
  - If only `checkIn` provided → auto-set `checkOut = checkIn + min_nights`
  - If `checkOut ≤ checkIn` → auto-correct `checkOut = checkIn + 1`
- **Guest count validation**:
  - Adults min 1, max 10 (clamped automatically)
  - Children min 0, max 10 (clamped automatically)

## 📱 Responsive Design
- **Inline forms**: Full-width on mobile, compact row layout on desktop
- **Touch-friendly**: Large tap targets (48px minimum)
- **Mobile optimized**: Stacked layout on small screens

## ♿ Accessibility Improvements
- **Fieldset semantics**: Proper form grouping with legend
- **Enhanced ARIA labels**: Better screen reader support
- **Keyboard navigation**: Logical tab order, Enter to submit
- **Focus management**: Clear focus indicators

## 🎨 Visual Enhancements
- **Consistent styling**: Matches existing modal design language
- **Premium appearance**: Shadows, borders, rounded corners
- **Theme compatibility**: Scoped CSS with `ddw-` prefix

## 📋 Usage Examples

### Modal Button (Enhanced)
```php
// Basic (unchanged from v1.0.0)
[drift_dwells_booking]

// With new parameters
[drift_dwells_booking label="Book now" default_adults="2" default_children="1" min_nights="3" prefill="auto"]
```

### Inline Form (New)
```php
// Basic inline form
[drift_dwells_inline]

// With custom defaults
[drift_dwells_inline default_adults="2" default_children="1" min_nights="3" prefill="auto"]

// With custom styling
[drift_dwells_inline class="hero-booking-form" default_adults="4"]
```

## 🔧 Technical Details

### File Changes
- **Enhanced**: `drift-dwells-booking.php` (19.7KB → 19.7KB)
- **New**: `assets/wordpress-widget.js` (26.7KB) - Full development version
- **Updated**: `assets/wordpress-widget.min.js` (17.1KB) - Minified version
- **Enhanced**: `assets/style.css` (7.2KB) - Added inline form styles
- **Updated**: `readme.txt` (7.1KB) - Documentation updates

### Backward Compatibility
- ✅ **100% compatible** with existing installations
- ✅ **No breaking changes** to existing shortcodes
- ✅ **Same behavior** for `[drift_dwells_booking]`
- ✅ **Existing attributes** still work: `label`, `destination`, `class`, `style`

### Performance
- **Lightweight**: Only 21KB total (vs 13KB in v1.0.0)
- **Efficient**: Assets only load when shortcodes are used
- **Optimized**: Minified production assets included

## 🧪 Testing Checklist

### Modal Shortcode
- [x] Renders button and opens modal
- [x] Form validation works
- [x] Deep-linking with correct parameters
- [x] Backward compatibility maintained
- [x] New parameters work correctly

### Inline Shortcode  
- [x] Renders inline form (no modal)
- [x] Form validation works
- [x] Deep-linking with correct parameters
- [x] Responsive design (mobile/desktop)
- [x] Accessibility features work

### Both Variants
- [x] Respect all parameters (`default_*`, `min_nights`, `prefill`)
- [x] Auto-prefill from URL when `prefill="auto"`
- [x] Generate identical deep-link URLs
- [x] Apply auto-corrections as specified
- [x] Mobile + desktop layouts verified

## 🚀 Installation

### Upgrade from v1.0.0
1. **Backup** your current plugin (optional but recommended)
2. **Deactivate** the current plugin
3. **Upload** `drift-dwells-booking-v1.1.0.zip`
4. **Activate** the plugin
5. **No configuration needed** - existing shortcodes work unchanged

### Fresh Installation
1. **Upload** `drift-dwells-booking-v1.1.0.zip` via WordPress admin
2. **Activate** the plugin
3. **Configure** settings under Settings → Drift & Dwells Booking
4. **Add shortcodes** to your pages

## 📝 Migration Notes

### For Existing Users
- **No action required** - existing shortcodes work unchanged
- **New features** are opt-in via new parameters
- **Default behavior** remains identical to v1.0.0

### For New Users
- **Two shortcodes available**:
  - `[drift_dwells_booking]` - Modal popup (recommended for headers/footers)
  - `[drift_dwells_inline]` - Inline form (recommended for hero sections)

## 🔍 Troubleshooting

### Common Issues
1. **Inline form not showing**: Check if shortcode is `[drift_dwells_inline]` (not `[drift_dwells_booking]`)
2. **Auto-prefill not working**: Ensure `prefill="auto"` (default) and URL has parameters
3. **Styling conflicts**: All styles use `ddw-` prefix to prevent conflicts

### Support
- Check browser console for JavaScript errors
- Verify shortcode syntax
- Test with default WordPress theme

## 📊 Version Comparison

| Feature | v1.0.0 | v1.1.0 |
|---------|--------|--------|
| Modal shortcode | ✅ | ✅ (enhanced) |
| Inline shortcode | ❌ | ✅ (new) |
| Auto-prefill | ❌ | ✅ (new) |
| Enhanced validation | ❌ | ✅ (new) |
| New parameters | ❌ | ✅ (new) |
| File size | 13KB | 21KB |
| Backward compatible | N/A | ✅ (100%) |

---

**Ready for Production** ✅

The v1.1.0 update adds powerful new functionality while maintaining complete backward compatibility. Perfect for hero sections with the new inline form, while keeping the modal option for headers and footers.


