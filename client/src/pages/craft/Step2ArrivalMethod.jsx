import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingContext } from '../../context/BookingContext';
import { cabinAPI } from '../../services/api';

const Step2ArrivalMethod = () => {
  const navigate = useNavigate();
  const { 
    cabinId, 
    adults, 
    children, 
    transportMethod, 
    setTransportMethod, 
    setCurrentStep 
  } = useBookingContext();
  
  const [cabin, setCabin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    
    // Transport is optional if no cabin selected - allow skipping
    // If cabin is selected, transport should be chosen
    if (cabinId && !transportMethod) {
      alert('Please select a transport method to continue.');
      return;
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
  
  // Generic transport options if no cabin selected
  const genericTransports = [
    { type: 'Car', description: 'Self-drive to the retreat', duration: 'Varies', pricePerPerson: 0, isAvailable: true },
    { type: 'Shuttle', description: 'Complimentary shuttle service', duration: 'Varies', pricePerPerson: 0, isAvailable: true },
    { type: 'Taxi', description: 'Private taxi service', duration: 'Varies', pricePerPerson: 50, isAvailable: true }
  ];
  
  const transportsToShow = cabinId && availableTransports.length > 0 ? availableTransports : genericTransports;

  return (
    <div className="min-h-screen bg-white">
      {/* Editorial Header Section */}
      <div className="block-editorial">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h1 className="headline-editorial mb-8 text-white">
            How will you arrive?
          </h1>
          <p className="text-editorial text-gray-300 max-w-2xl mx-auto">
            {cabin ? `Choose your preferred way to reach ${cabin.name}` : 'Choose your preferred arrival method'}
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
            <div className="h-px w-20 bg-gray-300"></div>
            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-gray-500 text-sm font-light">3</span>
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

        {/* Transport Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-20">
          {transportsToShow.map((transport, index) => {
            const isSelected = transportMethod?.type === transport.type;
            
            return (
              <button
                key={index}
                onClick={() => handleTransportSelect(transport)}
                className={`
                  group relative p-8 border transition-all duration-300 bg-white hover:bg-gray-50
                  ${isSelected 
                    ? 'border-sage border-b-4' 
                    : 'border-gray-200 hover:border-sage'
                  }
                `}
              >
                {/* Selection indicator */}
                {isSelected && (
                  <div className="absolute top-6 right-6 w-6 h-6 bg-sage rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
                
                <div className="text-center">
                  <div className="flex justify-center mb-8 text-sage group-hover:text-sage-dark transition-colors">
                    {getTransportIcon(transport.type)}
                  </div>
                  <h3 className="headline-subsection mb-4">
                    {transport.type}
                  </h3>
                  <p className="text-body text-gray-600 mb-8 leading-loose">
                    {transport.description}
                  </p>
                  <div className="flex justify-between items-center text-body">
                    <span className="text-gray-600 flex items-center font-light">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {transport.duration}
                    </span>
                    <span className="font-light text-sage">
                      {transport.pricePerPerson === 0 ? 'Free' : `€${transport.pricePerPerson}/person`}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Cost Summary */}
        {transportMethod && (
          <div className="card-editorial p-8 mb-20">
            <h3 className="headline-subsection mb-8">Transport Cost Summary</h3>
            <div className="space-y-6 text-body">
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

        {/* Navigation */}
        <div className="flex justify-between items-center max-w-2xl mx-auto">
          <button
            onClick={handleBack}
            className="btn-underline"
          >
            ← back
          </button>
          
          <button
            onClick={handleNext}
            className="btn-pill"
          >
            next step →
          </button>
        </div>
      </div>
    </div>
  );
};

export default Step2ArrivalMethod;
