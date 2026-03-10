import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingContext } from '../../context/BookingContext';
import StickyBookingBar from '../../components/StickyBookingBar';

// Nature-inspired icons
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

const Step1TripType = () => {
  const navigate = useNavigate();
  const { tripType, customTripType, cabinId, currentStep, totalSteps, setTripType, setCustomTripType, setCurrentStep } = useBookingContext();
  
  const [showCustomInput, setShowCustomInput] = useState(tripType === 'Other');

  useEffect(() => {
    // Only set step if it's not already 1 to prevent infinite loops
    if (currentStep !== 1) {
      setCurrentStep(1);
    }
  }, []); // Empty dependency array - only run on mount

  const tripTypeLabels = useMemo(() => ({
    romantic: 'Romantic Getaway',
    family: 'Family Retreat',
    solo: 'Solo Reset',
    'digital-detox': 'Digital Detox',
    creative: 'Creative Escape',
    nature: 'Nature Exploration',
    adventure: 'Adventure Weekend',
    other: 'Other'
  }), []);

  const tripTypes = [
    {
      id: 'romantic',
      title: 'Romantic Getaway',
      description: 'Intimate moments in nature',
      icon: <HeartIcon />
    },
    {
      id: 'family',
      title: 'Family Retreat',
      description: 'Quality time with loved ones',
      icon: <FamilyIcon />
    },
    {
      id: 'solo',
      title: 'Solo Reset',
      description: 'Personal reflection and renewal',
      icon: <SoloIcon />
    },
    {
      id: 'digital-detox',
      title: 'Digital Detox',
      description: 'Unplug and reconnect with nature',
      icon: <DetoxIcon />
    },
    {
      id: 'creative',
      title: 'Creative Escape',
      description: 'Inspiration in natural surroundings',
      icon: <CreativeIcon />
    },
    {
      id: 'nature',
      title: 'Nature Exploration',
      description: 'Adventure and discovery',
      icon: <NatureIcon />
    },
    {
      id: 'adventure',
      title: 'Adventure Weekend',
      description: 'Thrills and outdoor activities',
      icon: <AdventureIcon />
    },
    {
      id: 'other',
      title: 'Other',
      description: 'Something unique to you',
      icon: <OtherIcon />
    }
  ];

  const handleTripTypeSelect = (tripTypeId) => {
    // Write to context immediately (not just local state)
    setTripType(tripTypeId);
    setShowCustomInput(tripTypeId === 'other');
    
    // DEV audit logging
    if (import.meta.env.DEV) {
      console.debug('[Craft Step 1] Trip type selected', { 
        tripTypeId, 
        contextTripType: tripTypeId,
        cabinId 
      });
    }
  };

  const handleCustomInputChange = (value) => {
    setCustomTripType(value);
  };

  const handleNext = () => {
    // DEV audit logging
    if (import.meta.env.DEV) {
      console.debug('[Craft Step 1] Next clicked', { 
        tripType, 
        customTripType, 
        cabinId,
        contextTripType: tripType,
        hasCraftTripType: !!tripType
      });
    }
    
    // Validate only per-step fields (tripType only, not cabinId)
    if (!tripType) {
      alert('Please select a trip type to continue.');
      return;
    }
    if (tripType === 'other' && !customTripType.trim()) {
      alert('Please describe your custom trip type.');
      return;
    }
    
    // Advance to Step 2 regardless of cabin selection
    setCurrentStep(2);
    navigate('/craft/step-2');
  };

  const handleBack = () => {
    // Always go back to home if at start of craft flow
    navigate('/');
  };

  const stepLabel = `Step ${currentStep || 1} of ${totalSteps || 4}`;
  const selectedTripLabel = tripType
    ? (tripType === 'other' && customTripType
        ? customTripType
        : (tripTypeLabels[tripType] || tripType))
    : 'Select an intention to continue';
  const canProceed = Boolean(tripType);

  return (
    <div className="min-h-screen bg-white pb-24 md:pb-32">
      {/* Mobile-Optimized Header Section */}
      <div className="block-editorial">
        <div className="max-w-4xl mx-auto px-4 md:px-6 text-center py-8 md:py-12">
          <h1 className="text-3xl md:text-5xl font-serif font-bold text-white mb-4 md:mb-8 tracking-tight md:tracking-editorial">
            What brings you here?
          </h1>
          <p className="text-base md:text-lg font-sans font-light text-gray-300 max-w-2xl mx-auto leading-relaxed px-2">
            Every journey has a reason. Let us help you shape it.
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
            <div className="w-10 h-10 md:w-8 md:h-8 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-gray-500 text-base md:text-sm font-medium md:font-light">2</span>
            </div>
            <div className="h-px flex-1 max-w-12 md:max-w-20 bg-gray-300"></div>
            <div className="w-10 h-10 md:w-8 md:h-8 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-gray-500 text-base md:text-sm font-medium md:font-light">3</span>
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

        {/* Trip Type Cards - Mobile Optimized */}
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-12 mb-12 md:mb-20">
          {tripTypes.map((trip) => (
            <button
              key={trip.id}
              onClick={() => handleTripTypeSelect(trip.id)}
              className={`
                group relative p-4 md:p-8 rounded-2xl md:rounded-3xl transition-all duration-300 min-h-[140px] md:min-h-0
                active:scale-[0.98] touch-manipulation
                ${tripType === trip.id 
                  ? 'border-2 border-stone-900 bg-stone-50 shadow-lg md:shadow-xl'
                  : 'border border-gray-200 bg-white active:border-stone-900/40'
                }
              `}
            >
              {/* Selection indicator - Mobile optimized */}
              {tripType === trip.id && (
                <div className="absolute top-3 right-3 md:top-6 md:right-6 w-6 h-6 md:w-7 md:h-7 bg-stone-900 text-white rounded-full flex items-center justify-center shadow-sm">
                  <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              
              <div className="text-center">
                <div className={`flex justify-center mb-3 md:mb-6 transition-colors ${tripType === trip.id ? 'text-stone-900' : 'text-sage'}`}>
                  <div className="w-8 h-8 md:w-8 md:h-8">
                    {trip.icon}
                  </div>
                </div>
                <h3 className="text-xs md:text-base font-sans font-medium md:font-medium uppercase tracking-wide mb-1 md:mb-3 text-gray-900 leading-tight">
                  {trip.title}
                </h3>
                <p className="text-[10px] md:text-sm text-gray-600 leading-snug md:leading-relaxed">
                  {trip.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Custom Input for "Other" - Mobile Optimized */}
        {showCustomInput && (
          <div className="mb-12 md:mb-20">
            <div className="max-w-2xl mx-auto">
              <label className="block text-xs font-sans font-light text-gray-600 mb-3 tracking-wide uppercase text-center md:text-left">
                Tell us about your unique experience
              </label>
              <textarea
                value={customTripType}
                onChange={(e) => handleCustomInputChange(e.target.value)}
                placeholder="Describe what brings you to our eco-retreat..."
                className="w-full px-0 py-3 md:py-4 border-0 border-b border-gray-300 focus:border-black outline-none transition-all duration-200 bg-transparent font-light text-base md:text-lg leading-relaxed resize-none"
                rows={4}
              />
            </div>
          </div>
        )}

        {/* Desktop Navigation */}
        <div className="hidden md:flex justify-between items-center max-w-2xl mx-auto">
          <button
            onClick={handleBack}
            className="btn-underline"
          >
            ← back
          </button>
          
          <button
            onClick={handleNext}
            className={`btn-pill ${!canProceed ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={!canProceed}
          >
            next step →
          </button>
        </div>
      </div>

      <StickyBookingBar
        className="md:hidden"
        label={stepLabel}
        subLabel={selectedTripLabel}
        buttonLabel="Next step →"
        buttonDisabled={!canProceed}
        onButtonClick={handleNext}
      />
    </div>
  );
};

export default Step1TripType;
