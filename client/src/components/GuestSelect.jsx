import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../context/BookingSearchContext';

const GuestSelect = ({ label, isGlass = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef(null);
  const popupRef = useRef(null);

  const {
    adults,
    children,
    babies = 0,
    pets = 0,
    updateGuests
  } = useBookingSearch();

  const { t } = useTranslation('booking');

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const popupHeight = 280; // Approximate height of the popup
        
        // Check if popup would go below viewport
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        
        let top;
        if (spaceBelow < popupHeight && spaceAbove > spaceBelow) {
          // Position above the button
          top = rect.top - popupHeight - 8;
        } else {
          // Position below the button
          top = rect.bottom + 8;
        }
        
        setPosition({
          top: Math.max(8, top), // Ensure it doesn't go above viewport
          left: rect.left,
          width: Math.max(rect.width, 320)
        });
      }
    };

    const handleClickOutside = (event) => {
      if (
        buttonRef.current && 
        !buttonRef.current.contains(event.target) &&
        popupRef.current &&
        !popupRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    // Calculate position immediately
    updatePosition();
    
    // Also calculate on next frame to ensure layout is complete
    requestAnimationFrame(updatePosition);

    const handleScroll = () => {
      setIsOpen(false);
    };

    const handleResize = () => {
      updatePosition();
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  const adjustCount = (field, delta) => {
    const current = field === 'adults' ? adults : field === 'children' ? children : field === 'babies' ? babies : pets;
    const newValue = Math.max(0, current + delta);
    
    if (field === 'adults' && newValue === 0 && adults === 1) {
      return; // Prevent going below 1 for adults
    }

    updateGuests({ [field]: newValue });
  };

  const totalGuests = adults + children + babies;

  const fieldLabelClass = isGlass
    ? 'text-[9px] uppercase tracking-[0.3em] font-serif text-white/70 mb-1.5'
    : 'text-[9px] uppercase tracking-[0.3em] font-serif text-gray-500 mb-1.5';

  const fieldInputClass = isGlass
    ? 'w-full min-h-12 lg:min-h-14 h-12 lg:h-14 bg-transparent text-sm lg:text-base font-serif text-white border-b border-white/40 hover:border-white focus:border-white focus:outline-none transition-colors duration-150 pb-1 cursor-pointer flex items-center justify-between leading-none'
    : 'w-full min-h-12 lg:min-h-14 h-12 lg:h-14 bg-transparent text-sm lg:text-base font-serif text-gray-900 border-b border-gray-300 hover:border-gray-400 focus:border-gray-900 focus:outline-none transition-colors duration-150 pb-1 cursor-pointer flex items-center justify-between leading-none';

  const guestRows = [
    {
      field: 'adults',
      label: t('guests.adults.label'),
      description: t('guests.adults.description'),
      value: adults,
      min: 1
    },
    {
      field: 'children',
      label: t('guests.children.label'),
      description: t('guests.children.description'),
      value: children,
      min: 0
    },
    {
      field: 'babies',
      label: t('guests.babies.label'),
      description: t('guests.babies.description'),
      value: babies,
      min: 0
    },
    {
      field: 'pets',
      label: t('guests.pets.label'),
      description: t('guests.pets.description'),
      value: pets,
      min: 0,
      hasLink: true
    }
  ];

  const popupContent = isOpen && position.width > 0 ? (
    <div
      ref={popupRef}
      className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden py-4"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: `${position.width}px`,
        minWidth: '320px',
        zIndex: 10001
      }}
    >
      {guestRows.map((row, index) => (
        <div
          key={row.field}
          className={`flex items-center justify-between px-6 ${index < guestRows.length - 1 ? 'pb-6 mb-6 border-b border-gray-200' : ''}`}
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-900 mb-0.5">{row.label}</span>
            {row.hasLink ? (
              <button
                type="button"
                className="text-xs text-gray-600 underline hover:text-gray-900 text-left"
                onClick={(e) => {
                  e.stopPropagation();
                  // Handle service animal link
                }}
              >
                {row.description}
              </button>
            ) : (
              <span className="text-xs text-gray-500">{row.description}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => adjustCount(row.field, -1)}
              disabled={row.value <= row.min}
              className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center text-base font-medium text-gray-900">{row.value}</span>
            <button
              type="button"
              onClick={() => adjustCount(row.field, 1)}
              className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-gray-400 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  const displayText = totalGuests === 0 
    ? t('guests.addGuests')
    : `${t('guestSummary', { count: totalGuests })}${pets > 0 ? `, ${t('petsSummary', { count: pets })}` : ''}`;

  return (
    <>
      <div className="relative">
        <label className={fieldLabelClass}>
          {label}
        </label>
        <button
          type="button"
          ref={buttonRef}
          onClick={() => setIsOpen(!isOpen)}
          className={fieldInputClass}
        >
          <span className={`inline-flex items-center min-h-[3rem] lg:min-h-[3.5rem] ${isGlass ? 'text-white' : 'text-gray-900'} ${totalGuests === 0 ? 'opacity-60' : ''}`}>{displayText}</span>
          <ChevronDown 
            className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${isGlass ? 'text-white' : 'text-gray-600'}`}
          />
        </button>
      </div>
      {isOpen && typeof document !== 'undefined' && createPortal(popupContent, document.body)}
    </>
  );
};

export default GuestSelect;
