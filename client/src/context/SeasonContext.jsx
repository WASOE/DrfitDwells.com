import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'drift-dwells-season';

// Bulgaria winter: Dec, Jan, Feb. All other months default to summer.
const WINTER_MONTHS = [0, 1, 11]; // Jan, Feb, Dec (0-indexed)

function getSeasonFromDate() {
  const month = new Date().getMonth();
  return WINTER_MONTHS.includes(month) ? 'winter' : 'summer';
}

const SeasonContext = createContext(null);

export const useSeason = () => {
  const ctx = useContext(SeasonContext);
  if (!ctx) {
    throw new Error('useSeason must be used within a SeasonProvider');
  }
  return ctx;
};

export const SeasonProvider = ({ children }) => {
  const [season, setSeasonState] = useState(() => {
    if (typeof window === 'undefined') return 'winter';
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'summer' || stored === 'winter') {
        return stored;
      }
    } catch {
      // ignore
    }
    return getSeasonFromDate();
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, season);
    } catch {
      // ignore
    }
  }, [season]);

  const setSeason = useCallback((value) => {
    setSeasonState(value === 'summer' ? 'summer' : 'winter');
  }, []);

  const toggleSeason = useCallback(() => {
    setSeasonState((s) => (s === 'winter' ? 'summer' : 'winter'));
  }, []);

  return (
    <SeasonContext.Provider value={{ season, setSeason, toggleSeason }}>
      {children}
    </SeasonContext.Provider>
  );
};
