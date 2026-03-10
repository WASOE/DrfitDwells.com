import { useState, useEffect } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/**
 * Airbnb-style "Change guests" modal with adults, children, infants, pets.
 */
const ChangeGuestsModal = ({
  isOpen,
  onClose,
  adults,
  children,
  babies = 0,
  pets = 0,
  maxGuests = 4,
  allowPets = false,
  onSave
}) => {
  const { t } = useTranslation('booking');
  const [localAdults, setLocalAdults] = useState(adults);
  const [localChildren, setLocalChildren] = useState(children);
  const [localBabies, setLocalBabies] = useState(babies);
  const [localPets, setLocalPets] = useState(pets);

  useEffect(() => {
    if (isOpen) {
      setLocalAdults(adults);
      setLocalChildren(children);
      setLocalBabies(babies);
      setLocalPets(pets);
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen, adults, children, babies, pets]);

  const totalExcludingInfants = localAdults + localChildren;
  const canIncreaseAdults = totalExcludingInfants < maxGuests;
  const canIncreaseChildren = totalExcludingInfants < maxGuests;

  const adjust = (field, delta) => {
    if (field === 'adults') {
      setLocalAdults((v) => Math.max(1, Math.min(maxGuests, v + delta)));
    } else if (field === 'children') {
      setLocalChildren((v) => Math.max(0, Math.min(maxGuests - localAdults, v + delta)));
    } else if (field === 'babies') {
      setLocalBabies((v) => Math.max(0, v + delta));
    } else if (field === 'pets') {
      setLocalPets((v) => Math.max(0, v + delta));
    }
  };

  const handleSave = () => {
    onSave({
      adults: localAdults,
      children: localChildren,
      babies: localBabies,
      pets: localPets
    });
    onClose();
  };

  if (!isOpen) return null;

  const rows = [
    { label: t('guests.adults.label'), description: 'Age 13+', field: 'adults', value: localAdults, min: 1, canDec: localAdults > 1, canInc: canIncreaseAdults },
    { label: t('guests.children.label'), description: 'Ages 2-12', field: 'children', value: localChildren, min: 0, canDec: localChildren > 0, canInc: canIncreaseChildren },
    { label: t('guests.babies.label'), description: 'Under 2', field: 'babies', value: localBabies, min: 0, canDec: localBabies > 0, canInc: true },
    { label: t('guests.pets.label'), description: '', field: 'pets', value: localPets, min: 0, canDec: localPets > 0, canInc: allowPets, hasLink: !allowPets }
  ];

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] bg-white flex flex-col md:bg-black/50 md:items-center md:justify-center md:p-8"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      >
        <motion.div
          className="flex flex-col h-full md:h-auto md:max-w-lg md:w-full md:bg-white md:rounded-t-2xl md:overflow-hidden md:shadow-2xl md:max-h-[90vh]"
          initial={{}}
          animate={{}}
        >
          {/* Header */}
          <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
            <h2 className="text-lg font-semibold text-gray-900">Change guests</h2>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          {/* Restrictions */}
          <p className="px-6 py-3 text-sm text-gray-600">
            This place has a maximum of {maxGuests} guests, not including infants.
            {!allowPets && ' Pets are not allowed.'}
          </p>

          {/* Guest rows */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {rows.map((row) => (
              <div key={row.field} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <div>
                  <p className="text-base font-medium text-gray-900">{row.label}</p>
                  {row.description && (
                    <p className="text-sm text-gray-500">{row.description}</p>
                  )}
                  {row.hasLink && (
                    <button
                      type="button"
                      className="text-sm text-gray-600 underline hover:text-gray-900"
                    >
                      {t('guests.pets.description')}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => adjust(row.field, -1)}
                    disabled={!row.canDec}
                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-gray-400 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center text-base font-medium text-gray-900">{row.value}</span>
                  <button
                    type="button"
                    onClick={() => adjust(row.field, 1)}
                    disabled={!row.canInc}
                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-gray-400 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-white shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="h-11 px-6 rounded-lg bg-gray-900 text-white font-semibold hover:bg-gray-800 transition-colors"
            >
              Save
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ChangeGuestsModal;
