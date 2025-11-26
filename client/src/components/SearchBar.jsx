import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const SearchBar = ({ initialData = {}, buttonTheme = 'default', variant = 'default' }) => {
  const navigate = useNavigate();
  const isGlass = variant === 'glass';
  
  // Helper function to safely convert string to Date
  const parseDate = (dateString) => {
    if (!dateString) return null;
    if (dateString instanceof Date) return dateString;
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
  };
  
  // Form state
  const [formData, setFormData] = useState({
    checkIn: parseDate(initialData.checkIn),
    checkOut: parseDate(initialData.checkOut),
    adults: initialData.adults || 2,
    children: initialData.children || 0
  });

  const [errors, setErrors] = useState({});

  // Handle input changes
  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};

    if (!formData.checkIn) {
      newErrors.checkIn = 'Check-in date is required';
    } else if (formData.checkIn < new Date()) {
      newErrors.checkIn = 'Check-in date cannot be in the past';
    }

    if (!formData.checkOut) {
      newErrors.checkOut = 'Check-out date is required';
    } else if (formData.checkOut <= formData.checkIn) {
      newErrors.checkOut = 'Check-out date must be after check-in date';
    }

    if (formData.adults < 1) {
      newErrors.adults = 'At least 1 adult is required';
    }

    if (formData.children < 0) {
      newErrors.children = 'Children count cannot be negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    // Navigate to search results with query parameters
    const searchParams = new URLSearchParams({
      checkIn: formData.checkIn?.toISOString().split('T')[0] || '',
      checkOut: formData.checkOut?.toISOString().split('T')[0] || '',
      adults: formData.adults.toString(),
      children: formData.children.toString()
    });

    navigate(`/search?${searchParams.toString()}`);
  };

  const baseInputClass = isGlass
    ? 'w-full h-12 sm:h-14 bg-transparent text-base sm:text-sm md:text-base text-white placeholder:text-white/70 border-b border-white/30 focus:border-white focus:outline-none transition-colors duration-150'
    : 'w-full h-12 sm:h-14 bg-transparent text-base sm:text-sm placeholder:text-gray-500 text-gray-900 border-b border-gray-300 focus:border-b focus:border-[#81887A] focus:outline-none transition-colors duration-150';

  const selectClass = `${baseInputClass} appearance-none pr-8 ${isGlass ? 'text-white' : ''}`;
  const dividerClass = isGlass ? 'hidden md:block w-px h-8 bg-white/25' : 'hidden md:block w-px h-8 bg-gray-300';
  const errorTextClass = isGlass ? 'text-white text-xs mt-1' : 'text-red-500 text-xs mt-1';

  return (
    <form onSubmit={handleSubmit}>
      <div className={`flex flex-col md:flex-row gap-3 sm:gap-4 md:gap-7 items-stretch md:items-end ${isGlass ? 'text-white' : ''}`}>
        {/* Check-in Date */}
        <div className="w-full md:w-[232px]">
          <label htmlFor="checkIn" className="sr-only">Check-in date</label>
          <DatePicker
            id="checkIn"
            selected={formData.checkIn}
            onChange={(date) => handleInputChange('checkIn', date)}
            selectsStart
            startDate={formData.checkIn}
            endDate={formData.checkOut}
            minDate={new Date()}
            placeholderText="Select date"
            className={`${baseInputClass} ${errors.checkIn ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
            dateFormat="MM/dd/yyyy"
          />
          {errors.checkIn && (
            <p className={errorTextClass}>{errors.checkIn}</p>
          )}
        </div>

        {/* Hairline Divider */}
        <div className={dividerClass}></div>

        {/* Check-out Date */}
        <div className="w-full md:w-[232px]">
          <label htmlFor="checkOut" className="sr-only">Check-out date</label>
          <DatePicker
            id="checkOut"
            selected={formData.checkOut}
            onChange={(date) => handleInputChange('checkOut', date)}
            selectsEnd
            startDate={formData.checkIn}
            endDate={formData.checkOut}
            minDate={formData.checkIn || new Date()}
            placeholderText="Select date"
            className={`${baseInputClass} ${errors.checkOut ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
            dateFormat="MM/dd/yyyy"
          />
          {errors.checkOut && (
            <p className={errorTextClass}>{errors.checkOut}</p>
          )}
        </div>

        {/* Hairline Divider */}
        <div className={dividerClass}></div>

        {/* Adults */}
        <div className="w-full md:w-[172px]">
          <label htmlFor="adults" className="sr-only">Number of adults</label>
          <div className="relative">
            <select
              id="adults"
              value={formData.adults}
              onChange={(e) => handleInputChange('adults', parseInt(e.target.value))}
            className={`${selectClass} ${errors.adults ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                <option key={num} value={num}>{num} {num === 1 ? 'Adult' : 'Adults'}</option>
              ))}
            </select>
            <svg
              className={`pointer-events-none absolute right-1 top-1/2 -translate-y-[46%] h-4 w-4 ${isGlass ? 'text-white/80' : 'text-gray-600'}`}
              viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6 8l4 4 4-4" />
            </svg>
          </div>
          {errors.adults && (
            <p className={errorTextClass}>{errors.adults}</p>
          )}
        </div>

        {/* Hairline Divider */}
        <div className={dividerClass}></div>

        {/* Children */}
        <div className="w-full md:w-[172px]">
          <label htmlFor="children" className="sr-only">Number of children</label>
          <div className="relative">
            <select
              id="children"
              value={formData.children}
              onChange={(e) => handleInputChange('children', parseInt(e.target.value))}
            className={`${selectClass} ${errors.children ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                <option key={num} value={num}>{num} {num === 1 ? 'Child' : 'Children'}</option>
              ))}
            </select>
            <svg
              className={`pointer-events-none absolute right-1 top-1/2 -translate-y-[46%] h-4 w-4 ${isGlass ? 'text-white/80' : 'text-gray-600'}`}
              viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6 8l4 4 4-4" />
            </svg>
          </div>
          {errors.children && (
            <p className={errorTextClass}>{errors.children}</p>
          )}
        </div>

        {/* Search Button */}
        <div className="w-full md:w-auto">
          <button
            type="submit"
            className={`w-full md:w-auto min-w-[176px] h-12 sm:h-14 px-6 rounded-lg text-base sm:text-sm font-medium focus:outline-none focus:ring-2 active:scale-95 transition-all duration-150 inline-flex items-center justify-center whitespace-nowrap touch-manipulation ${
              buttonTheme === 'hero'
                ? 'bg-black text-white hover:bg-black/90 focus:ring-black/40'
                : 'bg-[#81887A] text-white hover:bg-[#6F766B] focus:ring-[#81887A]/30'
            }`}
          >
            Search cabins →
          </button>
        </div>
      </div>
    </form>
  );
};

export default SearchBar;
