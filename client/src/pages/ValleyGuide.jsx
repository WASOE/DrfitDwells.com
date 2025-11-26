import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Battery, Droplet, Flame, Wifi, ChevronDown } from 'lucide-react';
import { bookingAPI } from '../services/api';
import './ValleyGuide.css';

const VALLEY_LOCATIONS = ['The Valley', 'Valley'];
const COLORS = {
  background: '#F9F8F4',
  text: '#1F2A24',
  accent: '#6D7A4B',
  accentLight: '#A3B28C',
  border: '#E4DFD2'
};
const MODES = [
  { id: 'prepare', label: 'Prepare', icon: '🧳' },
  { id: 'journey', label: 'Journey', icon: '🗺️' },
  { id: 'dwell', label: 'Dwell', icon: '🌿' }
];

const PACKING_ITEMS = [
  { id: 'shoes', label: 'Closed-toe shoes with grip for 1 km walk' },
  { id: 'layers', label: 'Warm layers (mountain nights drop fast)' },
  { id: 'headlamp', label: 'Headlamp / flashlight' },
  { id: 'powerbank', label: 'Power bank for phones' },
  { id: 'swim', label: 'Swimwear (creek dips & tub)' },
  { id: 'toiletries', label: 'Personal toiletries & meds' }
];

const CHECKLIST_ITEMS = [
  { id: 'fuel', label: 'Fuel tank 100% before leaving town' },
  { id: 'groceries', label: 'Groceries for every main meal' },
  { id: 'water', label: 'Water, drinks, coffee, tea' },
  { id: 'meds', label: 'Medicines / baby items' },
  { id: 'cash', label: 'Optional cash for local products' }
];

const ROUTES = {
  chereshovo: {
    name: 'Chereshovo parking',
    warning: 'Important: ignore any Google Maps suggestion through Kraishte. That shortcut is unsafe and subject to fines.',
    policy: 'Last 1 km is on foot or jeep/horse/ATV only. Do not drive your own car beyond parking.',
    coords: { lat: 41.949939, lng: 23.715978 },
    googleMapsUrl:
      'https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=41.9551759,23.738895&waypoints=optimize:false|41.9020,23.6520|41.9278,23.6953|41.949939,23.715978&travelmode=driving&dir_action=navigate'
  }
};

const LAST_MILE_STEPS = [
  {
    title: 'Park here',
    description:
      'Enter Chereshovo, keep left, and park in the signed gravel pocket. Parking beyond this point risks fines and tow fees.',
    detail: 'Meet host if you booked jeep/horse support.'
  },
  {
    title: 'Follow the pine track',
    description:
      'Walk ~1 km on a compact forest track then a soft pine-needle path. Keep phones in pockets and headlights off to let your eyes adjust.',
    detail: '15–25 min with gradual incline.'
  },
  {
    title: 'Roll the gear cart',
    description:
      'A wooden cart waits at the trailhead. Load your luggage and pull gently; heavy or fragile items ride in with the jeep if pre-arranged.',
    detail: 'Return the cart to the same spot after unloading.'
  }
];

const TIMELINE = [
  {
    label: 'T-24h',
    copy:
      'Fill the fuel tank, buy food for all meals, water, drinks, coffee, tea, medicines/baby items, and optional cash for local producers (honey, butter, cheese).'
  },
  {
    label: 'T-3h',
    copy: 'Confirm route, check weather, download Google Maps offline, and share ETA with host.'
  },
  {
    label: 'T-1h',
    copy: 'Switch navigation to the exact Eleshnitsa → Palatik → Chereshovo route (or Ortsevo if hiking).'
  },
  {
    label: 'Arrival',
    copy:
      'Park where instructed, do not drive beyond parking, and walk the final kilometer. If you booked jeep/horse support, meet at the parking time agreed.'
  }
];

