<?php
/**
 * Plugin Name: Drift & Dwells Booking Widget
 * Plugin URI: https://booking.driftdwells.com
 * Description: Add a beautiful booking widget to your WordPress site that deep-links to Drift & Dwells cabin search with date and guest selection.
 * Version: 1.3.0
 * Author: Drift & Dwells
 * Author URI: https://driftdwells.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: drift-dwells-booking
 * Domain Path: /languages
 * Requires at least: 5.0
 * Tested up to: 6.4
 * Requires PHP: 7.4
 * Network: false
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Define plugin constants
define('DDW_PLUGIN_VERSION', '1.3.0');
define('DDW_PLUGIN_URL', plugin_dir_url(__FILE__));
define('DDW_PLUGIN_PATH', plugin_dir_path(__FILE__));
define('DDW_PLUGIN_BASENAME', plugin_basename(__FILE__));

/**
 * Main plugin class
 */
class DriftDwellsBooking {
    
    private static $instance = null;
    
    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        add_action('init', array($this, 'init'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_scripts'));
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        
        // Shortcode registration - ensure early registration for Divi compatibility
        add_action('init', array($this, 'register_shortcodes'), 5);
        
        // Gutenberg block registration
        add_action('init', array($this, 'register_blocks'));
        
        // Divi compatibility
        add_action('et_builder_ready', array($this, 'divi_compatibility'));
        
        // Activation/Deactivation hooks
        register_activation_hook(__FILE__, array($this, 'activate'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate'));
    }
    
    /**
     * Initialize plugin
     */
    public function init() {
        // Load text domain for translations
        load_plugin_textdomain('drift-dwells-booking', false, dirname(DDW_PLUGIN_BASENAME) . '/languages');
    }
    
    /**
     * Register shortcodes
     */
    public function register_shortcodes() {
        add_shortcode('drift_dwells_booking', array($this, 'booking_shortcode'));
        add_shortcode('drift_dwells_inline', array($this, 'inline_booking_shortcode'));
        add_shortcode('drift_dwells_craft', array($this, 'craft_shortcode'));
    }
    
    /**
     * Divi compatibility
     */
    public function divi_compatibility() {
        // Ensure shortcodes are registered when Divi is ready
        $this->register_shortcodes();
    }
    
    /**
     * Enqueue scripts and styles
     */
    public function enqueue_scripts() {
        // Only enqueue on pages that use the widget
        if ($this->should_enqueue_assets()) {
            // Enqueue CSS
            wp_enqueue_style(
                'drift-dwells-booking-styles',
                DDW_PLUGIN_URL . 'assets/style.css',
                array(),
                DDW_PLUGIN_VERSION
            );
            
            // Enqueue JavaScript
            wp_enqueue_script(
                'drift-dwells-booking-widget',
                DDW_PLUGIN_URL . 'assets/wordpress-widget.min.js',
                array(),
                DDW_PLUGIN_VERSION,
                true
            );
            
            // Add inline script to configure the widget
            $now = time();
            $config = array(
                'baseUrl' => get_option('ddw_booking_destination_url', 'https://booking.driftdwells.com'),
                'defaultLabel' => get_option('ddw_booking_default_label', 'Book your stay'),
                'prefix' => 'ddw-',
                'widgetId' => 'ddw-booking-widget',
                'minDate' => date('Y-m-d', $now),
                'defaultCheckIn' => date('Y-m-d', $now + 7 * 24 * 60 * 60),
                'defaultCheckOut' => date('Y-m-d', $now + 9 * 24 * 60 * 60),
                'defaultAdults' => 2,
                'defaultChildren' => 0
            );
            
            wp_add_inline_script(
                'drift-dwells-booking-widget',
                'window.DDW_CONFIG = ' . wp_json_encode($config) . ';',
                'before'
            );
        }
    }
    
    /**
     * Check if assets should be enqueued
     */
    private function should_enqueue_assets() {
        global $post;
        
        // Check if shortcode is used in current post
        if ($post && (has_shortcode($post->post_content, 'drift_dwells_booking') || has_shortcode($post->post_content, 'drift_dwells_inline') || has_shortcode($post->post_content, 'drift_dwells_craft'))) {
            return true;
        }
        
        // Check if block is used
        if ($post && has_block('drift-dwells/booking-widget', $post)) {
            return true;
        }
        
        // Check for data attribute triggers
        if ($post && strpos($post->post_content, 'data-ddw-booking-trigger') !== false) {
            return true;
        }
        
        // Check for inline form data attributes
        if ($post && strpos($post->post_content, 'data-ddw-inline-form') !== false) {
            return true;
        }
        
        // Check for craft modal data attributes
        if ($post && strpos($post->post_content, 'data-ddw-craft-root') !== false) {
            return true;
        }
        
        // Divi compatibility - check if we're in Divi builder or frontend
        if (function_exists('et_core_is_fb_enabled') && et_core_is_fb_enabled()) {
            return true;
        }
        
        // Check if we're on a Divi page
        if (function_exists('et_pb_is_pagebuilder_used') && $post && et_pb_is_pagebuilder_used($post->ID)) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Register Gutenberg blocks
     */
    public function register_blocks() {
        if (function_exists('register_block_type')) {
            register_block_type('drift-dwells/booking-widget', array(
                'editor_script' => 'drift-dwells-booking-editor',
                'render_callback' => array($this, 'render_booking_block'),
                'attributes' => array(
                    'label' => array(
                        'type' => 'string',
                        'default' => get_option('ddw_booking_default_label', 'Book your stay'),
                    ),
                    'destination' => array(
                        'type' => 'string',
                        'default' => get_option('ddw_booking_destination_url', 'https://booking.driftdwells.com'),
                    ),
                    'className' => array(
                        'type' => 'string',
                        'default' => '',
                    ),
                    'style' => array(
                        'type' => 'string',
                        'default' => 'button',
                    ),
                ),
            ));
        }
    }
    
    /**
     * Render booking block
     */
    public function render_booking_block($attributes) {
        $label = !empty($attributes['label']) ? $attributes['label'] : get_option('ddw_booking_default_label', 'Book your stay');
        $destination = !empty($attributes['destination']) ? $attributes['destination'] : get_option('ddw_booking_destination_url', 'https://booking.driftdwells.com');
        $className = !empty($attributes['className']) ? ' ' . esc_attr($attributes['className']) : '';
        $style = !empty($attributes['style']) ? $attributes['style'] : 'button';
        
        return $this->render_booking_trigger($label, $destination, $className, $style);
    }
    
    /**
     * Booking shortcode handler (modal trigger)
     */
    public function booking_shortcode($atts) {
        $atts = shortcode_atts(array(
            'label' => get_option('ddw_booking_default_label', 'Book your stay'),
            'destination' => get_option('ddw_booking_destination_url', 'https://booking.driftdwells.com'),
            'class' => '',
            'style' => 'button',
            'default_adults' => '2',
            'default_children' => '0',
            'min_nights' => '2',
            'prefill' => 'auto',
        ), $atts, 'drift_dwells_booking');
        
        return $this->render_booking_trigger(
            $atts['label'],
            $atts['destination'],
            $atts['class'],
            $atts['style'],
            $atts
        );
    }
    
    /**
     * Inline booking shortcode handler
     */
    public function inline_booking_shortcode($atts) {
        $atts = shortcode_atts(array(
            'destination' => get_option('ddw_booking_destination_url', 'https://booking.driftdwells.com'),
            'class' => '',
            'default_adults' => '2',
            'default_children' => '0',
            'min_nights' => '2',
            'prefill' => 'auto',
        ), $atts, 'drift_dwells_inline');
        
        // Ensure assets are enqueued for this shortcode
        if (!wp_style_is('drift-dwells-booking-styles', 'enqueued')) {
            wp_enqueue_style(
                'drift-dwells-booking-styles',
                DDW_PLUGIN_URL . 'assets/style.css',
                array(),
                DDW_PLUGIN_VERSION
            );
        }
        
        if (!wp_script_is('drift-dwells-booking-widget', 'enqueued')) {
            wp_enqueue_script(
                'drift-dwells-booking-widget',
                DDW_PLUGIN_URL . 'assets/wordpress-widget.min.js',
                array(),
                DDW_PLUGIN_VERSION,
                true
            );
            
            // Add inline script to configure the widget
            $now = time();
            $config = array(
                'baseUrl' => get_option('ddw_booking_destination_url', 'https://booking.driftdwells.com'),
                'defaultLabel' => get_option('ddw_booking_default_label', 'Book your stay'),
                'prefix' => 'ddw-',
                'widgetId' => 'ddw-booking-widget',
                'minDate' => date('Y-m-d', $now),
                'defaultCheckIn' => date('Y-m-d', $now + 7 * 24 * 60 * 60),
                'defaultCheckOut' => date('Y-m-d', $now + 9 * 24 * 60 * 60),
                'defaultAdults' => 2,
                'defaultChildren' => 0
            );
            
            wp_add_inline_script(
                'drift-dwells-booking-widget',
                'window.DDW_CONFIG = ' . wp_json_encode($config) . ';',
                'before'
            );
        }
        
        return $this->render_inline_booking_form($atts);
    }
    
    /**
     * Craft experience shortcode handler (iframe modal)
     */
    public function craft_shortcode($atts) {
        $atts = shortcode_atts(array(
            'label' => 'start crafted experience →',
            'mode'  => 'card',
        ), $atts, 'drift_dwells_craft');
        
        $base = trim((string) get_option('ddw_booking_destination_url'));
        if (!$base) $base = 'https://booking.driftdwells.com';
        $base = rtrim($base, '/');

        // Always absolute, never relative:
        $origin = home_url('/');
        $iframe_src = $base . '/embedded/craft?origin=' . rawurlencode($origin);
        $iframe_src = esc_url($iframe_src);
        
        if (!wp_style_is('ddw-craft-css', 'enqueued')) {
            wp_enqueue_style(
                'ddw-craft-css',
                DDW_PLUGIN_URL . 'assets/craft-modal.css',
                array(),
                DDW_PLUGIN_VERSION
            );
        }
        
        if (!wp_script_is('ddw-craft-js', 'enqueued')) {
            $suffix = (defined('SCRIPT_DEBUG') && SCRIPT_DEBUG) ? '' : '.min';
            wp_enqueue_script(
                'ddw-craft-js',
                DDW_PLUGIN_URL . 'assets/craft-modal' . $suffix . '.js',
                array(),
                DDW_PLUGIN_VERSION,
                true
            );
            
            $cfg = array(
                'appOrigin'    => $base,
                'redirectBase' => $base,
                'parentHost'   => home_url('/'),
            );
            wp_add_inline_script('ddw-craft-js', 'window.DDW_CRAFT_CFG=' . wp_json_encode($cfg) . ';', 'before');
        }
        
        ob_start(); ?>
        <div class="ddw-craft-root" data-ddw-craft-root>
          <?php if ($atts['mode'] === 'card'): ?>
            <div class="ddw-craft-card" role="region" aria-label="<?php echo esc_attr__('Craft your experience', 'drift-dwells-booking'); ?>">
              <h3 class="ddw-craft-title"><?php echo esc_html__('Craft Your Perfect Experience', 'drift-dwells-booking'); ?></h3>
              <p class="ddw-craft-copy"><?php echo esc_html__('Play with options and build your ideal trip before you book.', 'drift-dwells-booking'); ?></p>
              <button type="button" class="ddw-craft-open" aria-haspopup="dialog">
                <?php echo esc_html($atts['label']); ?>
              </button>
            </div>
          <?php else: ?>
            <button type="button" class="ddw-craft-open" aria-haspopup="dialog">
              <?php echo esc_html($atts['label']); ?>
            </button>
          <?php endif; ?>
      
          <div class="ddw-craft-modal" hidden>
            <div class="ddw-craft-backdrop" tabindex="-1" data-ddw-craft-close></div>
            <div class="ddw-craft-dialog" role="dialog" aria-modal="true" aria-label="<?php echo esc_attr__('Craft your experience', 'drift-dwells-booking'); ?>" tabindex="-1">
              <button type="button" class="ddw-craft-close" aria-label="<?php echo esc_attr__('Close', 'drift-dwells-booking'); ?>" data-ddw-craft-close>✕</button>
              <iframe class="ddw-craft-iframe" src="<?php echo $iframe_src; ?>" allow="fullscreen" loading="eager"></iframe>
            </div>
          </div>
        </div>
        <?php
        return ob_get_clean();
    }
    
    /**
     * Render booking trigger HTML
     */
    private function render_booking_trigger($label, $destination, $className = '', $style = 'button', $atts = array()) {
        $label = esc_html($label);
        $destination = esc_url($destination);
        $className = esc_attr($className);
        
        // Ensure assets are enqueued
        if (!wp_style_is('drift-dwells-booking-styles', 'enqueued')) {
            wp_enqueue_style(
                'drift-dwells-booking-styles',
                DDW_PLUGIN_URL . 'assets/style.css',
                array(),
                DDW_PLUGIN_VERSION
            );
        }
        
        if (!wp_script_is('drift-dwells-booking-widget', 'enqueued')) {
            wp_enqueue_script(
                'drift-dwells-booking-widget',
                DDW_PLUGIN_URL . 'assets/wordpress-widget.min.js',
                array(),
                DDW_PLUGIN_VERSION,
                true
            );
            
            // Add inline script to configure the widget
            $now = time();
            $config = array(
                'baseUrl' => get_option('ddw_booking_destination_url', 'https://booking.driftdwells.com'),
                'defaultLabel' => get_option('ddw_booking_default_label', 'Book your stay'),
                'prefix' => 'ddw-',
                'widgetId' => 'ddw-booking-widget',
                'minDate' => date('Y-m-d', $now),
                'defaultCheckIn' => date('Y-m-d', $now + 7 * 24 * 60 * 60),
                'defaultCheckOut' => date('Y-m-d', $now + 9 * 24 * 60 * 60),
                'defaultAdults' => 2,
                'defaultChildren' => 0
            );
            
            wp_add_inline_script(
                'drift-dwells-booking-widget',
                'window.DDW_CONFIG = ' . wp_json_encode($config) . ';',
                'before'
            );
        }
        
        $class = 'ddw-booking-trigger';
        if ($style === 'link') {
            $class .= ' ddw-booking-trigger--link';
        } else {
            $class .= ' ddw-booking-trigger--button';
        }
        $class .= $className ? ' ' . $className : '';
        
        // Build data attributes for widget configuration
        $dataAttrs = sprintf('data-ddw-destination="%s"', $destination);
        
        if (!empty($atts)) {
            $dataAttrs .= sprintf(' data-ddw-default-adults="%s"', esc_attr($atts['default_adults']));
            $dataAttrs .= sprintf(' data-ddw-default-children="%s"', esc_attr($atts['default_children']));
            $dataAttrs .= sprintf(' data-ddw-min-nights="%s"', esc_attr($atts['min_nights']));
            $dataAttrs .= sprintf(' data-ddw-prefill="%s"', esc_attr($atts['prefill']));
        }
        
        $html = sprintf(
            '<a href="#" class="%s" data-ddw-booking-trigger %s role="button" aria-label="%s">%s</a>',
            $class,
            $dataAttrs,
            esc_attr($label),
            $label
        );
        
        return $html;
    }
    
    /**
     * Render inline booking form HTML
     */
    private function render_inline_booking_form($atts) {
        $destination = esc_url($atts['destination']);
        $className = esc_attr($atts['class']);
        
        // Get default values, potentially from URL if prefill=auto
        $defaultAdults = $atts['default_adults'];
        $defaultChildren = $atts['default_children'];
        $defaultCheckIn = '';
        $defaultCheckOut = '';
        
        if ($atts['prefill'] === 'auto') {
            $checkIn = isset($_GET['checkIn']) ? sanitize_text_field($_GET['checkIn']) : '';
            $checkOut = isset($_GET['checkOut']) ? sanitize_text_field($_GET['checkOut']) : '';
            $adults = isset($_GET['adults']) ? intval($_GET['adults']) : $defaultAdults;
            $children = isset($_GET['children']) ? intval($_GET['children']) : $defaultChildren;
            
            if ($checkIn) $defaultCheckIn = $checkIn;
            if ($checkOut) $defaultCheckOut = $checkOut;
            if ($adults > 0) $defaultAdults = $adults;
            if ($children >= 0) $defaultChildren = $children;
        }
        
        $class = 'ddw-booking-inline-form' . ($className ? ' ' . $className : '');
        
        $html = sprintf(
            '<div class="%s" data-ddw-inline-form data-ddw-destination="%s" data-ddw-default-adults="%s" data-ddw-default-children="%s" data-ddw-min-nights="%s" data-ddw-prefill="%s">
                <form class="ddw-booking-form" novalidate>
                    <fieldset class="ddw-booking-fieldset">
                        <legend class="ddw-booking-legend">Search Available Cabins</legend>
                        <div class="ddw-booking-form-grid">
                            <div class="ddw-booking-field">
                                <label for="ddw-checkin" class="ddw-booking-label">Check-in</label>
                                <input type="date" id="ddw-checkin" name="checkin" class="ddw-booking-input" value="%s" min="%s" required aria-label="Check-in date">
                            </div>
                            <div class="ddw-booking-field">
                                <label for="ddw-checkout" class="ddw-booking-label">Check-out</label>
                                <input type="date" id="ddw-checkout" name="checkout" class="ddw-booking-input" value="%s" min="%s" required aria-label="Check-out date">
                            </div>
                            <div class="ddw-booking-field">
                                <label for="ddw-adults" class="ddw-booking-label">Adults</label>
                                <select id="ddw-adults" name="adults" class="ddw-booking-select" aria-label="Number of adults">%s</select>
                            </div>
                            <div class="ddw-booking-field">
                                <label for="ddw-children" class="ddw-booking-label">Children</label>
                                <select id="ddw-children" name="children" class="ddw-booking-select" aria-label="Number of children">%s</select>
                            </div>
                            <div class="ddw-booking-field ddw-booking-field--submit">
                                <button type="submit" class="ddw-booking-submit" aria-label="Search available cabins">
                                    <span>Search cabins</span>
                                    <span class="ddw-booking-submit-arrow">→</span>
                                </button>
                            </div>
                        </div>
                    </fieldset>
                </form>
            </div>',
            $class,
            $destination,
            esc_attr($defaultAdults),
            esc_attr($defaultChildren),
            esc_attr($atts['min_nights']),
            esc_attr($atts['prefill']),
            esc_attr($defaultCheckIn),
            esc_attr(date('Y-m-d')),
            esc_attr($defaultCheckOut),
            esc_attr($defaultCheckIn ?: date('Y-m-d')),
            $this->generate_adults_options($defaultAdults),
            $this->generate_children_options($defaultChildren)
        );
        
        return $html;
    }
    
    /**
     * Generate adults select options
     */
    private function generate_adults_options($selected) {
        $options = '';
        for ($i = 1; $i <= 10; $i++) {
            $selectedAttr = ($i == $selected) ? ' selected' : '';
            $label = $i === 1 ? 'Adult' : 'Adults';
            $options .= sprintf('<option value="%d"%s>%d %s</option>', $i, $selectedAttr, $i, $label);
        }
        return $options;
    }
    
    /**
     * Generate children select options
     */
    private function generate_children_options($selected) {
        $options = '';
        for ($i = 0; $i <= 10; $i++) {
            $selectedAttr = ($i == $selected) ? ' selected' : '';
            $label = $i === 1 ? 'Child' : 'Children';
            $options .= sprintf('<option value="%d"%s>%d %s</option>', $i, $selectedAttr, $i, $label);
        }
        return $options;
    }
    
    /**
     * Add admin menu
     */
    public function add_admin_menu() {
        add_options_page(
            __('Drift & Dwells Booking', 'drift-dwells-booking'),
            __('Drift & Dwells Booking', 'drift-dwells-booking'),
            'manage_options',
            'drift-dwells-booking',
            array($this, 'admin_page')
        );
    }
    
    /**
     * Register settings
     */
    public function register_settings() {
        register_setting('ddw_booking_settings', 'ddw_booking_destination_url');
        register_setting('ddw_booking_settings', 'ddw_booking_default_label');
        
        add_settings_section(
            'ddw_booking_main',
            __('Main Settings', 'drift-dwells-booking'),
            null,
            'ddw_booking_settings'
        );
        
        add_settings_field(
            'ddw_booking_destination_url',
            __('Destination URL', 'drift-dwells-booking'),
            array($this, 'destination_url_field'),
            'ddw_booking_settings',
            'ddw_booking_main'
        );
        
        add_settings_field(
            'ddw_booking_default_label',
            __('Default Button Label', 'drift-dwells-booking'),
            array($this, 'default_label_field'),
            'ddw_booking_settings',
            'ddw_booking_main'
        );
    }
    
    /**
     * Destination URL field
     */
    public function destination_url_field() {
        $value = get_option('ddw_booking_destination_url', 'https://booking.driftdwells.com');
        echo '<input type="url" name="ddw_booking_destination_url" value="' . esc_attr($value) . '" class="regular-text" />';
        echo '<p class="description">' . __('Base URL for the booking portal (without /search)', 'drift-dwells-booking') . '</p>';
    }
    
    /**
     * Default label field
     */
    public function default_label_field() {
        $value = get_option('ddw_booking_default_label', 'Book your stay');
        echo '<input type="text" name="ddw_booking_default_label" value="' . esc_attr($value) . '" class="regular-text" />';
        echo '<p class="description">' . __('Default text for booking buttons and links', 'drift-dwells-booking') . '</p>';
    }
    
    /**
     * Admin page
     */
    public function admin_page() {
        ?>
        <div class="wrap">
            <h1><?php echo esc_html(get_admin_page_title()); ?></h1>
            
            <div class="card" style="max-width: 800px;">
                <h2><?php _e('Plugin Information', 'drift-dwells-booking'); ?></h2>
                <p><?php _e('This plugin adds a booking widget to your WordPress site that allows visitors to search for available cabins at Drift & Dwells.', 'drift-dwells-booking'); ?></p>
                
                <h3><?php _e('Usage', 'drift-dwells-booking'); ?></h3>
                <p><?php _e('Add booking triggers to your pages using either:', 'drift-dwells-booking'); ?></p>
                <ul>
                    <li><strong><?php _e('Shortcode:', 'drift-dwells-booking'); ?></strong> <code>[drift_dwells_booking]</code></li>
                    <li><strong><?php _e('Gutenberg Block:', 'drift-dwells-booking'); ?></strong> <?php _e('Search for "Drift & Dwells Booking" in the block inserter', 'drift-dwells-booking'); ?></li>
                </ul>
                
                <h3><?php _e('Shortcode Options', 'drift-dwells-booking'); ?></h3>
                <ul>
                    <li><code>label</code> - <?php _e('Button text (default: "Book your stay")', 'drift-dwells-booking'); ?></li>
                    <li><code>destination</code> - <?php _e('Booking portal URL (default: production URL)', 'drift-dwells-booking'); ?></li>
                    <li><code>class</code> - <?php _e('Additional CSS classes', 'drift-dwells-booking'); ?></li>
                    <li><code>style</code> - <?php _e('Style: "button" or "link" (default: "button")', 'drift-dwells-booking'); ?></li>
                </ul>
                
                <h3><?php _e('Examples', 'drift-dwells-booking'); ?></h3>
                <p><code>[drift_dwells_booking label="Reserve Now" style="button"]</code></p>
                <p><code>[drift_dwells_booking label="Check Availability" style="link" class="custom-link"]</code></p>
            </div>
            
            <form method="post" action="options.php">
                <?php
                settings_fields('ddw_booking_settings');
                do_settings_sections('ddw_booking_settings');
                submit_button();
                ?>
            </form>
        </div>
        <?php
    }
    
    /**
     * Plugin activation
     */
    public function activate() {
        // Set default options
        add_option('ddw_booking_destination_url', 'https://booking.driftdwells.com');
        add_option('ddw_booking_default_label', 'Book your stay');
        
        // Flush rewrite rules
        flush_rewrite_rules();
    }
    
    /**
     * Plugin deactivation
     */
    public function deactivate() {
        // Flush rewrite rules
        flush_rewrite_rules();
    }
}

// Initialize the plugin
function drift_dwells_booking_init() {
    return DriftDwellsBooking::get_instance();
}

// Start the plugin
drift_dwells_booking_init();
