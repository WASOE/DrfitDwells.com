import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useBookingContext } from '../../context/BookingContext';
import { cabinAPI } from '../../services/api';

// Nature-inspired icons (reused from Step1)
const HeartIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

const FamilyIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const SoloIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const DetoxIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192L5.636 18.364M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const CreativeIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423L16.5 15.75l.394 1.183a2.25 2.25 0 001.423 1.423L19.5 18.75l-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
);

const NatureIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.414 48.414 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L18.75 4.97zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L5.25 4.97z" />
  </svg>
);

const AdventureIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
  </svg>
);

const OtherIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CraftEmbedded = () => {
  const { 
    cabinId, 
    checkIn, 
    checkOut, 
    adults, 
    children, 
    tripType, 
    customTripType, 
    transportMethod, 
    guestInfo,
    setTripType, 
    setCustomTripType, 
    setTransportMethod, 
    updateGuestInfo 
  } = useBookingContext();

  const [currentStep, setCurrentStep] = useState(1);
  const [cabin, setCabin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form data for guest details
  const [formData, setFormData] = useState({
    fullName: guestInfo.fullName || '',
    email: guestInfo.email || '',
    phone: guestInfo.phone || '',
    specialRequests: guestInfo.specialRequests || '',
    agreedToTerms: guestInfo.agreedToTerms || false,
    romanticSetup: guestInfo.romanticSetup || false
  });

  const [errors, setErrors] = useState({});

  // Trip types data
  const tripTypes = [
    { id: 'romantic', title: 'Romantic Getaway', description: 'Intimate moments in nature', icon: <HeartIcon /> },
    { id: 'family', title: 'Family Retreat', description: 'Quality time with loved ones', icon: <FamilyIcon /> },
    { id: 'solo', title: 'Solo Reset', description: 'Personal reflection and renewal', icon: <SoloIcon /> },
    { id: 'digital-detox', title: 'Digital Detox', description: 'Unplug and reconnect with nature', icon: <DetoxIcon /> },
    { id: 'creative', title: 'Creative Escape', description: 'Inspiration in natural surroundings', icon: <CreativeIcon /> },
    { id: 'nature', title: 'Nature Exploration', description: 'Adventure and discovery', icon: <NatureIcon /> },
    { id: 'adventure', title: 'Adventure Weekend', description: 'Thrills and outdoor activities', icon: <AdventureIcon /> },
    { id: 'other', title: 'Other', description: 'Something unique to you', icon: <OtherIcon /> }
  ];

  // Load cabin data for transport options
  useEffect(() => {
    const loadCabin = async () => {
      if (!cabinId) return;
      
      try {
        setLoading(true);
        const response = await cabinAPI.getById(cabinId);
        
        if (response.data.success) {
          setCabin(response.data.data.cabin);
        }
      } catch (err) {
        console.error('Load cabin error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadCabin();
  }, [cabinId]);

  // Transport icons
  const getTransportIcon = (type) => {
    const icons = {
      'Horse': <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>,
      'ATV': <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m6 4.5v-3a3 3 0 00-3-3H6.75a3 3 0 00-3 3v3m0 0V9.75a3 3 0 013-3h2.25a3 3 0 013 3v9.75m-6 0h6" /></svg>,
      'Jeep': <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m6 4.5v-3a3 3 0 00-3-3H6.75a3 3 0 00-3 3v3m0 0V9.75a3 3 0 013-3h2.25a3 3 0 013 3v9.75m-6 0h6" /></svg>,
      'Hike': <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.414 48.414 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L18.75 4.97zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L5.25 4.97z" /></svg>,
      'Boat': <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m6 4.5v-3a3 3 0 00-3-3H6.75a3 3 0 00-3 3v3m0 0V9.75a3 3 0 013-3h2.25a3 3 0 013 3v9.75m-6 0h6" /></svg>,
      'Helicopter': <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
    };
    return icons[type] || <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m6 4.5v-3a3 3 0 00-3-3H6.75a3 3 0 00-3 3v3m0 0V9.75a3 3 0 013-3h2.25a3 3 0 013 3v9.75m-6 0h6" /></svg>;
  };

  // Step 1: Trip Type Selection
  const handleTripTypeSelect = (tripTypeId) => {
    setTripType(tripTypeId);
  };

  const handleCustomInputChange = (value) => {
    setCustomTripType(value);
  };

  const handleStep1Next = () => {
    if (!tripType) {
      alert('Please select a trip type to continue.');
      return;
    }
    if (tripType === 'other' && !customTripType.trim()) {
      alert('Please describe your custom trip type.');
      return;
    }
    setCurrentStep(2);
  };

  // Step 2: Transport Method
  const handleTransportSelect = (transport) => {
    setTransportMethod(transport);
  };

  const handleStep2Next = () => {
    if (!transportMethod) {
      alert('Please select a transport method to continue.');
      return;
    }
    setCurrentStep(3);
  };

  const handleStep2Back = () => {
    setCurrentStep(1);
  };

  // Step 3: Guest Details
  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
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

  const handleStep3Back = () => {
    setCurrentStep(2);
  };

  // Final submission
  const handleFinish = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);

      // Save guest info to context
      updateGuestInfo(formData);

      // Prepare draft payload with craft object structure
      const payload = {
        checkIn: checkIn,
        checkOut: checkOut,
        adults: adults,
        children: children,
        // Legacy fields for backward compatibility
        tripType: tripType,
        customTripType: customTripType,
        arrivalMethod: transportMethod?.type || '',
        arrivalMethodDetails: transportMethod ? {
          type: transportMethod.type,
          pricePerPerson: transportMethod.pricePerPerson,
          duration: transportMethod.duration,
          description: transportMethod.description
        } : null,
        notes: formData.specialRequests,
        guestInfo: formData,
        // Future-proof craft object
        craft: {
          version: 1,
          tripType: tripType === 'other' ? (customTripType || 'Other') : tripType,
          transportMethod: transportMethod?.type || null,
          extras: {
            romanticSetup: formData.romanticSetup || false,
            customTripType: customTripType || '',
            specialRequests: formData.specialRequests || ''
          }
        }
      };

      // Create draft
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ payload })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to create draft');
      }

      // Build redirect URL
      const searchParams = new URLSearchParams({
        checkIn: checkIn,
        checkOut: checkOut,
        adults: adults.toString(),
        children: children.toString()
      });

      if (result.token) {
        searchParams.set('draft', result.token);
      }

      const redirect = `/search?${searchParams.toString()}`;

      // Send postMessage to parent window
      const targetOrigin = "https://driftdwells.com";
      window.parent.postMessage(
        { 
          type: "ddw.craft.complete", 
          draftToken: result.token, 
          redirect 
        },
        targetOrigin
      );

    } catch (error) {
      console.error('Error creating draft:', error);
      alert('There was an error processing your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const isFormValid = formData.fullName.trim() && 
                     formData.email.trim() && 
                     /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email) && 
                     formData.agreedToTerms;

  const availableTransports = cabin?.transportOptions?.filter(transport => transport.isAvailable) || [];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-drift-green to-drift-light-green text-white py-8">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h1 className="text-3xl font-bold mb-4">
            {currentStep === 1 && 'What brings you here?'}
            {currentStep === 2 && 'How will you arrive?'}
            {currentStep === 3 && 'Just a few more details...'}
          </h1>
          <p className="text-lg text-gray-200">
            {currentStep === 1 && 'Every journey has a reason. Let us help you shape it.'}
            {currentStep === 2 && cabin && `Choose your preferred way to reach ${cabin.name}`}
            {currentStep === 3 && "We're almost ready to craft your perfect retreat"}
          </p>
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="bg-white border-b border-gray-200 py-6">
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex items-center justify-center space-x-6">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  currentStep >= step ? 'bg-drift-green text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  <span className="text-sm font-light">{step}</span>
                </div>
                {step < 3 && (
                  <div className={`h-px w-20 ml-6 ${
                    currentStep > step ? 'bg-drift-green' : 'bg-gray-300'
                  }`}></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        {currentStep === 1 && (
          <div>
            {/* Trip Type Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              {tripTypes.map((trip) => (
                <button
                  key={trip.id}
                  onClick={() => handleTripTypeSelect(trip.id)}
                  className={`group relative p-6 border transition-all duration-300 bg-white hover:bg-gray-50 ${
                    tripType === trip.id 
                      ? 'border-drift-green border-b-4' 
                      : 'border-gray-200 hover:border-drift-green'
                  }`}
                >
                  {tripType === trip.id && (
                    <div className="absolute top-4 right-4 w-6 h-6 bg-drift-green rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                  
                  <div className="text-center">
                    <div className="flex justify-center mb-4 text-drift-green group-hover:text-drift-light-green transition-colors">
                      {trip.icon}
                    </div>
                    <h3 className="text-lg font-semibold mb-2">
                      {trip.title}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {trip.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* Custom Input for "Other" */}
            {tripType === 'other' && (
              <div className="mb-12">
                <div className="max-w-2xl mx-auto">
                  <label className="block text-sm font-medium text-gray-700 mb-2 text-center">
                    Tell us about your unique experience
                  </label>
                  <textarea
                    value={customTripType}
                    onChange={(e) => handleCustomInputChange(e.target.value)}
                    placeholder="Describe what brings you to our eco-retreat..."
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-drift-green focus:border-drift-green"
                    rows={4}
                  />
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-end">
              <button
                onClick={handleStep1Next}
                className="bg-drift-green text-white px-8 py-3 rounded-lg hover:bg-drift-light-green transition-colors"
              >
                Next Step →
              </button>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div>
            {loading ? (
              <div className="text-center py-20">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-drift-green"></div>
                <p className="mt-6 text-gray-600">Loading transport options...</p>
              </div>
            ) : (
              <>
                {/* Transport Options */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                  {availableTransports.map((transport, index) => {
                    const isSelected = transportMethod?.type === transport.type;
                    
                    return (
                      <button
                        key={index}
                        onClick={() => handleTransportSelect(transport)}
                        className={`group relative p-6 border transition-all duration-300 bg-white hover:bg-gray-50 ${
                          isSelected 
                            ? 'border-drift-green border-b-4' 
                            : 'border-gray-200 hover:border-drift-green'
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute top-4 right-4 w-6 h-6 bg-drift-green rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                        
                        <div className="text-center">
                          <div className="flex justify-center mb-6 text-drift-green group-hover:text-drift-light-green transition-colors">
                            {getTransportIcon(transport.type)}
                          </div>
                          <h3 className="text-lg font-semibold mb-2">
                            {transport.type}
                          </h3>
                          <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                            {transport.description}
                          </p>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-600 flex items-center">
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {transport.duration}
                            </span>
                            <span className="text-drift-green font-medium">
                              {transport.pricePerPerson === 0 ? 'Free' : `€${transport.pricePerPerson}/person`}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Navigation */}
                <div className="flex justify-between">
                  <button
                    onClick={handleStep2Back}
                    className="text-drift-green hover:text-drift-light-green transition-colors"
                  >
                    ← Back
                  </button>
                  
                  <button
                    onClick={handleStep2Next}
                    className="bg-drift-green text-white px-8 py-3 rounded-lg hover:bg-drift-light-green transition-colors"
                  >
                    Next Step →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {currentStep === 3 && (
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Form Section */}
              <div className="lg:col-span-2">
                <div className="bg-white border border-gray-200 rounded-lg p-8">
                  <h2 className="text-xl font-semibold mb-6">Guest Information</h2>
                  
                  <div className="space-y-6">
                    {/* Full Name */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        value={formData.fullName}
                        onChange={(e) => handleInputChange('fullName', e.target.value)}
                        className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-drift-green focus:border-drift-green ${
                          errors.fullName ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="Enter your full name"
                      />
                      {errors.fullName && (
                        <p className="mt-1 text-sm text-red-600">{errors.fullName}</p>
                      )}
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-drift-green focus:border-drift-green ${
                          errors.email ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="your.email@example.com"
                      />
                      {errors.email && (
                        <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                      )}
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-drift-green focus:border-drift-green"
                        placeholder="+1 (555) 123-4567"
                      />
                      <p className="mt-1 text-sm text-gray-500">Optional - for important updates about your stay</p>
                    </div>

                    {/* Special Requests */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Special Requests or Notes
                      </label>
                      <textarea
                        value={formData.specialRequests}
                        onChange={(e) => handleInputChange('specialRequests', e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-drift-green focus:border-drift-green resize-none"
                        rows={4}
                        placeholder="Any dietary restrictions, accessibility needs, or special requests for your stay..."
                      />
                      <p className="mt-1 text-sm text-gray-500">Let us know how we can make your stay even more special</p>
                    </div>

                    {/* Romantic Setup (only for Romantic Getaway) */}
                    {tripType === 'romantic' && (
                      <div className="p-6 bg-drift-green/5 border border-drift-green/20 rounded-lg">
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.romanticSetup}
                            onChange={(e) => handleInputChange('romanticSetup', e.target.checked)}
                            className="w-5 h-5 text-drift-green border-gray-300 rounded focus:ring-drift-green focus:ring-2"
                          />
                          <span className="ml-4 text-gray-900">
                            Would you like a romantic setup?
                          </span>
                        </label>
                        <p className="mt-3 text-sm text-gray-600 leading-relaxed">
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
                          className={`w-5 h-5 text-drift-green border-gray-300 rounded focus:ring-drift-green focus:ring-2 mt-0.5 ${
                            errors.agreedToTerms ? 'border-red-500' : ''
                          }`}
                        />
                        <span className="ml-4 text-sm text-gray-900 leading-relaxed">
                          I agree to the{' '}
                          <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-drift-green hover:text-drift-light-green underline">
                            retreat terms and conditions
                          </Link>{' '}
                          and understand the{' '}
                          <Link to="/cancellation-policy" target="_blank" rel="noopener noreferrer" className="text-drift-green hover:text-drift-light-green underline">
                            cancellation policy
                          </Link> *
                        </span>
                      </label>
                      {errors.agreedToTerms && (
                        <p className="mt-1 text-sm text-red-600">{errors.agreedToTerms}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Summary Sidebar */}
              <div className="lg:col-span-1">
                <div className="bg-white border border-gray-200 rounded-lg p-6 sticky top-8">
                  <h3 className="text-lg font-semibold mb-6">Your Retreat Summary</h3>
                  
                  <div className="space-y-4 text-sm">
                    {/* Trip Type */}
                    <div>
                      <span className="text-gray-600 block text-xs tracking-wide mb-1 uppercase">Trip Type:</span>
                      <span className="text-gray-900 capitalize">
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
                        <span className="text-gray-600 block text-xs tracking-wide mb-1 uppercase">Transport:</span>
                        <span className="text-gray-900">{transportMethod.type}</span>
                        <div className="text-xs text-gray-500 mt-1">
                          {transportMethod.duration} • {transportMethod.pricePerPerson === 0 ? 'Free' : `€${transportMethod.pricePerPerson}/person`}
                        </div>
                      </div>
                    )}

                    {/* Guest Count */}
                    <div>
                      <span className="text-gray-600 block text-xs tracking-wide mb-1 uppercase">Guests:</span>
                      <span className="text-gray-900">
                        {adults} {adults === 1 ? 'Adult' : 'Adults'}
                        {children > 0 && `, ${children} ${children === 1 ? 'Child' : 'Children'}`}
                      </span>
                    </div>

                    {/* Dates */}
                    <div>
                      <span className="text-gray-600 block text-xs tracking-wide mb-1 uppercase">Dates:</span>
                      <span className="text-gray-900">
                        {checkIn && checkOut ? `${checkIn} - ${checkOut}` : 'Not selected'}
                      </span>
                    </div>

                    {/* Transport Cost */}
                    {transportMethod && (
                      <div className="border-t border-gray-200 pt-4">
                        <div className="flex justify-between">
                          <span className="text-gray-600 text-xs tracking-wide uppercase">Transport cost:</span>
                          <span className="text-drift-green font-medium">
                            {transportMethod.pricePerPerson === 0 ? 'Free' : `€${transportMethod.pricePerPerson * (adults + children)}`}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Romantic Setup */}
                    {tripType === 'romantic' && formData.romanticSetup && (
                      <div className="p-4 bg-drift-green/5 border border-drift-green/20 rounded">
                        <div className="flex items-center text-drift-green">
                          <span className="text-xs">Romantic setup requested</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center mt-8">
              <button
                onClick={handleStep3Back}
                className="text-drift-green hover:text-drift-light-green transition-colors"
              >
                ← Back
              </button>
              
              <button
                onClick={handleFinish}
                disabled={!isFormValid || submitting}
                className={`bg-drift-green text-white px-8 py-3 rounded-lg transition-colors ${
                  !isFormValid || submitting 
                    ? 'opacity-50 cursor-not-allowed' 
                    : 'hover:bg-drift-light-green'
                }`}
              >
                {submitting ? 'Processing...' : 'Finish & Continue to Booking'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CraftEmbedded;