const SYSTEMS = [
  {
    key: 'power',
    name: 'Power (solar + batteries)',
    copy:
      'Charge phones during daylight. Avoid high-draw items (hair dryers, heaters). Lights off when leaving a room. Batteries top up each sunny day.'
  },
  {
    key: 'water',
    name: 'Water (mountain source)',
    copy: 'Use normally but no oils/chemicals/glitter. All grey water returns directly to the valley soil.'
  },
  {
    key: 'heat',
    name: 'Heating & hot water',
    copy:
      'Wood stove/fireplace warms the cabin; gas/hybrid handles hot water. Learn vents/fuel placement and the hot-water switch when you arrive. Never leave the stove unattended.'
  }
];

const ACTIVITIES = [
  {
    id: 'atv',
    title: 'ATV ridge runs',
    copy: 'Forest routes, ridge traverses, golden-hour rides. Guided or self-drive depending on skill.'
  },
  {
    id: 'horse',
    title: 'Horse riding',
    copy: 'Village departures with calm mountain horses. Short beginner loops to longer routes.'
  },
  {
    id: 'guide',
    title: 'Guided hikes',
    copy: 'Local valley guide leads you to hidden swings, creek pools, and sunset cliffs.'
  }
];

const BentoCard = ({ title, kicker, children, className = '', icon: Icon, bgColor, iconInCircle = false, textColor }) => {
  const isYellowBg = bgColor === '#FEF3C7';
  const titleColor = textColor || (isYellowBg ? '#78350F' : COLORS.text);
  const kickerColor = isYellowBg ? '#92400E' : 'text-stone-400';
  
  return (
    <div
      className={`bg-white border ${className}`}
      style={{
        borderColor: COLORS.border,
        borderRadius: '32px',
        boxShadow: '0 20px 45px rgba(62, 57, 46, 0.08)',
        padding: '28px',
        backgroundColor: bgColor || 'white'
      }}
    >
      {kicker && <p className={`text-xs tracking-[0.35em] uppercase ${isYellowBg ? 'text-yellow-900' : kickerColor}`}>{kicker}</p>}
      {title && (
        <h3 className="mt-2 font-['Instrument_Serif'] text-2xl flex items-center gap-3" style={{ color: titleColor }}>
          {Icon && iconInCircle ? (
            <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0">
              <Icon size={20} style={{ color: COLORS.accent }} />
            </div>
          ) : Icon ? (
            <Icon size={28} style={{ color: COLORS.accent }} />
          ) : null}
          {title}
        </h3>
      )}
      <div className="mt-4 text-sm leading-relaxed" style={{ color: titleColor }}>
        {children}
      </div>
    </div>
  );
};

const StageNav = ({ activeMode, setActiveMode }) => (
  <div className="fixed bottom-5 inset-x-0 flex justify-center pointer-events-none z-40">
    <div
      className="flex gap-6 px-6 py-3 rounded-full shadow-xl pointer-events-auto"
      style={{ background: COLORS.accent, color: '#FDFCF8' }}
    >
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => setActiveMode(mode.id)}
          className={`flex flex-col items-center text-xs tracking-widest transition-all ${
            activeMode === mode.id ? 'opacity-100' : 'opacity-70'
          }`}
        >
          <motion.span layoutId={`stage-${mode.id}`} className="text-lg" animate={{ scale: activeMode === mode.id ? 1.15 : 1 }}>
            {mode.icon}
          </motion.span>
          <span className="mt-1 font-semibold">{mode.label}</span>
        </button>
      ))}
    </div>
  </div>
);

const getWeatherSnapshot = () => ({
  temperature: 8,
  feelsLike: 5,
  high: 11,
  low: 2,
  condition: 'Low clouds, light breeze',
  sunrise: '07:35',
  sunset: '17:04'
});

const calculateSunsetCountdown = () => {
  const now = new Date();
  const sunset = new Date();
  sunset.setHours(17, 0, 0, 0);
  const diff = sunset - now;
  if (diff <= 0) return 'Sunset passed — walk with headlamps';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.round((diff / (1000 * 60)) % 60);
  return `${hours}h ${String(minutes).padStart(2, '0')}m until sunset`;
};

