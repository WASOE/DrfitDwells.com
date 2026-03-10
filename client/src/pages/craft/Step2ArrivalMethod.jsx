import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingContext } from '../../context/BookingContext';
import { cabinAPI } from '../../services/api';
import StickyBookingBar from '../../components/StickyBookingBar';

const Step2ArrivalMethod = () => {
  const navigate = useNavigate();
  const { 
    cabinId, 
    adults, 
    children, 
    transportMethod, 
    currentStep,
    totalSteps,
    setTransportMethod, 
    setCurrentStep 
  } = useBookingContext();
  
  const [cabin, setCabin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setCurrentStep(2);
  }, [setCurrentStep]);

  // Get transport icons
  const getTransportIcon = (type) => {
    const icons = {
      'Horse': (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      ),
      'ATV': (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m6 4.5v-3a3 3 0 00-3-3H6.75a3 3 0 00-3 3v3m0 0V9.75a3 3 0 013-3h2.25a3 3 0 013 3v9.75m-6 0h6" />
        </svg>
      ),
      'Jeep': (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m6 4.5v-3a3 3 0 00-3-3H6.75a3 3 0 00-3 3v3m0 0V9.75a3 3 0 013-3h2.25a3 3 0 013 3v9.75m-6 0h6" />
        </svg>
      ),
      'Hike': (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.414 48.414 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L18.75 4.97zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L5.25 4.97z" />
        </svg>
      ),
      'Boat': (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m6 4.5v-3a3 3 0 00-3-3H6.75a3 3 0 00-3 3v3m0 0V9.75a3 3 0 013-3h2.25a3 3 0 013 3v9.75m-6 0h6" />
        </svg>
      ),
      'Helicopter': (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      )
    };
    return icons[type] || (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m6 4.5v-3a3 3 0 00-3-3H6.75a3 3 0 00-3 3v3m0 0V9.75a3 3 0 013-3h2.25a3 3 0 013 3v9.75m-6 0h6" />
      </svg>
    );
  };

  // Get transport color scheme
  const getTransportColors = (type) => {
    const colors = {
      'Horse': { bg: 'from-amber-50 to-orange-50', border: 'border-amber-200', hover: 'hover:border-amber-300' },
      'ATV': { bg: 'from-red-50 to-pink-50', border: 'border-red-200', hover: 'hover:border-red-300' },
      'Jeep': { bg: 'from-blue-50 to-indigo-50', border: 'border-blue-200', hover: 'hover:border-blue-300' },
      'Hike': { bg: 'from-green-50 to-emerald-50', border: 'border-green-200', hover: 'hover:border-green-300' },
      'Boat': { bg: 'from-cyan-50 to-teal-50', border: 'border-cyan-200', hover: 'hover:border-cyan-300' },
      'Helicopter': { bg: 'from-purple-50 to-violet-50', border: 'border-purple-200', hover: 'hover:border-purple-300' }
    };
    return colors[type] || { bg: 'from-gray-50 to-slate-50', border: 'border-gray-200', hover: 'hover:border-gray-300' };
  };

  // Load cabin data with transport options (optional - can proceed without cabin)
  useEffect(() => {
    const loadCabin = async () => {
      if (!cabinId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await cabinAPI.getById(cabinId);
        
        if (response.data.success) {
          setCabin(response.data.data.cabin);
        } else {
          setError(null); // Don't error if cabin not found - allow proceeding
        }
      } catch (err) {
        console.error('Load cabin error:', err);
        setError(null); // Don't error - allow proceeding without cabin
      } finally {
        setLoading(false);
      }
    };

    loadCabin();
  }, [cabinId]);

  const handleTransportSelect = (transport) => {
    setTransportMethod(transport);
  };

  const handleNext = () => {
    // DEV audit logging
    if (import.meta.env.DEV) {
      console.debug('[Craft Step 2] Next clicked', { 
        transportMethod, 
        cabinId,
        cabin: cabin?.name,
        hasTransportMethod: !!transportMethod
      });
    }
    
    // Transport selection is always optional - we want to gather preferences
    // Even if they don't select, we can proceed (data gathering goal)
    // If cabin is selected and they want to proceed, we encourage selection but don't block
    if (cabinId && !transportMethod) {
      const proceed = window.confirm('No transport method selected. You can select one later or proceed without. Continue?');
      if (!proceed) {
        return;
      }
    }
    
    // Advance to Step 3 regardless of cabin/transport selection
    setCurrentStep(3);
    navigate('/craft/step-3');
  };

  const handleBack = () => {
    navigate('/craft/step-1');
  };

  // Calculate total transport cost
  const totalGuests = adults + children;
  const totalTransportCost = transportMethod ? transportMethod.pricePerPerson * totalGuests : 0;

  // If no cabin selected, show option to skip or select transport manually
  const availableTransports = cabin?.transportOptions?.filter(transport => transport.isAvailable) || [];
  
  if (loading && cabinId) {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-6 py-20">
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-sage"></div>
            <p className="mt-6 text-body text-gray-600">Loading transport options...</p>
          </div>
        </div>
      </div>
    );
  }
  
  // All possible transport options - shown when no cabin selected to gather user desires
  // When cabin is selected later, we'll filter based on what's actually available
  const allPossibleTransports = [
    { 
      type: 'Horse', 
      description: 'Traditional horse ride through scenic trails', 
      duration: '45-60 minutes', 
      pricePerPerson: 50, 
      isAvailable: true 
    },
    { 
      type: 'ATV', 
      description: 'Adventure ride on all-terrain vehicle', 
      duration: '30-45 minutes', 
      pricePerPerson: 100, 
      isAvailable: true 
    },
    { 
      type: 'Jeep', 
      description: 'Comfortable 4x4 transport to the retreat', 
      duration: '25-35 minutes', 
      pricePerPerson: 50, 
      isAvailable: true 
    },
    { 
      type: 'Hike', 
      description: 'Scenic hiking trail through nature', 
      duration: '1.5-2 hours', 
      pricePerPerson: 0, 
      isAvailable: true 
    },
    { 
      type: 'Boat', 
      description: 'Scenic boat ride to lakeside cabins', 
      duration: '20-30 minutes', 
      pricePerPerson: 40, 
      isAvailable: true 
    },
    { 
      type: 'Helicopter', 
      description: 'Luxury aerial transport with stunning views', 
      duration: '15-20 minutes', 
      pricePerPerson: 300, 
      isAvailable: true 
    }
  ];
  
  // If cabin is selected, show only available transports for that cabin
  // If no cabin selected, show all options to gather user preferences
  const transportsToShow = cabinId && availableTransports.length > 0 
    ? availableTransports 
    : allPossibleTransports;

  const stepLabel = `Step ${currentStep || 2} of ${totalSteps || 4}`;
  const transportSummary = transportMethod
    ? `${transportMethod.type} • €${totalTransportCost.toLocaleString()}`
    : 'Select arrival method';
  const transportSubLabel = transportMethod?.type || 'Optional - tell us your preference';
  const canProceed = true; // Always allow proceeding - data gathering is the goal

  return (
    <div className="min-h-screen bg-white pb-24 md:pb-32">
      {/* Mobile-Optimized Header Section */}
      <div className="block-editorial">
        <div className="max-w-4xl mx-auto px-4 md:px-6 text-center py-8 md:py-12">
          <h1 className="text-3xl md:text-5xl font-serif font-bold text-white mb-4 md:mb-8 tracking-tight md:tracking-editorial">
            How will you arrive?
          </h1>
          <p className="text-base md:text-lg font-sans font-light text-gray-300 max-w-2xl mx-auto leading-relaxed px-2">
            {cabin 
              ? `Choose your preferred way to reach ${cabin.name}`
              : 'Tell us how you\'d like to arrive. We\'ll match you with cabins that offer your preferred method.'}
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

        {/* Info Banner - shown when no cabin selected - Mobile Optimized */}
        {!cabinId && (
          <div className="mb-6 md:mb-12 p-4 md:p-6 bg-sage/5 border border-sage/20 rounded-lg">
            <p className="text-sm md:text-base font-sans font-light text-gray-700 leading-relaxed">
              <span className="font-semibold">Exploring your options?</span> Select your preferred arrival method below. When you choose your cabin, we'll confirm availability and adjust pricing if needed.
            </p>
          </div>
        )}

        {/* Transport Options - Mobile Optimized */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-12 mb-12 md:mb-20">
          {transportsToShow.map((transport, index) => {
            const isSelected = transportMethod?.type === transport.type;
            
            return (
              <button
                key={index}
                onClick={() => handleTransportSelect(transport)}
                className={`
                  group relative p-5 md:p-8 border transition-all duration-300 bg-white active:bg-gray-50
                  active:scale-[0.98] touch-manipulation min-h-[160px] md:min-h-0
                  ${isSelected 
                    ? 'border-sage border-b-4 md:border-b-4' 
                    : 'border-gray-200 active:border-sage'
                  }
                `}
              >
                {/* Selection indicator - Mobile Optimized */}
                {isSelected && (
                  <div className="absolute top-3 right-3 md:top-6 md:right-6 w-6 h-6 bg-sage rounded-full flex items-center justify-center shadow-sm">
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
                
                <div className="text-center">
                  <div className="flex justify-center mb-4 md:mb-8 text-sage transition-colors">
                    <div className="w-8 h-8 md:w-8 md:h-8">
                      {getTransportIcon(transport.type)}
                    </div>
                  </div>
                  <h3 className="text-xl md:text-2xl font-serif font-bold mb-2 md:mb-4 tracking-editorial">
                    {transport.type}
                  </h3>
                  <p className="text-sm md:text-base font-sans font-light text-gray-600 mb-4 md:mb-8 leading-relaxed md:leading-loose">
                    {transport.description}
                  </p>
                  <div className="flex justify-between items-center text-sm md:text-base font-sans font-light">
                    <span className="text-gray-600 flex items-center">
                      <svg className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {transport.duration}
                    </span>
                    <span className="text-sage font-medium">
                      {transport.pricePerPerson === 0 ? 'Free' : `€${transport.pricePerPerson}/person`}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Cost Summary - Mobile Optimized */}
        {transportMethod && (
          <div className="card-editorial p-5 md:p-8 mb-12 md:mb-20">
            <h3 className="text-xl md:text-2xl font-serif font-bold mb-4 md:mb-8 tracking-editorial">Transport Cost Summary</h3>
            <div className="space-y-4 md:space-y-6 text-sm md:text-base font-sans font-light">
              <div className="flex justify-between">
                <span className="text-gray-600 font-light">Selected method:</span>
                <span className="font-light text-black">{transportMethod.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 font-light">Price per person:</span>
                <span className="font-light text-black">
                  {transportMethod.pricePerPerson === 0 ? 'Free' : `€${transportMethod.pricePerPerson}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 font-light">Number of guests:</span>
                <span className="font-light text-black">{totalGuests}</span>
              </div>
              <div className="border-t border-gray-300 pt-6">
                <div className="flex justify-between">
                  <span className="font-light text-black">Estimated transport cost:</span>
                  <span className="font-light text-sage">
                    {totalTransportCost === 0 ? 'Free' : `€${totalTransportCost}`}
                  </span>
                </div>
              </div>
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
        label={transportSummary}
        subLabel={`${stepLabel}${transportSubLabel ? ` • ${transportSubLabel}` : ''}`}
        buttonLabel="Next step →"
        buttonDisabled={!canProceed}
        onButtonClick={handleNext}
      />
    </div>
  );
};

export default Step2ArrivalMethod;
