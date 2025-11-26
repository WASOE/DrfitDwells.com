=== Drift & Dwells Booking Widget ===
Contributors: driftdwells
Tags: booking, reservation, cabin, travel, widget, shortcode, gutenberg
Requires at least: 5.0
Tested up to: 6.4
Requires PHP: 7.4
Stable tag: 1.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Add a beautiful booking widget to your WordPress site that deep-links to Drift & Dwells cabin search with date and guest selection.

== Description ==

The Drift & Dwells Booking Widget plugin allows you to easily add booking functionality to your WordPress site. Visitors can click a button or link to open a date and guest selection widget, which then deep-links to the Drift & Dwells booking portal with pre-filled search parameters.

**Key Features:**

* **Easy Integration**: Add booking triggers using shortcodes or Gutenberg blocks
* **Responsive Design**: Works perfectly on desktop and mobile devices
* **Accessibility**: Full keyboard navigation, screen reader support, and ARIA labels
* **Customizable**: Configure button text, destination URL, and styling
* **No Dependencies**: Lightweight plugin with no external library requirements
* **Theme Compatible**: Scoped CSS prevents conflicts with your theme

**Usage Options:**

1. **Modal Button Shortcode**: `[drift_dwells_booking]` - Opens booking widget in modal
2. **Inline Form Shortcode**: `[drift_dwells_inline]` - Renders inline booking form
3. **Gutenberg Block**: Search for "Drift & Dwells Booking" in the block inserter
4. **Manual HTML**: Add `data-ddw-booking-trigger` to any element

**Shortcode Parameters (both variants):**

* `destination` - Booking portal URL (default: production URL)
* `default_adults` - Default number of adults (default: "2")
* `default_children` - Default number of children (default: "0")
* `min_nights` - Minimum nights for auto-correction (default: "2")
* `prefill` - Auto-prefill from URL params: "auto" or "off" (default: "auto")
* `class` - Additional CSS classes

**Modal Button Additional Parameters:**

* `label` - Button text (default: "Book your stay")
* `style` - Style: "button" or "link" (default: "button")

**Examples:**

**Modal Button (default):**
`[drift_dwells_booking]`

**Modal Button with custom label & defaults:**
`[drift_dwells_booking label="Book now" default_adults="2" default_children="0" min_nights="2" prefill="auto"]`

**Inline Form (hero):**
`[drift_dwells_inline]`

**Inline with explicit defaults:**
`[drift_dwells_inline default_adults="2" default_children="1" min_nights="3" prefill="auto"]`

**Divi Theme Compatibility:**
The plugin works seamlessly with Divi theme and page builder. Both shortcodes can be used in:
* Divi Text modules (Visual and Text tabs)
* Divi Code modules
* Divi Custom HTML modules
* Gutenberg Shortcode blocks
* Classic editor

