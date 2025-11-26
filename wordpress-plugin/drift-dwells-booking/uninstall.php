<?php
/**
 * Uninstall script for Drift & Dwells Booking Widget
 * 
 * This file is executed when the plugin is uninstalled via WordPress admin.
 * It removes all plugin data and settings to ensure a clean uninstall.
 */

// Prevent direct access
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

// Remove plugin options
delete_option('ddw_booking_destination_url');
delete_option('ddw_booking_default_label');

// Remove plugin settings
delete_option('ddw_booking_settings');

// Remove any transients
delete_transient('ddw_booking_cache');

// Clear any cached data
wp_cache_flush();

// Note: We don't remove user meta or post meta as the plugin doesn't store any
// We don't remove database tables as the plugin doesn't create any
// We don't remove uploaded files as the plugin doesn't create any

// Log uninstall for debugging (optional)
error_log('Drift & Dwells Booking Widget plugin uninstalled successfully');
