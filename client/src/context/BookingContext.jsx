import React, { createContext, useContext, useReducer } from 'react';

// Initial state
const initialState = {
  // Basic booking info
  cabinId: null,
  checkIn: null,
  checkOut: null,
  adults: 2,
  children: 0,
  
  // Guest information
  guestInfo: {
    fullName: '',
    email: '',
    phone: '',
    specialRequests: '',
    agreedToTerms: false,
    romanticSetup: false
  },
  
  // Wizard steps (legacy fields for backward compatibility)
  tripType: '',
  customTripType: '',
  transportMethod: null,
  preferences: {},
  specialRequests: '',
  
  // Future-proof craft object
  craft: {
    version: 1,
    tripType: '',
    transportMethod: null,
    extras: {
      romanticSetup: false,
      customTripType: '',
      specialRequests: ''
    }
  },
  
  // Current step
  currentStep: 1,
  totalSteps: 4
};

// Action types
const ActionTypes = {
  SET_BASIC_INFO: 'SET_BASIC_INFO',
  SET_GUEST_INFO: 'SET_GUEST_INFO',
  UPDATE_GUEST_INFO: 'UPDATE_GUEST_INFO',
  SET_TRIP_TYPE: 'SET_TRIP_TYPE',
  SET_CUSTOM_TRIP_TYPE: 'SET_CUSTOM_TRIP_TYPE',
  SET_TRANSPORT_METHOD: 'SET_TRANSPORT_METHOD',
  SET_PREFERENCES: 'SET_PREFERENCES',
  SET_SPECIAL_REQUESTS: 'SET_SPECIAL_REQUESTS',
  SET_CURRENT_STEP: 'SET_CURRENT_STEP',
  RESET_BOOKING: 'RESET_BOOKING',
  // Craft object actions
  SET_CRAFT_TRIP_TYPE: 'SET_CRAFT_TRIP_TYPE',
  SET_CRAFT_TRANSPORT_METHOD: 'SET_CRAFT_TRANSPORT_METHOD',
  UPDATE_CRAFT_EXTRAS: 'UPDATE_CRAFT_EXTRAS'
};

// Reducer
const bookingReducer = (state, action) => {
  switch (action.type) {
    case ActionTypes.SET_BASIC_INFO:
      return {
        ...state,
        cabinId: action.payload.cabinId,
        checkIn: action.payload.checkIn,
        checkOut: action.payload.checkOut,
        adults: action.payload.adults,
        children: action.payload.children
      };
    
    case ActionTypes.SET_GUEST_INFO:
      return {
        ...state,
        guestInfo: { ...state.guestInfo, ...action.payload }
      };
    
    case ActionTypes.UPDATE_GUEST_INFO:
      return {
        ...state,
        guestInfo: { ...state.guestInfo, ...action.payload }
      };
    
    case ActionTypes.SET_TRIP_TYPE:
      return {
        ...state,
        tripType: action.payload,
        customTripType: action.payload === 'Other' ? state.customTripType : '',
        // Also update craft object
        craft: {
          ...state.craft,
          tripType: action.payload
        }
      };
    
    case ActionTypes.SET_CUSTOM_TRIP_TYPE:
      return {
        ...state,
        customTripType: action.payload,
        // Also update craft object
        craft: {
          ...state.craft,
          extras: {
            ...state.craft.extras,
            customTripType: action.payload
          }
        }
      };
    
    case ActionTypes.SET_TRANSPORT_METHOD:
      return {
        ...state,
        transportMethod: action.payload,
        // Also update craft object
        craft: {
          ...state.craft,
          transportMethod: action.payload
        }
      };
    
    case ActionTypes.SET_PREFERENCES:
      return {
        ...state,
        preferences: { ...state.preferences, ...action.payload }
      };
    
    case ActionTypes.SET_SPECIAL_REQUESTS:
      return {
        ...state,
        specialRequests: action.payload
      };
    
    case ActionTypes.SET_CURRENT_STEP:
      return {
        ...state,
        currentStep: action.payload
      };
    
    case ActionTypes.SET_CRAFT_TRIP_TYPE:
      return {
        ...state,
        craft: {
          ...state.craft,
          tripType: action.payload
        }
      };
    
    case ActionTypes.SET_CRAFT_TRANSPORT_METHOD:
      return {
        ...state,
        craft: {
          ...state.craft,
          transportMethod: action.payload
        }
      };
    
    case ActionTypes.UPDATE_CRAFT_EXTRAS:
      return {
        ...state,
        craft: {
          ...state.craft,
          extras: {
            ...state.craft.extras,
            ...action.payload
          }
        }
      };
    
    case ActionTypes.RESET_BOOKING:
      return initialState;
    
    default:
      return state;
  }
};

// Create context
const BookingContext = createContext();

// Provider component
export const BookingProvider = ({ children }) => {
  const [state, dispatch] = useReducer(bookingReducer, initialState);

  // Action creators
  const actions = {
    setBasicInfo: (basicInfo) => {
      dispatch({ type: ActionTypes.SET_BASIC_INFO, payload: basicInfo });
    },
    
    setGuestInfo: (guestInfo) => {
      dispatch({ type: ActionTypes.SET_GUEST_INFO, payload: guestInfo });
    },
    
    updateGuestInfo: (guestInfo) => {
      dispatch({ type: ActionTypes.UPDATE_GUEST_INFO, payload: guestInfo });
    },
    
    setTripType: (tripType) => {
      dispatch({ type: ActionTypes.SET_TRIP_TYPE, payload: tripType });
    },
    
    setCustomTripType: (customTripType) => {
      dispatch({ type: ActionTypes.SET_CUSTOM_TRIP_TYPE, payload: customTripType });
    },
    
    setTransportMethod: (transportMethod) => {
      dispatch({ type: ActionTypes.SET_TRANSPORT_METHOD, payload: transportMethod });
    },
    
    setPreferences: (preferences) => {
      dispatch({ type: ActionTypes.SET_PREFERENCES, payload: preferences });
    },
    
    setSpecialRequests: (specialRequests) => {
      dispatch({ type: ActionTypes.SET_SPECIAL_REQUESTS, payload: specialRequests });
    },
    
    setCurrentStep: (step) => {
      dispatch({ type: ActionTypes.SET_CURRENT_STEP, payload: step });
    },
    
    resetBooking: () => {
      dispatch({ type: ActionTypes.RESET_BOOKING });
    },
    
    // Craft object actions
    setCraftTripType: (tripType) => {
      dispatch({ type: ActionTypes.SET_CRAFT_TRIP_TYPE, payload: tripType });
    },
    
    setCraftTransportMethod: (transportMethod) => {
      dispatch({ type: ActionTypes.SET_CRAFT_TRANSPORT_METHOD, payload: transportMethod });
    },
    
    updateCraftExtras: (extras) => {
      dispatch({ type: ActionTypes.UPDATE_CRAFT_EXTRAS, payload: extras });
    }
  };

  const value = {
    ...state,
    ...actions
  };

  return (
    <BookingContext.Provider value={value}>
      {children}
    </BookingContext.Provider>
  );
};

// Custom hook to use the booking context
export const useBookingContext = () => {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error('useBookingContext must be used within a BookingProvider');
  }
  return context;
};

export default BookingContext;