**Divi Usage Examples:**
* In Divi Text module: `[drift_dwells_inline]`
* In Divi Code module: `[drift_dwells_booking label="Book Now"]`
* In Custom HTML module: `[drift_dwells_inline default_adults="4" class="hero-form"]`

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/drift-dwells-booking` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Configure the plugin settings under Settings > Drift & Dwells Booking.
4. Add booking triggers to your pages using shortcodes or blocks.

== Frequently Asked Questions ==

= How do I add a booking button to my page? =

You can add a booking button in three ways:

1. **Shortcode**: Add `[drift_dwells_booking]` to your page content
2. **Gutenberg Block**: Search for "Drift & Dwells Booking" in the block inserter
3. **Manual HTML**: Add `data-ddw-booking-trigger` to any HTML element

= Can I customize the button text? =

Yes! You can customize the button text using the `label` parameter in the shortcode, or through the block settings in the Gutenberg editor.

= Can I change the destination URL? =

Yes! You can set a custom destination URL using the `destination` parameter, or configure a default URL in the plugin settings.

= Does the plugin work on mobile devices? =

Yes! The plugin is fully responsive and includes touch-friendly interface elements with proper sizing for mobile devices.

= Is the plugin accessible? =

Yes! The plugin includes full accessibility support including keyboard navigation, screen reader compatibility, ARIA labels, and focus management.

= Will this plugin conflict with my theme? =

The plugin uses scoped CSS with unique class prefixes to prevent conflicts with your theme. All styles are contained within the `ddw-` prefix.

= Can I style the booking button? =

Yes! You can add custom CSS classes using the `class` parameter, or override the default styles using CSS with higher specificity.

= Does the plugin collect any data? =

No! The plugin does not collect, store, or transmit any user data. All functionality is client-side only.

== Screenshots ==

1. Booking widget modal with date and guest selection
2. Shortcode usage in page editor
3. Gutenberg block in editor
4. Plugin settings page
5. Mobile responsive design

== Changelog ==

= 1.3.0 =
* NEW: Added [drift_dwells_craft] shortcode for Craft Your Experience flow
* Opens iframe modal that loads embedded craft flow from booking app
* Modal closes and redirects to booking app on completion
* Strict origin validation for postMessage security
* Keyboard accessibility with Esc to close and focus management
* Card and button display modes available
* Full Divi compatibility for new shortcode

= 1.2.1 =
* FIXED: Missing prefix configuration in WordPress PHP config
* Added 'prefix' and 'widgetId' to DDW_CONFIG array
* Removed all debugging console logs
* Popup button now works correctly - opens modal instead of changing URL to #

= 1.1.9 =
* FIXED: Critical TypeError in formatDate function preventing widget initialization
* Added proper date configuration from PHP to JavaScript
* Enhanced formatDate function with null/undefined checks
* Fixed widget initialization failure that prevented popup from working
* Removed debugging alerts and console logs

= 1.1.8 =
* Added comprehensive debugging to identify popup button issue
* Implemented global click handler with alert for testing
* Enhanced widget initialization with error handling and fallbacks
* Added overlay DOM verification and style debugging
* Improved WordPress compatibility with multiple initialization methods

= 1.1.7 =
* Fixed popup button click handler not working in WordPress environment
* Added comprehensive debugging and direct event binding fallback
* Enhanced event delegation to catch all trigger clicks
* Added stopPropagation() to prevent default link behavior
* Improved WordPress compatibility with multiple event binding methods

= 1.1.6 =
* Fixed popup button color override issues with !important declarations
* Disabled conflicting dark mode styles for popup button
* Added comprehensive debugging for popup functionality
* Enhanced CSS specificity to ensure #ecebe6 color displays correctly
* Improved popup button styling consistency across all themes

= 1.1.5 =
* Fixed popup button functionality and styling
* Updated popup button color to #ecebe6 as requested
* Enhanced date picker functionality with modern showPicker() method
* Extended inline form to fill available space (removed max-width constraint)
* Improved date input focus behavior for better UX
* Maintained all existing functionality and accessibility

= 1.1.4 =
* Restored original inline layout proportions with proper flexbox structure
* All fields now display in single horizontal row on desktop
* Button positioned correctly on the right side
* Maintained Light Editorial theme colors and styling
* Fixed layout to match original design specifications

= 1.1.3 =
* Fixed CSS specificity issues preventing Light Editorial theme from displaying
* Disabled conflicting dark mode styles that were overriding the light theme
* Added !important declarations to ensure Light Editorial theme takes precedence
* Inline form now correctly displays with light background and sage colors

= 1.1.2 =
* Redesigned inline booking form with Light Editorial theme
* Updated styling with sage brand colors (#81887A)
* Enhanced visual hierarchy and typography
* Improved card design with subtle shadows and rounded corners
* Better responsive design for mobile and desktop
* Maintained accessibility standards and functionality

= 1.1.1 =
* Fixed inline shortcode rendering issue in Divi theme
* Enhanced Divi compatibility for both modal and inline shortcodes
* Improved asset loading detection for page builders
* Better CSS/JS enqueuing for shortcode contexts
* Fixed shortcode registration timing for Divi compatibility

= 1.1.0 =
* Added inline booking form shortcode `[drift_dwells_inline]`
* Enhanced modal shortcode with new parameters (default_adults, default_children, min_nights, prefill)
* Auto-prefill functionality from URL parameters
* Improved date validation and auto-correction
* Enhanced responsive design for inline forms
* Better accessibility with fieldset semantics
* Backward compatibility maintained for existing shortcodes

= 1.0.0 =
* Initial release
* Shortcode support with customizable parameters
* Gutenberg block integration
* Responsive design with mobile support
* Full accessibility compliance
* Admin settings page
* Scoped CSS to prevent theme conflicts

== Upgrade Notice ==

= 1.2.1 =
FIXED: Popup button now works! Added missing prefix configuration that was causing selector to be [data-undefinedbooking-trigger]. Popup opens modal correctly.

= 1.1.9 =
FIXED: Popup button now works correctly! Resolved critical TypeError that was preventing widget initialization. Popup opens modal instead of changing URL to #.

= 1.1.8 =
Added comprehensive debugging to identify popup button issue. Includes global click handler with alert for testing. Check browser console for detailed logs.

= 1.1.7 =
Fixed popup button click handler issue. Popup now opens correctly instead of just changing URL to #. Added comprehensive debugging.

= 1.1.6 =
Fixed popup button color override issues and added debugging. Popup button now correctly displays #ecebe6 color and opens modal properly.

= 1.1.5 =
Fixed popup button functionality and styling. Enhanced date picker with modern functionality. Extended inline form to fill available space.

= 1.1.4 =
Restored original layout proportions with all fields in single row. Light Editorial theme colors maintained with proper inline layout.

= 1.1.3 =
Fixed CSS conflicts that prevented Light Editorial theme from displaying. Inline form now correctly shows light background with sage colors.

= 1.1.2 =
Redesigned inline booking form with Light Editorial theme. Enhanced visual design while maintaining full functionality and accessibility.

= 1.1.1 =
Fixed Divi compatibility issue where inline shortcode was not rendering. Enhanced page builder support and asset loading.

= 1.1.0 =
New inline booking form shortcode added. Enhanced modal shortcode with auto-prefill functionality. Fully backward compatible.

= 1.0.0 =
Initial release of the Drift & Dwells Booking Widget plugin.

== Support ==

For support, please visit [Drift & Dwells website](https://driftdwells.com) or contact our support team.

== Privacy Policy ==

This plugin does not collect, store, or transmit any personal data. All functionality is client-side only and no information is sent to external servers except for the booking portal redirect.

== Technical Details ==

**Requirements:**
* WordPress 5.0 or higher
* PHP 7.4 or higher
* Modern web browser with JavaScript enabled

**File Structure:**
* `drift-dwells-booking.php` - Main plugin file
* `assets/wordpress-widget.min.js` - Widget JavaScript
* `assets/block-editor.js` - Gutenberg block editor script
* `assets/style.css` - Plugin styles
* `readme.txt` - This file

**Security:**
* No global namespace pollution
* No inline scripts that WordPress would block
* All scripts properly enqueued
* Input sanitization and output escaping
* Nonce verification for admin functions

**Performance:**
* Lightweight (under 10KB total)
* Assets only loaded when needed
* No external dependencies
* Optimized for fast loading

== Developer Notes ==

The plugin uses WordPress best practices including:

* Proper plugin header and metadata
* Activation/deactivation hooks
* Settings API integration
* Shortcode API implementation
* Block API for Gutenberg support
* Proper script/style enqueuing
* Input sanitization and output escaping
* Translation-ready code with text domains

For developers who want to extend the plugin, the main class `DriftDwellsBooking` provides a clean API for adding custom functionality.
