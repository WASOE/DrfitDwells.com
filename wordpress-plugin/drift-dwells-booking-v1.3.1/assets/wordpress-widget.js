/**
 * Drift Dwells Booking Widget - WordPress Integration
 * 
 * Usage:
 * 1. Add this script to WordPress head or footer
 * 2. Add data-ddw-booking-trigger to any menu link/button
 * 3. Optional: Add data-ddw-destination to override base URL (default: https://booking.driftdwells.com)
 * 
 * Example:
 * <a href="#" data-ddw-booking-trigger>Book Now</a>
 * <a href="#" data-ddw-booking-trigger data-ddw-destination="https://staging.driftdwells.com">Book Now (Staging)</a>
 */

(function() {
  'use strict';

  // Configuration
  const DDW_CONFIG = window.DDW_CONFIG || {
    baseUrl: 'https://booking.driftdwells.com',
    widgetId: 'ddw-booking-widget',
    prefix: 'ddw-',
    minDate: new Date(),
    defaultCheckIn: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    defaultCheckOut: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000), // 9 days from now (2 nights)
    defaultAdults: 2,
    defaultChildren: 0
  };

  // Convert string dates from PHP to Date objects
  if (typeof DDW_CONFIG.minDate === 'string') {
    DDW_CONFIG.minDate = new Date(DDW_CONFIG.minDate);
  }
  if (typeof DDW_CONFIG.defaultCheckIn === 'string') {
    DDW_CONFIG.defaultCheckIn = new Date(DDW_CONFIG.defaultCheckIn);
  }
  if (typeof DDW_CONFIG.defaultCheckOut === 'string') {
    DDW_CONFIG.defaultCheckOut = new Date(DDW_CONFIG.defaultCheckOut);
  }

  // Utility functions
  const formatDate = (date) => {
    if (!date) {
      console.error('DDW: formatDate called with undefined date');
      return new Date().toISOString().split('T')[0];
    }
    return date.toISOString().split('T')[0];
  };

  const parseDate = (dateString) => {
    if (!dateString) return null;
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  // Widget CSS
  const widgetCSS = `
    .${DDW_CONFIG.prefix}overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .${DDW_CONFIG.prefix}popover {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      max-width: 500px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
    }
    
    .${DDW_CONFIG.prefix}header {
      padding: 24px 24px 16px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .${DDW_CONFIG.prefix}title {
      font-size: 18px;
      font-weight: 600;
      color: #111827;
      margin: 0;
    }
    
    .${DDW_CONFIG.prefix}close {
      background: none;
      border: none;
      font-size: 24px;
      color: #6b7280;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
      border-radius: 4px;
      transition: all 0.2s;
    }
    
    .${DDW_CONFIG.prefix}close:hover {
      background: #f3f4f6;
      color: #374151;
    }
    
    .${DDW_CONFIG.prefix}content {
      padding: 24px;
    }
    
    .${DDW_CONFIG.prefix}form {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    
    .${DDW_CONFIG.prefix}field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .${DDW_CONFIG.prefix}label {
      font-size: 14px;
      font-weight: 500;
      color: #374151;
    }
    
    .${DDW_CONFIG.prefix}input,
    .${DDW_CONFIG.prefix}select {
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s, box-shadow 0.2s;
      background: white;
    }
    
    .${DDW_CONFIG.prefix}input:focus,
    .${DDW_CONFIG.prefix}select:focus {
      outline: none;
      border-color: #81887a;
      box-shadow: 0 0 0 3px rgba(129, 136, 122, 0.1);
    }
    
    .${DDW_CONFIG.prefix}input.${DDW_CONFIG.prefix}error {
      border-color: #ef4444;
    }
    
    .${DDW_CONFIG.prefix}error-message {
      color: #ef4444;
      font-size: 12px;
      margin-top: 4px;
    }
    
    .${DDW_CONFIG.prefix}grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    
    .${DDW_CONFIG.prefix}submit {
      background: #81887a;
      color: white;
      border: none;
      padding: 14px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
      margin-top: 8px;
    }
    
    .${DDW_CONFIG.prefix}submit:hover {
      background: #6b7366;
    }
    
    .${DDW_CONFIG.prefix}submit:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    
    .${DDW_CONFIG.prefix}toast {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ef4444;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10001;
      max-width: 300px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    }
    
    /* Inline form styles */
    .${DDW_CONFIG.prefix}booking-inline-form {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      padding: 24px;
      margin: 20px 0;
    }
    
    .${DDW_CONFIG.prefix}booking-form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      align-items: end;
    }
    
    .${DDW_CONFIG.prefix}booking-fieldset {
      border: none;
      margin: 0;
      padding: 0;
    }
    
    .${DDW_CONFIG.prefix}booking-legend {
      font-size: 18px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 20px;
      padding: 0;
    }
    
    .${DDW_CONFIG.prefix}booking-field--submit {
      display: flex;
      align-items: end;
    }
    
    .${DDW_CONFIG.prefix}booking-submit {
      background: #81887a;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 48px;
    }
    
    .${DDW_CONFIG.prefix}booking-submit:hover {
      background: #6b7366;
    }
    
    .${DDW_CONFIG.prefix}booking-submit-arrow {
      font-size: 16px;
      line-height: 1;
    }
    
    @media (max-width: 640px) {
      .${DDW_CONFIG.prefix}overlay {
        padding: 10px;
      }
      
      .${DDW_CONFIG.prefix}popover {
        border-radius: 8px;
      }
      
      .${DDW_CONFIG.prefix}header,
      .${DDW_CONFIG.prefix}content {
        padding: 20px;
      }
      
      .${DDW_CONFIG.prefix}grid {
        grid-template-columns: 1fr;
      }
      
      .${DDW_CONFIG.prefix}toast {
        top: 10px;
        right: 10px;
        left: 10px;
        max-width: none;
      }
      
      .${DDW_CONFIG.prefix}booking-inline-form {
        padding: 20px;
      }
      
      .${DDW_CONFIG.prefix}booking-form-grid {
        grid-template-columns: 1fr;
        gap: 16px;
      }
      
      .${DDW_CONFIG.prefix}booking-field--submit {
        align-items: stretch;
      }
      
      .${DDW_CONFIG.prefix}booking-submit {
        justify-content: center;
        min-height: 48px;
      }
    }
  `;

  // Widget class
  class BookingWidget {
    constructor() {
      this.isOpen = false;
      this.overlay = null;
      this.formData = {
        checkIn: formatDate(DDW_CONFIG.defaultCheckIn),
        checkOut: formatDate(DDW_CONFIG.defaultCheckOut),
        adults: DDW_CONFIG.defaultAdults,
        children: DDW_CONFIG.defaultChildren
      };
      this.errors = {};
      this.focusableElements = [];
      this.previousActiveElement = null;
      
      this.init();
    }

    init() {
      this.injectCSS();
      this.bindEvents();
    }

    injectCSS() {
      if (document.getElementById(`${DDW_CONFIG.prefix}styles`)) return;
      
      const style = document.createElement('style');
      style.id = `${DDW_CONFIG.prefix}styles`;
      style.textContent = widgetCSS;
      document.head.appendChild(style);
    }

    bindEvents() {
      // Bind to all trigger elements
      document.addEventListener('click', (e) => {
        const trigger = e.target.closest(`[data-${DDW_CONFIG.prefix}booking-trigger]`);
        if (trigger) {
          e.preventDefault();
          const destination = trigger.dataset.ddwDestination || DDW_CONFIG.baseUrl;
          this.open(destination, trigger);
        }
      });

      // Bind to inline forms
      document.addEventListener('submit', (e) => {
        const form = e.target.closest(`[data-${DDW_CONFIG.prefix}inline-form]`);
        if (form) {
          e.preventDefault();
          this.handleInlineSubmit(form);
        }
      });

      // Initialize inline forms with enhanced date picker
      document.addEventListener('DOMContentLoaded', () => {
        this.initInlineForms();
      });

      // Also initialize if DOM is already loaded
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          this.initInlineForms();
        });
      } else {
        this.initInlineForms();
      }


      // Handle ESC key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      });

      // Initialize inline forms
      this.initializeInlineForms();
    }

    initializeInlineForms() {
      const inlineForms = document.querySelectorAll(`[data-${DDW_CONFIG.prefix}inline-form]`);
      inlineForms.forEach(form => {
        this.setupInlineForm(form);
      });
    }

    setupInlineForm(form) {
      const checkInInput = form.querySelector('#ddw-checkin');
      const checkOutInput = form.querySelector('#ddw-checkout');
      const adultsSelect = form.querySelector('#ddw-adults');
      const childrenSelect = form.querySelector('#ddw-children');

      // Get configuration from data attributes
      const config = {
        destination: form.dataset.ddwDestination || DDW_CONFIG.baseUrl,
        defaultAdults: parseInt(form.dataset.ddwDefaultAdults) || DDW_CONFIG.defaultAdults,
        defaultChildren: parseInt(form.dataset.ddwDefaultChildren) || DDW_CONFIG.defaultChildren,
        minNights: parseInt(form.dataset.ddwMinNights) || 2,
        prefill: form.dataset.ddwPrefill || 'auto'
      };

      // Prefill from URL if enabled
      if (config.prefill === 'auto') {
        this.prefillFromURL(form, config);
      }

      // Set up date validation
      if (checkInInput && checkOutInput) {
        checkInInput.addEventListener('change', () => {
          this.updateCheckOutMin(checkInInput, checkOutInput, config.minNights);
        });
      }
    }

    prefillFromURL(form, config) {
      const urlParams = new URLSearchParams(window.location.search);
      const checkIn = urlParams.get('checkIn');
      const checkOut = urlParams.get('checkOut');
      const adults = urlParams.get('adults');
      const children = urlParams.get('children');

      const checkInInput = form.querySelector('#ddw-checkin');
      const checkOutInput = form.querySelector('#ddw-checkout');
      const adultsSelect = form.querySelector('#ddw-adults');
      const childrenSelect = form.querySelector('#ddw-children');

      if (checkIn && checkInInput) {
        checkInInput.value = checkIn;
      }

      if (checkOut && checkOutInput) {
        checkOutInput.value = checkOut;
      }

      if (adults && adultsSelect) {
        adultsSelect.value = Math.max(1, Math.min(10, parseInt(adults)));
      }

      if (children && childrenSelect) {
        childrenSelect.value = Math.max(0, Math.min(10, parseInt(children)));
      }
    }

    updateCheckOutMin(checkInInput, checkOutInput, minNights) {
      if (checkInInput.value) {
        const checkInDate = parseDate(checkInInput.value);
        if (checkInDate) {
          const minCheckOut = addDays(checkInDate, minNights);
          checkOutInput.min = formatDate(minCheckOut);
          
          // Auto-adjust if current check-out is invalid
          if (checkOutInput.value && parseDate(checkOutInput.value) <= checkInDate) {
            checkOutInput.value = formatDate(minCheckOut);
          }
        }
      }
    }

    open(destination, trigger) {
      if (this.isOpen) return;
      
      this.destination = destination;
      this.previousActiveElement = document.activeElement;
      this.isOpen = true;
      
      // Get configuration from trigger
      this.getTriggerConfig(trigger);
      
      this.render();
      this.trapFocus();
    }

    getTriggerConfig(trigger) {
      this.formData = {
        checkIn: formatDate(DDW_CONFIG.defaultCheckIn),
        checkOut: formatDate(DDW_CONFIG.defaultCheckOut),
        adults: parseInt(trigger.dataset.ddwDefaultAdults) || DDW_CONFIG.defaultAdults,
        children: parseInt(trigger.dataset.ddwDefaultChildren) || DDW_CONFIG.defaultChildren
      };

      // Prefill from URL if enabled
      if (trigger.dataset.ddwPrefill === 'auto') {
        const urlParams = new URLSearchParams(window.location.search);
        const checkIn = urlParams.get('checkIn');
        const checkOut = urlParams.get('checkOut');
        const adults = urlParams.get('adults');
        const children = urlParams.get('children');

        if (checkIn) this.formData.checkIn = checkIn;
        if (checkOut) this.formData.checkOut = checkOut;
        if (adults) this.formData.adults = Math.max(1, Math.min(10, parseInt(adults)));
        if (children) this.formData.children = Math.max(0, Math.min(10, parseInt(children)));
      }

      // Apply auto-corrections
      this.applyAutoCorrections(trigger);
    }

    applyAutoCorrections(trigger) {
      const minNights = parseInt(trigger.dataset.ddwMinNights) || 2;

      // If only checkIn provided, default checkOut = checkIn + minNights
      if (this.formData.checkIn && !this.formData.checkOut) {
        const checkInDate = parseDate(this.formData.checkIn);
        if (checkInDate) {
          this.formData.checkOut = formatDate(addDays(checkInDate, minNights));
        }
      }

      // If checkOut <= checkIn, nudge checkOut = checkIn + 1
      if (this.formData.checkIn && this.formData.checkOut) {
        const checkInDate = parseDate(this.formData.checkIn);
        const checkOutDate = parseDate(this.formData.checkOut);
        if (checkOutDate && checkInDate && checkOutDate <= checkInDate) {
          this.formData.checkOut = formatDate(addDays(checkInDate, 1));
        }
      }

      // Clamp values
      this.formData.adults = Math.max(1, Math.min(10, this.formData.adults));
      this.formData.children = Math.max(0, Math.min(10, this.formData.children));
    }

    close() {
      if (!this.isOpen) return;
      
      this.isOpen = false;
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
      
      // Restore focus
      if (this.previousActiveElement) {
        this.previousActiveElement.focus();
      }
    }

    render() {
      // Create overlay
      this.overlay = document.createElement('div');
      this.overlay.className = `${DDW_CONFIG.prefix}overlay`;
      this.overlay.setAttribute('role', 'dialog');
      this.overlay.setAttribute('aria-modal', 'true');
      this.overlay.setAttribute('aria-labelledby', `${DDW_CONFIG.prefix}title`);

      // Create popover
      const popover = document.createElement('div');
      popover.className = `${DDW_CONFIG.prefix}popover`;
      
      popover.innerHTML = `
        <div class="${DDW_CONFIG.prefix}header">
          <h2 id="${DDW_CONFIG.prefix}title" class="${DDW_CONFIG.prefix}title">Book Your Stay</h2>
          <button class="${DDW_CONFIG.prefix}close" aria-label="Close">&times;</button>
        </div>
        <div class="${DDW_CONFIG.prefix}content">
          <form class="${DDW_CONFIG.prefix}form" novalidate>
            <div class="${DDW_CONFIG.prefix}grid">
              <div class="${DDW_CONFIG.prefix}field">
                <label for="${DDW_CONFIG.prefix}checkin" class="${DDW_CONFIG.prefix}label">Check-in</label>
                <input 
                  type="date" 
                  id="${DDW_CONFIG.prefix}checkin" 
                  class="${DDW_CONFIG.prefix}input ${this.errors.checkIn ? `${DDW_CONFIG.prefix}error` : ''}"
                  value="${this.formData.checkIn}"
                  min="${formatDate(DDW_CONFIG.minDate)}"
                  required
                >
                ${this.errors.checkIn ? `<div class="${DDW_CONFIG.prefix}error-message">${this.errors.checkIn}</div>` : ''}
              </div>
              <div class="${DDW_CONFIG.prefix}field">
                <label for="${DDW_CONFIG.prefix}checkout" class="${DDW_CONFIG.prefix}label">Check-out</label>
                <input 
                  type="date" 
                  id="${DDW_CONFIG.prefix}checkout" 
                  class="${DDW_CONFIG.prefix}input ${this.errors.checkOut ? `${DDW_CONFIG.prefix}error` : ''}"
                  value="${this.formData.checkOut}"
                  min="${this.formData.checkIn || formatDate(DDW_CONFIG.minDate)}"
                  required
                >
                ${this.errors.checkOut ? `<div class="${DDW_CONFIG.prefix}error-message">${this.errors.checkOut}</div>` : ''}
              </div>
            </div>
            <div class="${DDW_CONFIG.prefix}grid">
              <div class="${DDW_CONFIG.prefix}field">
                <label for="${DDW_CONFIG.prefix}adults" class="${DDW_CONFIG.prefix}label">Adults</label>
                <select id="${DDW_CONFIG.prefix}adults" class="${DDW_CONFIG.prefix}select">
                  ${Array.from({length: 10}, (_, i) => i + 1).map(num => 
                    `<option value="${num}" ${num === this.formData.adults ? 'selected' : ''}>${num} ${num === 1 ? 'Adult' : 'Adults'}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="${DDW_CONFIG.prefix}field">
                <label for="${DDW_CONFIG.prefix}children" class="${DDW_CONFIG.prefix}label">Children</label>
                <select id="${DDW_CONFIG.prefix}children" class="${DDW_CONFIG.prefix}select">
                  ${Array.from({length: 11}, (_, i) => i).map(num => 
                    `<option value="${num}" ${num === this.formData.children ? 'selected' : ''}>${num} ${num === 1 ? 'Child' : 'Children'}</option>`
                  ).join('')}
                </select>
              </div>
            </div>
            <button type="submit" class="${DDW_CONFIG.prefix}submit">
              Search cabins →
            </button>
          </form>
        </div>
      `;

      this.overlay.appendChild(popover);
      document.body.appendChild(this.overlay);

      // Bind events
      this.bindFormEvents();
    }

    bindFormEvents() {
      const form = this.overlay.querySelector(`.${DDW_CONFIG.prefix}form`);
      const checkInInput = this.overlay.querySelector(`#${DDW_CONFIG.prefix}checkin`);
      const checkOutInput = this.overlay.querySelector(`#${DDW_CONFIG.prefix}checkout`);
      const adultsSelect = this.overlay.querySelector(`#${DDW_CONFIG.prefix}adults`);
      const childrenSelect = this.overlay.querySelector(`#${DDW_CONFIG.prefix}children`);
      const closeBtn = this.overlay.querySelector(`.${DDW_CONFIG.prefix}close`);

      // Close on overlay click
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.close();
        }
      });

      // Close button
      closeBtn.addEventListener('click', () => this.close());

      // Form submission
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSubmit();
      });

      // Enhanced date picker functionality
      checkInInput.addEventListener('change', () => {
        this.formData.checkIn = checkInInput.value;
        this.validateDates();
        this.updateCheckOutMin(checkInInput, checkOutInput, 2);
      });

      checkInInput.addEventListener('focus', () => {
        checkInInput.showPicker && checkInInput.showPicker();
      });

      checkOutInput.addEventListener('change', () => {
        this.formData.checkOut = checkOutInput.value;
        this.validateDates();
      });

      checkOutInput.addEventListener('focus', () => {
        checkOutInput.showPicker && checkOutInput.showPicker();
      });

      // Guest count changes
      adultsSelect.addEventListener('change', () => {
        this.formData.adults = parseInt(adultsSelect.value);
      });

      childrenSelect.addEventListener('change', () => {
        this.formData.children = parseInt(childrenSelect.value);
      });

      // Update focusable elements for trap
      this.updateFocusableElements();
    }

    initInlineForms() {
      const inlineForms = document.querySelectorAll(`[data-${DDW_CONFIG.prefix}inline-form]`);
      inlineForms.forEach(form => {
        const checkInInput = form.querySelector('#ddw-checkin');
        const checkOutInput = form.querySelector('#ddw-checkout');
        
        if (checkInInput) {
          checkInInput.addEventListener('focus', () => {
            checkInInput.showPicker && checkInInput.showPicker();
          });
        }
        
        if (checkOutInput) {
          checkOutInput.addEventListener('focus', () => {
            checkOutInput.showPicker && checkOutInput.showPicker();
          });
        }
      });
    }


    handleInlineSubmit(form) {
      const checkInInput = form.querySelector('#ddw-checkin');
      const checkOutInput = form.querySelector('#ddw-checkout');
      const adultsSelect = form.querySelector('#ddw-adults');
      const childrenSelect = form.querySelector('#ddw-children');

      const formData = {
        checkIn: checkInInput.value,
        checkOut: checkOutInput.value,
        adults: parseInt(adultsSelect.value),
        children: parseInt(childrenSelect.value)
      };

      // Apply auto-corrections
      this.applyInlineAutoCorrections(formData, form);

      // Validate
      if (!this.validateInlineForm(formData)) {
        return;
      }

      // Navigate
      const destination = form.dataset.ddwDestination || DDW_CONFIG.baseUrl;
      const params = new URLSearchParams({
        checkIn: formData.checkIn,
        checkOut: formData.checkOut,
        adults: formData.adults.toString(),
        children: formData.children.toString()
      });

      window.location.href = `${destination}/search?${params.toString()}`;
    }

    applyInlineAutoCorrections(formData, form) {
      const minNights = parseInt(form.dataset.ddwMinNights) || 2;

      // If only checkIn provided, default checkOut = checkIn + minNights
      if (formData.checkIn && !formData.checkOut) {
        const checkInDate = parseDate(formData.checkIn);
        if (checkInDate) {
          formData.checkOut = formatDate(addDays(checkInDate, minNights));
        }
      }

      // If checkOut <= checkIn, nudge checkOut = checkIn + 1
      if (formData.checkIn && formData.checkOut) {
        const checkInDate = parseDate(formData.checkIn);
        const checkOutDate = parseDate(formData.checkOut);
        if (checkOutDate && checkInDate && checkOutDate <= checkInDate) {
          formData.checkOut = formatDate(addDays(checkInDate, 1));
          // Update the input
          const checkOutInput = form.querySelector('#ddw-checkout');
          if (checkOutInput) checkOutInput.value = formData.checkOut;
        }
      }

      // Clamp values
      formData.adults = Math.max(1, Math.min(10, formData.adults));
      formData.children = Math.max(0, Math.min(10, formData.children));
    }

    validateInlineForm(formData) {
      const errors = [];

      if (!formData.checkIn) {
        errors.push('Check-in date is required');
      } else {
        const checkInDate = parseDate(formData.checkIn);
        if (checkInDate && checkInDate < new Date()) {
          errors.push('Check-in date cannot be in the past');
        }
      }

      if (!formData.checkOut) {
        errors.push('Check-out date is required');
      } else if (formData.checkIn) {
        const checkInDate = parseDate(formData.checkIn);
        const checkOutDate = parseDate(formData.checkOut);
        if (checkOutDate && checkInDate && checkOutDate <= checkInDate) {
          errors.push('Check-out date must be after check-in date');
        }
      }

      if (errors.length > 0) {
        this.showToast(errors.join(', '));
        return false;
      }

      return true;
    }

    validateDates() {
      this.errors = {};
      const checkIn = parseDate(this.formData.checkIn);
      const checkOut = parseDate(this.formData.checkOut);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (!checkIn) {
        this.errors.checkIn = 'Check-in date is required';
      } else if (checkIn < today) {
        this.errors.checkIn = 'Check-in date cannot be in the past';
      }

      if (!checkOut) {
        this.errors.checkOut = 'Check-out date is required';
      } else if (checkOut <= checkIn) {
        this.errors.checkOut = 'Check-out date must be after check-in date';
        // Auto-fix: set check-out to check-in + 1 day
        const fixedCheckOut = addDays(checkIn, 1);
        this.formData.checkOut = formatDate(fixedCheckOut);
        this.showToast('Check-out date adjusted to be after check-in date');
      }

      this.updateErrorDisplay();
    }

    updateErrorDisplay() {
      const checkInInput = this.overlay.querySelector(`#${DDW_CONFIG.prefix}checkin`);
      const checkOutInput = this.overlay.querySelector(`#${DDW_CONFIG.prefix}checkout`);

      if (checkInInput) {
        checkInInput.className = `${DDW_CONFIG.prefix}input ${this.errors.checkIn ? `${DDW_CONFIG.prefix}error` : ''}`;
      }

      if (checkOutInput) {
        checkOutInput.className = `${DDW_CONFIG.prefix}input ${this.errors.checkOut ? `${DDW_CONFIG.prefix}error` : ''}`;
      }

      // Re-render to show error messages
      if (Object.keys(this.errors).length > 0) {
        this.render();
      }
    }

    handleSubmit() {
      this.validateDates();

      if (Object.keys(this.errors).length > 0) {
        this.showToast('Please fix the errors before continuing');
        return;
      }

      // Build URL and redirect
      const params = new URLSearchParams({
        checkIn: this.formData.checkIn,
        checkOut: this.formData.checkOut,
        adults: this.formData.adults.toString(),
        children: this.formData.children.toString()
      });

      const url = `${this.destination}/search?${params.toString()}`;
      window.location.href = url;
    }

    showToast(message) {
      const toast = document.createElement('div');
      toast.className = `${DDW_CONFIG.prefix}toast`;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 3000);
    }

    updateFocusableElements() {
      this.focusableElements = this.overlay.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
    }

    trapFocus(e) {
      if (!this.isOpen) return;

      const firstElement = this.focusableElements[0];
      const lastElement = this.focusableElements[this.focusableElements.length - 1];

      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    }

    trapFocus() {
      this.updateFocusableElements();
      
      if (this.focusableElements.length > 0) {
        this.focusableElements[0].focus();
      }

      // Bind focus trap
      document.addEventListener('keydown', this.trapFocus.bind(this));
    }
  }

  // Initialize widget when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new BookingWidget();
    });
  } else {
    new BookingWidget();
  }


})();
