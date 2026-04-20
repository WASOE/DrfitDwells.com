import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useBookingContext } from '../../context/BookingContext';
import StickyBookingBar from '../../components/StickyBookingBar';
import {
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} from '../../constants/legalAcceptance';

const Step3GuestDetails = () => {
  const navigate = useNavigate();
  const { 
    guestInfo, 
    tripType, 
    transportMethod, 
    adults, 
    children, 
    checkIn: _checkIn,
    checkOut: _checkOut,
    cabinId,
    currentStep,
    totalSteps,
    updateGuestInfo, 
    setCurrentStep 
  } = useBookingContext();
  
  const [formData, setFormData] = useState({
    fullName: guestInfo.fullName || '',
    email: guestInfo.email || '',
    phone: guestInfo.phone || '',
    specialRequests: guestInfo.specialRequests || '',
    agreedToTerms: guestInfo.agreedToTerms || false,
    agreedToActivityRisk: guestInfo.agreedToActivityRisk || false,
    romanticSetup: guestInfo.romanticSetup || false
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    setCurrentStep(3);
  }, [setCurrentStep]);

  // Calculate total transport cost
  const totalGuests = adults + children;
  const totalTransportCost = transportMethod ? transportMethod.pricePerPerson * totalGuests : 0;

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    }
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    if (!formData.agreedToTerms) {
      newErrors.agreedToTerms = 'You must agree to the terms and conditions';
    }
    if (!formData.agreedToActivityRisk) {
      newErrors.agreedToActivityRisk = 'You must accept the activity and terrain risk statement';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    // DEV audit logging
    if (import.meta.env.DEV) {
      console.debug('[Craft Step 3] Next clicked', { 
        formData, 
        isFormValid,
        tripType,
        transportMethod,
        cabinId: cabinId || 'not set'
      });
    }
    
    if (!validateForm()) {
      return;
    }
    
    // Save guest info to context
    updateGuestInfo(formData);
    setCurrentStep(4);
    
    // Always navigate to Step 4 - it will show cabin selection prompt if needed
    navigate('/craft/step-4');
  };

  const handleBack = () => {
    navigate('/craft/step-2');
  };

  const isFormValid = formData.fullName.trim() && 
                     formData.email.trim() && 
                     /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email) && 
                     formData.agreedToTerms &&
                     formData.agreedToActivityRisk;

  const stepLabel = `Step ${currentStep || 3} of ${totalSteps || 4}`;
  const guestSummary = formData.fullName ? formData.fullName : 'Guest information needed';

  return (
    <div className="min-h-screen bg-white pb-24 md:pb-32">
      {/* Mobile-Optimized Header Section */}
      <div className="block-editorial">
        <div className="max-w-4xl mx-auto px-4 md:px-6 text-center py-8 md:py-12">
          <h1 className="text-3xl md:text-5xl font-serif font-bold text-white mb-4 md:mb-8 tracking-tight md:tracking-editorial">
            Just a few more details...
          </h1>
          <p className="text-base md:text-lg font-sans font-light text-gray-300 max-w-2xl mx-auto leading-relaxed px-2">
            We're almost ready to craft your perfect retreat
          </p>
        </div>
      </div>

      {/* Mobile-Optimized Progress Indicator */}
      <div className="block-white py-6 md:py-12">
        <div className="max-w-4xl mx-auto px-4 md:px-6">
          <div className="flex items-center justify-center gap-2 md:gap-6">
            <div className="w-10 h-10 md:w-8 md:h-8 bg-sage rounded-full flex items-center justify-center shadow-sm">
              <span className="text-white text-base md:text-sm font-medium md:font-light">1</span>
            </div>
            <div className="h-px flex-1 max-w-12 md:max-w-20 bg-sage"></div>
            <div className="w-10 h-10 md:w-8 md:h-8 bg-sage rounded-full flex items-center justify-center shadow-sm">
              <span className="text-white text-base md:text-sm font-medium md:font-light">2</span>
            </div>
            <div className="h-px flex-1 max-w-12 md:max-w-20 bg-sage"></div>
            <div className="w-10 h-10 md:w-8 md:h-8 bg-sage rounded-full flex items-center justify-center shadow-sm">
              <span className="text-white text-base md:text-sm font-medium md:font-light">3</span>
            </div>
            <div className="h-px flex-1 max-w-12 md:max-w-20 bg-gray-300"></div>
            <div className="w-10 h-10 md:w-8 md:h-8 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-gray-500 text-base md:text-sm font-medium md:font-light">4</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Mobile Optimized */}
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-20">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-16">
          {/* Form Section */}
          <div className="lg:col-span-2">
            <div className="card-editorial p-5 md:p-8">
              <h2 className="text-xl md:text-2xl font-serif font-bold mb-6 md:mb-8 tracking-editorial">Guest Information</h2>
              
              <div className="space-y-8 md:space-y-12">
                {/* Full Name - Mobile Optimized */}
                <div>
                  <label className="block text-xs font-sans font-light text-gray-600 mb-3 tracking-wide uppercase">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => handleInputChange('fullName', e.target.value)}
                    className={`w-full px-0 py-3 md:py-4 border-0 border-b border-gray-300 focus:border-black outline-none transition-all duration-200 bg-transparent font-light text-base md:text-lg ${
                      errors.fullName ? 'border-red-500' : ''
                    }`}
                    placeholder="Enter your full name"
                  />
                  {errors.fullName && (
                    <p className="mt-2 text-sm text-red-600">{errors.fullName}</p>
                  )}
                </div>

                {/* Email - Mobile Optimized */}
                <div>
                  <label className="block text-xs font-sans font-light text-gray-600 mb-3 tracking-wide uppercase">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className={`w-full px-0 py-3 md:py-4 border-0 border-b border-gray-300 focus:border-black outline-none transition-all duration-200 bg-transparent font-light text-base md:text-lg ${
                      errors.email ? 'border-red-500' : ''
                    }`}
                    placeholder="your.email@example.com"
                  />
                  {errors.email && (
                    <p className="mt-2 text-sm text-red-600">{errors.email}</p>
                  )}
                </div>

                {/* Phone - Mobile Optimized */}
                <div>
                  <label className="block text-xs font-sans font-light text-gray-600 mb-3 tracking-wide uppercase">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    className="w-full px-0 py-3 md:py-4 border-0 border-b border-gray-300 focus:border-black outline-none transition-all duration-200 bg-transparent font-light text-base md:text-lg"
                    placeholder="+1 (555) 123-4567"
                  />
                  <p className="mt-2 text-xs md:text-sm text-gray-500 font-light">Optional - for important updates about your stay</p>
                </div>

                {/* Special Requests - Mobile Optimized */}
                <div>
                  <label className="block text-xs font-sans font-light text-gray-600 mb-3 tracking-wide uppercase">
                    Special Requests or Notes
                  </label>
                  <textarea
                    value={formData.specialRequests}
                    onChange={(e) => handleInputChange('specialRequests', e.target.value)}
                    className="w-full px-0 py-3 md:py-4 border-0 border-b border-gray-300 focus:border-black outline-none transition-all duration-200 bg-transparent font-light text-base md:text-lg resize-none"
                    rows={4}
                    placeholder="Any dietary restrictions, accessibility needs, or special requests for your stay..."
                  />
                  <p className="mt-2 text-xs md:text-sm text-gray-500 font-light">Let us know how we can make your stay even more special</p>
                </div>

                {/* Romantic Setup (only for Romantic Getaway) - Mobile Optimized */}
                {tripType === 'romantic' && (
                  <div className="p-5 md:p-8 bg-sage/5 border border-sage/20 rounded-lg">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.romanticSetup}
                        onChange={(e) => handleInputChange('romanticSetup', e.target.checked)}
                        className="w-5 h-5 text-sage border-gray-300 rounded focus:ring-sage focus:ring-2 flex-shrink-0"
                      />
                      <span className="ml-4 text-sm md:text-base font-sans font-light text-black">
                        Would you like a romantic setup?
                      </span>
                    </label>
                    <p className="mt-3 text-sm md:text-base font-sans font-light text-gray-600 leading-relaxed">
                      We can arrange special touches like rose petals, candles, and champagne for your romantic getaway
                    </p>
                  </div>
                )}

                {/* Terms and Conditions - Mobile Optimized */}
                <div>
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.agreedToTerms}
                      onChange={(e) => handleInputChange('agreedToTerms', e.target.checked)}
                      className={`w-5 h-5 text-sage border-gray-300 rounded focus:ring-sage focus:ring-2 mt-0.5 flex-shrink-0 ${
                        errors.agreedToTerms ? 'border-red-500' : ''
                      }`}
                    />
                    <span className="ml-4 text-sm md:text-base font-sans font-light text-black leading-relaxed">
                      I have read and accept the{' '}
                      <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-sage hover:text-sage-dark underline">
                        Terms & Conditions
                      </Link>{' '}
                      and{' '}
                      <Link to="/cancellation-policy" target="_blank" rel="noopener noreferrer" className="text-sage hover:text-sage-dark underline">
                        Cancellation Policy
                      </Link> *
                    </span>
                  </label>
                  {errors.agreedToTerms && (
                    <p className="mt-2 text-sm text-red-600">{errors.agreedToTerms}</p>
                  )}
                </div>
                <div>
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.agreedToActivityRisk}
                      onChange={(e) => handleInputChange('agreedToActivityRisk', e.target.checked)}
                      className={`w-5 h-5 text-sage border-gray-300 rounded focus:ring-sage focus:ring-2 mt-0.5 flex-shrink-0 ${
                        errors.agreedToActivityRisk ? 'border-red-500' : ''
                      }`}
                    />
                    <span className="ml-4 text-sm md:text-base font-sans font-light text-black leading-relaxed">
                      {LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT}
                    </span>
                  </label>
                  {errors.agreedToActivityRisk && (
                    <p className="mt-2 text-sm text-red-600">{errors.agreedToActivityRisk}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Summary Sidebar - Hidden on mobile, shown on desktop */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="card-editorial p-8 sticky top-8">
              <h3 className="text-xl md:text-2xl font-serif font-bold mb-8 tracking-editorial">Your Retreat Summary</h3>
              
              <div className="space-y-8 text-sm md:text-base font-sans font-light">
                {/* Trip Type */}
                <div>
                  <span className="text-gray-600 block text-xs tracking-wide mb-3 uppercase">Trip Type:</span>
                  <span className="font-light text-black capitalize">
                    {tripType === 'romantic' ? 'Romantic Getaway' :
                     tripType === 'family' ? 'Family Retreat' :
                     tripType === 'solo' ? 'Solo Reset' :
                     tripType === 'digital-detox' ? 'Digital Detox' :
                     tripType === 'creative' ? 'Creative Escape' :
                     tripType === 'nature' ? 'Nature Exploration' :
                     tripType === 'adventure' ? 'Adventure Weekend' :
                     tripType === 'other' ? 'Other' : tripType}
                  </span>
                </div>

                {/* Transport Method */}
                {transportMethod && (
                  <div>
                    <span className="text-gray-600 block text-xs tracking-wide mb-3 uppercase">Transport:</span>
                    <span className="font-light text-black">{transportMethod.type}</span>
                    <div className="text-sm text-gray-500 mt-2 font-light">
                      {transportMethod.duration} • {transportMethod.pricePerPerson === 0 ? 'Free' : `€${transportMethod.pricePerPerson}/person`}
                    </div>
                  </div>
                )}

                {/* Guest Count */}
                <div>
                  <span className="text-gray-600 block text-xs tracking-wide mb-3 uppercase">Guests:</span>
                  <span className="font-light text-black">
                    {adults} {adults === 1 ? 'Adult' : 'Adults'}
                    {children > 0 && `, ${children} ${children === 1 ? 'Child' : 'Children'}`}
                  </span>
                </div>

                {/* Transport Cost */}
                {transportMethod && (
                  <div className="border-t border-gray-200 pt-6">
                    <div className="flex justify-between">
                      <span className="text-gray-600 text-xs tracking-wide uppercase">Transport cost:</span>
                      <span className="font-light text-sage">
                        {totalTransportCost === 0 ? 'Free' : `€${totalTransportCost}`}
                      </span>
                    </div>
                  </div>
                )}

                {/* Romantic Setup */}
                {tripType === 'romantic' && formData.romanticSetup && (
                  <div className="p-6 bg-sage/5 border border-sage/20">
                    <div className="flex items-center text-sage">
                      <span className="text-sm font-light">Romantic setup requested</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex justify-between items-center max-w-2xl mx-auto mt-12 md:mt-20">
          <button
            onClick={handleBack}
            className="btn-underline"
          >
            ← back
          </button>
          
          <button
            onClick={handleNext}
            disabled={!isFormValid}
            className={`btn-pill ${
              !isFormValid ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            next step →
          </button>
        </div>
      </div>

      <StickyBookingBar
        className="md:hidden"
        label={stepLabel}
        subLabel={guestSummary}
        buttonLabel="Next step →"
        buttonDisabled={!isFormValid}
        onButtonClick={handleNext}
      />
    </div>
  );
};

export default Step3GuestDetails;