const ValleyGuide = () => {
  const { bookingId } = useParams();

  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [packingItems, setPackingItems] = useState(new Set());
  const [checklistItems, setChecklistItems] = useState(new Set());
  const [activeMode, setActiveMode] = useState('prepare');
  const [wizardIndex, setWizardIndex] = useState(0);
  const [toast, setToast] = useState(null);
  const [expandedActivity, setExpandedActivity] = useState(null);
  const [showAddOnForm, setShowAddOnForm] = useState(null);
  const [addOnForm, setAddOnForm] = useState({ date: '', timeWindow: '', pax: '', notes: '' });

  useEffect(() => {
    const fetchBooking = async () => {
      if (!bookingId) {
        setError('Invalid booking ID');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const res = await bookingAPI.getById(bookingId);
        if (res.data.success) {
          const bookingData = res.data.data.booking;
          const location = bookingData.cabinId?.location || bookingData.cabinTypeId?.location || '';
          if (!VALLEY_LOCATIONS.some((loc) => location.toLowerCase().includes(loc.toLowerCase()))) {
            setError('This companion is only for The Valley bookings.');
            setLoading(false);
            return;
          }
          setBooking(bookingData);
          const saved = localStorage.getItem(`valley-guide-${bookingId}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            setPackingItems(new Set(parsed.packingItems || []));
              setChecklistItems(new Set(parsed.checklistItems || []));
          }
        } else {
          setError('Booking not found');
        }
      } catch (err) {
        console.error(err);
        setError('Unable to load booking.');
      } finally {
        setLoading(false);
      }
    };
    fetchBooking();
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) return;
    localStorage.setItem(
      `valley-guide-${bookingId}`,
      JSON.stringify({ packingItems: Array.from(packingItems), checklistItems: Array.from(checklistItems) })
    );
  }, [bookingId, packingItems, checklistItems]);

  const weather = useMemo(() => getWeatherSnapshot(), []);
  const sunsetCountdown = calculateSunsetCountdown();
  const isSunsetPassed = sunsetCountdown.includes('Sunset passed');
  const route = ROUTES.chereshovo;

  const togglePill = (id, setter) => {
    setter((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const copyText = (text, message) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setToast(message);
        setTimeout(() => setToast(null), 2500);
      })
      .catch(() => alert('Copy failed'));
  };

  const handleAddOnRequest = async (type) => {
    try {
      await bookingAPI.submitAddOnRequest(bookingId, {
        type,
        date: addOnForm.date,
        timeWindow: addOnForm.timeWindow,
        pax: addOnForm.pax,
        notes: addOnForm.notes
      });
      setToast('Request sent — we will confirm with you.');
      setTimeout(() => setToast(null), 3000);
        setShowAddOnForm(null);
        setAddOnForm({ date: '', timeWindow: '', pax: '', notes: '' });
    } catch (err) {
      console.error(err);
      alert('Unable to submit request just now.');
    }
  };

  const saveOffline = () => window.print();

  const renderPrepare = () => (
    <div className="space-y-8">
      <div className="grid md:grid-cols-2 gap-6">
        <BentoCard title="Pack with intention" kicker="The valley walk">
          <div className="flex flex-wrap gap-3">
            {PACKING_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => togglePill(item.id, setPackingItems)}
                className={`px-4 py-2 rounded-full text-sm border transition ${
                  packingItems.has(item.id)
                    ? 'bg-[#E0E8D9] border-[#B2C1A3] text-[#425034]'
                    : 'border-[#D8D1C3] text-[#4A4A3D] hover:border-[#C7BFAF]'
                }`}
              >
                {packingItems.has(item.id) ? '✓ ' : ''}
                {item.label}
              </button>
            ))}
          </div>
        </BentoCard>
        <BentoCard title="Before you leave town" kicker="Checklist">
          <div className="space-y-3">
            {CHECKLIST_ITEMS.map((item) => (
              <label key={item.id} className="flex items-center gap-3">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
                    checklistItems.has(item.id)
                      ? 'bg-[#6D7A4B] border-[#6D7A4B]' : 'border-[#CFC7B6]'
                  }`}
                >
                  {checklistItems.has(item.id) && <span className="text-white text-xs">✓</span>}
                </span>
                <input
                  type="checkbox"
                  checked={checklistItems.has(item.id)}
                  onChange={() => togglePill(item.id, setChecklistItems)}
                  className="hidden"
                />
                <span className={checklistItems.has(item.id) ? 'line-through text-stone-400' : ''}>{item.label}</span>
              </label>
            ))}
          </div>
        </BentoCard>
      </div>

      <BentoCard title="Town grocery run" kicker="Razlog & Bansko">
        <p>
          There are no supermarkets or pharmacies on the climb. Stock up on everything you need: fuel, groceries, water, coffee and tea, medicines, baby items, and optional cash for valley products (honey, butter, cheese, eggs, meat).
        </p>
      </BentoCard>

      <BentoCard title="Timeline" kicker="Exact cadence">
        <div className="relative">
          {/* Mobile: Vertical stepper */}
          <div className="md:hidden space-y-6">
            {TIMELINE.map((step, idx) => (
              <div key={step.label} className="relative flex gap-4">
                {/* Left side: Dot and vertical line */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div
                    className="w-3 h-3 rounded-full z-10"
                    style={{ backgroundColor: COLORS.accent }}
                  />
                  {idx < TIMELINE.length - 1 && (
                    <div
                      className="w-[2px] flex-1 mt-2"
                      style={{ backgroundColor: COLORS.border, minHeight: '2rem' }}
                    />
                  )}
                </div>
                {/* Right side: Content */}
                <div className="flex-1 pb-4">
                  <p className="text-sm font-bold tracking-[0.2em] uppercase" style={{ color: COLORS.text }}>
                    {step.label}
                  </p>
                  <p className="mt-3 text-sm text-[#3D3A32] leading-relaxed text-left">{step.copy}</p>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop: Horizontal stepper */}
          <div className="hidden md:block relative pt-8">
            {/* Horizontal connecting line */}
            <div
              className="absolute top-8 left-0 right-0 h-[2px]"
              style={{ backgroundColor: COLORS.border }}
            />
            <div className="grid md:grid-cols-4 gap-4 relative">
              {TIMELINE.map((step, idx) => (
                <div key={step.label} className="relative">
                  <div className="flex flex-col">
                    {/* Dot on the line */}
                    <div className="absolute -top-6 left-0">
                      <div
                        className="w-3 h-3 rounded-full z-10"
                        style={{ backgroundColor: COLORS.accent }}
                      />
                    </div>
                    {/* Content below */}
                    <div className="pt-4">
                      <p className="text-sm font-bold tracking-[0.2em] uppercase" style={{ color: COLORS.text }}>
                        {step.label}
                      </p>
                      <p className="mt-3 text-sm text-[#3D3A32] leading-relaxed text-left">{step.copy}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </BentoCard>
    </div>
  );

  const renderJourney = () => (
    <div className="space-y-8">
      <div className="grid md:grid-cols-2 gap-6">
        <BentoCard
          title="Arrive before dark"
          kicker="Sunset"
          bgColor={isSunsetPassed ? '#FEF3C7' : undefined}
        >
          <p className="text-4xl font-['Instrument_Serif'] font-bold">
            {sunsetCountdown}
          </p>
          <p className="mt-2 text-sm">
            Sunset today at {weather.sunset}. Aim to park 60 minutes before to walk in daylight.
          </p>
        </BentoCard>
        <BentoCard title="Navigation" kicker="Chereshovo" className="space-y-3">
          <button
            onClick={() => window.open(route.googleMapsUrl, '_blank', 'noopener,noreferrer')}
            className="w-full rounded-full px-4 py-3 text-sm font-semibold"
            style={{ background: COLORS.accent, color: '#FDFCF8' }}
          >
            Open in Maps
          </button>
          <button
            onClick={() => copyText(`${route.coords.lat}, ${route.coords.lng}`, 'Coordinates copied')}
            className="w-full rounded-full px-4 py-3 border text-sm"
            style={{ borderColor: COLORS.border }}
          >
            Copy coordinates
          </button>
          <p className="text-xs text-stone-500">{route.warning}</p>
          <p className="text-xs text-stone-500">{route.policy}</p>
        </BentoCard>
      </div>

      <BentoCard title="Last kilometer" kicker="Step-by-step">
        {/* Mobile: Small dots */}
        <div className="md:hidden flex items-center justify-center gap-2 mb-4">
          {LAST_MILE_STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setWizardIndex(idx)}
              className={`w-2 h-2 rounded-full transition ${idx === wizardIndex ? 'bg-[#6D7A4B]' : 'bg-[#DDD7C8]'}`}
            />
          ))}
        </div>
        {/* Desktop: Progress bar */}
        <div className="hidden md:flex items-center gap-3 mb-4">
          {LAST_MILE_STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setWizardIndex(idx)}
              className={`flex-1 h-2 rounded-full ${idx === wizardIndex ? 'bg-[#6D7A4B]' : 'bg-[#DDD7C8]'}`}
            />
          ))}
        </div>
        <motion.div
          key={wizardIndex}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <p className="text-sm tracking-[0.35em] uppercase text-stone-400">{LAST_MILE_STEPS[wizardIndex].title}</p>
          <p>{LAST_MILE_STEPS[wizardIndex].description}</p>
          <p className="text-sm text-stone-500">{LAST_MILE_STEPS[wizardIndex].detail}</p>
        </motion.div>
      </BentoCard>
    </div>
  );

  const renderDwell = () => (
    <div className="space-y-8">
      <div className="grid md:grid-cols-3 gap-6">
        {SYSTEMS.map((system) => {
          const IconMap = {
            power: Battery,
            water: Droplet,
            heat: Flame
          };
          const Icon = IconMap[system.key];
          return (
            <BentoCard key={system.key} title={system.name} icon={Icon} iconInCircle={true}>
              <p>{system.copy}</p>
            </BentoCard>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <BentoCard title="Wi-Fi & arrival" kicker="Essentials" icon={Wifi}>
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs text-stone-400 uppercase tracking-[0.35em]">Network</p>
              <p className="text-xl font-['Instrument_Serif'] text-[#2F392A]">drift-valley</p>
            </div>
            <div>
              <p className="text-xs text-stone-400 uppercase tracking-[0.35em]">Password</p>
              <button
                onClick={() => copyText('mossy-horizons', 'Wi-Fi password copied')}
                className="text-lg font-semibold underline-offset-4 hover:underline"
                style={{ color: COLORS.accent }}
              >
                mossy-horizons
              </button>
            </div>
          </div>
        </BentoCard>
        <BentoCard title="Save for offline" kicker="No signal">
          <p>Download a full copy to your device. Works as a field guide when reception drops.</p>
          <button
            onClick={saveOffline}
            className="mt-4 rounded-full px-4 py-3 text-sm font-semibold"
            style={{ background: COLORS.text, color: '#FDFCF8' }}
          >
            Download guide
          </button>
        </BentoCard>
      </div>

      <BentoCard title="Activities & add-ons" kicker="Book with host">
        <div className="space-y-3">
          {ACTIVITIES.map((activity) => (
            <div key={activity.id} className="border rounded-2xl overflow-hidden" style={{ borderColor: COLORS.border }}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors cursor-pointer"
                onClick={() => setExpandedActivity(expandedActivity === activity.id ? null : activity.id)}
              >
                <div className="flex-1 text-left">
                  <p className="font-semibold" style={{ color: COLORS.text }}>{activity.title}</p>
                  <p className="text-xs text-stone-500">Tap for details</p>
                </div>
                <ChevronDown
                  size={20}
                  className="transition-transform flex-shrink-0"
                  style={{
                    color: COLORS.accent,
                    transform: expandedActivity === activity.id ? 'rotate(180deg)' : 'rotate(0deg)'
                  }}
                />
              </button>
              <AnimatePresence initial={false}>
                {expandedActivity === activity.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="px-4 pb-4 text-sm"
                    style={{ color: COLORS.text }}
                  >
                    <p>{activity.copy}</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAddOnForm(activity.id);
                      }}
                      className="mt-3 rounded-full px-4 py-2 text-xs font-semibold"
                      style={{ border: `1px solid ${COLORS.accent}`, color: COLORS.accent }}
                    >
                      Request {activity.title}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </BentoCard>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.background, color: COLORS.text }}>
        Loading your companion…
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-8" style={{ background: COLORS.background, color: COLORS.text }}>
        <div>
          <p className="font-['Instrument_Serif'] text-3xl mb-2">Guide unavailable</p>
          <p className="text-stone-500">{error || 'Only guests staying in The Valley can open this companion.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: COLORS.background, color: COLORS.text }}>
      <div className="max-w-5xl mx-auto px-4 pt-10 pb-36 space-y-4 md:space-y-8">
        <header className="space-y-2">
          <p className="text-xs tracking-[0.4em] uppercase text-stone-400">Drift & Dwells · Valley Companion</p>
          <h1 className="font-['Instrument_Serif'] text-4xl sm:text-5xl" style={{ color: COLORS.text }}>
            Your journey from town to firelight
          </h1>
          <p className="text-sm text-stone-500">
            Booking <span className="font-semibold" style={{ color: COLORS.accent }}>{booking._id.slice(-6)}</span>
          </p>
        </header>

        <BentoCard title="Weather right now" kicker={weather.condition}>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-5xl font-['Instrument_Serif'] font-bold" style={{ color: COLORS.text }}>{weather.temperature}°C</p>
              <p className="text-xs text-stone-400">Feels like <span className="font-semibold">{weather.feelsLike}°C</span></p>
            </div>
            <div className="text-sm text-stone-500 space-y-1">
              <p>High <span className="font-semibold">{weather.high}°</span> · Low <span className="font-semibold">{weather.low}°</span></p>
              <p>Sunrise <span className="font-semibold">{weather.sunrise}</span> · Sunset <span className="font-semibold">{weather.sunset}</span></p>
            </div>
            <button
              onClick={saveOffline}
              className="ml-auto rounded-full px-4 py-2 text-sm font-semibold"
              style={{ border: `1px solid ${COLORS.accent}`, color: COLORS.accent }}
            >
              Save for offline
            </button>
          </div>
        </BentoCard>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeMode}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            {activeMode === 'prepare' && renderPrepare()}
            {activeMode === 'journey' && renderJourney()}
            {activeMode === 'dwell' && renderDwell()}
          </motion.div>
        </AnimatePresence>
      </div>

      <StageNav activeMode={activeMode} setActiveMode={setActiveMode} />

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm shadow-lg"
            style={{ background: COLORS.text, color: '#FDFCF8' }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {showAddOnForm && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-3xl border p-6 space-y-4 w-full max-w-md" style={{ borderColor: COLORS.border }}>
            <h3 className="font-['Instrument_Serif'] text-2xl">Request {showAddOnForm}</h3>
            <div className="space-y-3 text-sm">
              <input
                type="date"
                value={addOnForm.date}
                onChange={(e) => setAddOnForm({ ...addOnForm, date: e.target.value })}
                className="w-full rounded-2xl border px-4 py-2"
                style={{ borderColor: COLORS.border }}
              />
              <select
                value={addOnForm.timeWindow}
                onChange={(e) => setAddOnForm({ ...addOnForm, timeWindow: e.target.value })}
                className="w-full rounded-2xl border px-4 py-2"
                style={{ borderColor: COLORS.border }}
              >
                <option value="">Time window</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
              <input
                type="number"
                min="1"
                placeholder="Guests"
                value={addOnForm.pax}
                onChange={(e) => setAddOnForm({ ...addOnForm, pax: e.target.value })}
                className="w-full rounded-2xl border px-4 py-2"
                style={{ borderColor: COLORS.border }}
              />
              <textarea
                placeholder="Notes"
                value={addOnForm.notes}
                onChange={(e) => setAddOnForm({ ...addOnForm, notes: e.target.value })}
                className="w-full rounded-2xl border px-4 py-2"
                style={{ borderColor: COLORS.border }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAddOnForm(null)}
                className="flex-1 rounded-2xl border px-4 py-2"
                style={{ borderColor: COLORS.border }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleAddOnRequest(showAddOnForm)}
                className="flex-1 rounded-2xl px-4 py-2 text-sm font-semibold"
                style={{ background: COLORS.accent, color: '#FDFCF8' }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ValleyGuide;
