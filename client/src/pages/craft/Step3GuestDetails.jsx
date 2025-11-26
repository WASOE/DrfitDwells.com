import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingContext } from '../../context/BookingContext';

const Step3GuestDetails = () => {
  const navigate = useNavigate();
  const { 
    guestInfo, 
    tripType, 
    transportMethod, 
    adults, 
    children, 
    checkIn,
    checkOut,
    cabinId,
    updateGuestInfo, 
    setCurrentStep 
  } = useBookingContext();
  
  const [formData, setFormData] = useState({
    fullName: guestInfo.fullName || '',
    email: guestInfo.email || '',
    phone: guestInfo.phone || '',
    specialRequests: guestInfo.specialRequests || '',
    agreedToTerms: guestInfo.agreedToTerms || false,
    romanticSetup: guestInfo.romanticSetup || false
  });

  const [errors, setErrors] = useState({});

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
    
    // If no cabin selected, redirect to search with draft context
    // Otherwise continue to Step 4 for booking confirmation
    if (!cabinId) {
      // Build search URL with current dates if available
      const searchParams = new URLSearchParams();
      if (checkIn) searchParams.set('checkIn', checkIn);
      if (checkOut) searchParams.set('checkOut', checkOut);
      if (adults) searchParams.set('adults', adults.toString());
      if (children) searchParams.set('children', children.toString());
      navigate(`/search?${searchParams.toString()}`);
    } else {
      navigate('/craft/step-4');
    }
  };

  const handleBack = () => {
    navigate('/craft/step-2');
  };

  const isFormValid = formData.fullName.trim() && 
                     formData.email.trim() && 
                     /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email) && 
                     formData.agreedToTerms;

  return (
    <div className="min-h-screen bg-white">
      {/* Editorial Header Section */}
      <div className="block-editorial">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h1 className="headline-editorial mb-8 text-white">
            Just a few more details...
          </h1>
          <p className="text-editorial text-gray-300 max-w-2xl mx-auto">
            We're almost ready to craft your perfect retreat
          </p>
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="block-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex items-center justify-center space-x-6">
            <div className="w-8 h-8 bg-sage rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-light">1</span>
            </div>
            <div className="h-px w-20 bg-sage"></div>
            <div className="w-8 h-8 bg-sage rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-light">2</span>
            </div>
            <div className="h-px w-20 bg-sage"></div>
            <div className="w-8 h-8 bg-sage rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-light">3</span>
            </div>
            <div className="h-px w-20 bg-gray-300"></div>
            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-gray-500 text-sm font-light">4</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-20">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
          {/* Form Section */}
          <div className="lg:col-span-2">
            <div className="card-editorial p-8">
              <h2 className="headline-subsection mb-8">Guest Information</h2>
              
              <div className="space-y-12">
                {/* Full Name */}
                <div>
                  <label className="label-editorial">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => handleInputChange('fullName', e.target.value)}
                    className={`input-editorial ${
                      errors.fullName ? 'border-red-500' : ''
                    }`}
                    placeholder="Enter your full name"
                  />
                  {errors.fullName && (
                    <p className="mt-2 text-sm text-red-600">{errors.fullName}</p>
                  )}
                </div>

                {/* Email */}
                <div>
                  <label className="label-editorial">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className={`input-editorial ${
                      errors.email ? 'border-red-500' : ''
                    }`}
                    placeholder="your.email@example.com"
                  />
                  {errors.email && (
                    <p className="mt-2 text-sm text-red-600">{errors.email}</p>
                  )}
                </div>

                {/* Phone */}
                <div>
                  <label className="label-editorial">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    className="input-editorial"
                    placeholder="+1 (555) 123-4567"
                  />
                  <p className="mt-2 text-sm text-gray-500 font-light">Optional - for important updates about your stay</p>
                </div>

                {/* Special Requests */}
                <div>
                  <label className="label-editorial">
                    Special Requests or Notes
                  </label>
                  <textarea
                    value={formData.specialRequests}
                    onChange={(e) => handleInputChange('specialRequests', e.target.value)}
                    className="input-editorial resize-none"
                    rows={4}
                    placeholder="Any dietary restrictions, accessibility needs, or special requests for your stay..."
                  />
                  <p className="mt-2 text-sm text-gray-500 font-light">Let us know how we can make your stay even more special</p>
                </div>

                {/* Romantic Setup (only for Romantic Getaway) */}
                {tripType === 'romantic' && (
                  <div className="p-8 bg-sage/5 border border-sage/20">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.romanticSetup}
                        onChange={(e) => handleInputChange('romanticSetup', e.target.checked)}
                        className="w-5 h-5 text-sage border-gray-300 rounded focus:ring-sage focus:ring-2"
                      />
                      <span className="ml-4 text-body text-black">
                        Would you like a romantic setup?
                      </span>
                    </label>
                    <p className="mt-3 text-body text-gray-600 leading-loose">
                      We can arrange special touches like rose petals, candles, and champagne for your romantic getaway
                    </p>
                  </div>
                )}

                {/* Terms and Conditions */}
                <div>
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.agreedToTerms}
                      onChange={(e) => handleInputChange('agreedToTerms', e.target.checked)}
                      className={`w-5 h-5 text-sage border-gray-300 rounded focus:ring-sage focus:ring-2 mt-0.5 ${
                        errors.agreedToTerms ? 'border-red-500' : ''
                      }`}
                    />
                    <span className="ml-4 text-body text-black leading-relaxed">
                      I agree to the{' '}
                      <a href="#" className="text-sage hover:text-sage-dark underline font-light">
                        retreat terms and conditions
                      </a>{' '}
                      and understand the cancellation policy *
                    </span>
                  </label>
                  {errors.agreedToTerms && (
                    <p className="mt-2 text-sm text-red-600">{errors.agreedToTerms}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Summary Sidebar */}
          <div className="lg:col-span-1">
            <div className="card-editorial p-8 sticky top-8">
              <h3 className="headline-subsection mb-8">Your Retreat Summary</h3>
              
              <div className="space-y-8 text-body">
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

        {/* Navigation */}
        <div className="flex justify-between items-center max-w-2xl mx-auto mt-20">
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
    </div>
  );
};

export default Step3GuestDetails;

