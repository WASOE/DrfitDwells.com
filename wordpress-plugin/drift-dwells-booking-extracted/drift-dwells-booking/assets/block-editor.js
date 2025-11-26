/**
 * Block Editor Script for Drift & Dwells Booking Widget
 */

(function() {
    'use strict';

    const { registerBlockType } = wp.blocks;
    const { createElement } = wp.element;
    const { InspectorControls } = wp.blockEditor;
    const { PanelBody, TextControl, SelectControl } = wp.components;
    const { __ } = wp.i18n;

    registerBlockType('drift-dwells/booking-widget', {
        title: __('Drift & Dwells Booking', 'drift-dwells-booking'),
        description: __('Add a booking widget that links to Drift & Dwells cabin search.', 'drift-dwells-booking'),
        icon: 'calendar-alt',
        category: 'widgets',
        keywords: [
            __('booking', 'drift-dwells-booking'),
            __('cabin', 'drift-dwells-booking'),
            __('reservation', 'drift-dwells-booking'),
        ],
        supports: {
            html: false,
            align: ['left', 'center', 'right'],
        },
        attributes: {
            label: {
                type: 'string',
                default: 'Book your stay',
            },
            destination: {
                type: 'string',
                default: 'https://booking.driftdwells.com',
            },
            className: {
                type: 'string',
                default: '',
            },
            style: {
                type: 'string',
                default: 'button',
            },
        },
        edit: function(props) {
            const { attributes, setAttributes } = props;
            const { label, destination, className, style } = attributes;

            function onChangeLabel(value) {
                setAttributes({ label: value });
            }

            function onChangeDestination(value) {
                setAttributes({ destination: value });
            }

            function onChangeClassName(value) {
                setAttributes({ className: value });
            }

            function onChangeStyle(value) {
                setAttributes({ style: value });
            }

            const blockStyle = {
                padding: '20px',
                border: '2px dashed #ccc',
                borderRadius: '8px',
                textAlign: 'center',
                backgroundColor: '#f9f9f9',
            };

            const previewStyle = {
                display: 'inline-block',
                padding: style === 'link' ? '8px 16px' : '12px 24px',
                backgroundColor: style === 'link' ? 'transparent' : '#81887a',
                color: style === 'link' ? '#81887a' : 'white',
                textDecoration: style === 'link' ? 'underline' : 'none',
                borderRadius: style === 'link' ? '0' : '8px',
                border: style === 'link' ? 'none' : '1px solid #81887a',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
            };

            return createElement('div', { style: blockStyle },
                createElement('div', { className: 'ddw-booking-preview' },
                    createElement('h4', { style: { marginTop: 0, marginBottom: '16px' } }, 
                        __('Drift & Dwells Booking Widget', 'drift-dwells-booking')
                    ),
                    createElement('div', { style: previewStyle }, label),
                    createElement('p', { style: { marginTop: '12px', fontSize: '12px', color: '#666' } },
                        __('Destination:', 'drift-dwells-booking') + ' ' + destination
                    )
                ),
                createElement(InspectorControls, null,
                    createElement(PanelBody, { title: __('Settings', 'drift-dwells-booking'), initialOpen: true },
                        createElement(TextControl, {
                            label: __('Button Label', 'drift-dwells-booking'),
                            value: label,
                            onChange: onChangeLabel,
                            help: __('Text displayed on the button or link', 'drift-dwells-booking'),
                        }),
                        createElement(TextControl, {
                            label: __('Destination URL', 'drift-dwells-booking'),
                            value: destination,
                            onChange: onChangeDestination,
                            help: __('Base URL for the booking portal (without /search)', 'drift-dwells-booking'),
                        }),
                        createElement(SelectControl, {
                            label: __('Style', 'drift-dwells-booking'),
                            value: style,
                            options: [
                                { label: __('Button', 'drift-dwells-booking'), value: 'button' },
                                { label: __('Link', 'drift-dwells-booking'), value: 'link' },
                            ],
                            onChange: onChangeStyle,
                        }),
                        createElement(TextControl, {
                            label: __('Additional CSS Class', 'drift-dwells-booking'),
                            value: className,
                            onChange: onChangeClassName,
                            help: __('Optional CSS class for custom styling', 'drift-dwells-booking'),
                        })
                    )
                )
            );
        },
        save: function() {
            // Return null because this is a dynamic block
            return null;
        },
    });

})();
