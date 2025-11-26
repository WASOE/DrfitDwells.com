# WordPress Plugin Installation Guide

## 📦 Plugin Package

**File**: `drift-dwells-booking.zip` (13KB)
**Location**: `/home/wasoe/drift-dwells-booking-portal/wordpress-plugin/`

## 🚀 Installation Steps

### Method 1: WordPress Admin Upload (Recommended)

1. **Login to WordPress Admin**
   - Go to your WordPress admin dashboard
   - Navigate to `Plugins → Add New`

2. **Upload Plugin**
   - Click "Upload Plugin" button
   - Choose the `drift-dwells-booking.zip` file
   - Click "Install Now"

3. **Activate Plugin**
   - After installation, click "Activate Plugin"
   - The plugin will be ready to use

### Method 2: FTP/File Manager Upload

1. **Extract ZIP File**
   - Extract `drift-dwells-booking.zip`
   - You'll get a `drift-dwells-booking/` folder

2. **Upload to WordPress**
   - Upload the `drift-dwells-booking/` folder to `/wp-content/plugins/`
   - The final path should be: `/wp-content/plugins/drift-dwells-booking/`

3. **Activate Plugin**
   - Go to WordPress admin → `Plugins`
   - Find "Drift & Dwells Booking Widget"
   - Click "Activate"

## ⚙️ Configuration

### Plugin Settings

1. **Access Settings**
   - Go to `Settings → Drift & Dwells Booking`

2. **Configure Options**
   - **Destination URL**: Set the booking portal URL (default: `https://booking.driftdwells.com`)
   - **Default Button Label**: Set the default text for buttons (default: "Book your stay")

### Usage Options

#### Option 1: Shortcode
Add to any page or post:
```
[drift_dwells_booking]
```

With custom options:
```
[drift_dwells_booking label="Reserve Now" style="button" class="custom-class"]
```

#### Option 2: Gutenberg Block
1. Edit any page/post with Gutenberg editor
2. Click "+" to add a new block
3. Search for "Drift & Dwells Booking"
4. Add the block and configure options

#### Option 3: Manual HTML
Add to any HTML element:
```html
<a href="#" data-ddw-booking-trigger>Book Now</a>
```

## 🎯 Shortcode Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `label` | Button text | "Book your stay" | `label="Reserve Now"` |
| `destination` | Booking portal URL | Production URL | `destination="https://staging.driftdwells.com"` |
| `class` | Additional CSS classes | "" | `class="custom-button"` |
| `style` | Button style | "button" | `style="link"` |

## 📱 Examples

### Basic Button
```
[drift_dwells_booking]
```

### Custom Styled Button
```
[drift_dwells_booking label="Check Availability" style="button" class="btn-primary"]
```

### Link Style
```
[drift_dwells_booking label="View Cabins" style="link" class="custom-link"]
```

### Staging Environment
```
[drift_dwells_booking destination="https://staging.driftdwells.com" label="Test Booking"]
```

## 🔧 Troubleshooting

### Plugin Not Working
1. **Check Plugin Activation**
   - Ensure plugin is activated in `Plugins` page
   - Look for any error messages

2. **Check JavaScript Console**
   - Open browser developer tools (F12)
   - Check Console tab for any errors
   - Look for "ddw-booking" related messages

3. **Check Theme Compatibility**
   - Try switching to a default WordPress theme temporarily
   - Check if the issue persists

### Widget Not Opening
1. **Check Script Loading**
   - Verify `wordpress-widget.min.js` is loading
   - Check Network tab in developer tools

2. **Check Data Attributes**
   - Ensure `data-ddw-booking-trigger` is present
   - Verify destination URL is correct

### Styling Issues
1. **Check CSS Conflicts**
   - All plugin styles use `ddw-` prefix
   - Check if theme CSS is overriding plugin styles

2. **Add Custom CSS**
   - Use the `class` parameter to add custom styling
   - Override styles with higher CSS specificity

## 🧪 Testing

### Basic Functionality Test
1. Add shortcode to a test page: `[drift_dwells_booking]`
2. View the page on frontend
3. Click the button - widget should open
4. Fill in dates and guests
5. Click "Search cabins" - should redirect to booking portal

### Mobile Test
1. Test on mobile device or browser dev tools
2. Verify touch targets are large enough
3. Check responsive behavior

### Accessibility Test
1. Test keyboard navigation (Tab, Enter, Escape)
2. Test with screen reader
3. Verify focus management

## 📋 File Structure

```
drift-dwells-booking/
├── drift-dwells-booking.php    # Main plugin file
├── readme.txt                  # Plugin documentation
├── uninstall.php              # Cleanup script
└── assets/
    ├── wordpress-widget.min.js # Widget JavaScript
    ├── block-editor.js        # Gutenberg block
    └── style.css              # Plugin styles
```

## 🔒 Security Features

- ✅ No global namespace pollution
- ✅ Proper input sanitization
- ✅ Output escaping
- ✅ Nonce verification
- ✅ No inline scripts
- ✅ Clean uninstall

## 📊 Performance

- ✅ Lightweight (13KB total)
- ✅ Assets only loaded when needed
- ✅ No external dependencies
- ✅ Optimized for fast loading

## 🆘 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review browser console for errors
3. Test with default WordPress theme
4. Contact Drift & Dwells support team

## 📝 Changelog

### Version 1.0.0
- Initial release
- Shortcode and Gutenberg block support
- Responsive design with mobile support
- Full accessibility compliance
- Admin settings page
- Clean uninstall functionality

---

**Plugin Ready for Production Use** ✅


