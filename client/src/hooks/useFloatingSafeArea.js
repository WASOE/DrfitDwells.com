/**
 * Hook for positioning fixed/floating UI elements above sticky bottom bars.
 * Returns bottom offset in pixels so chat, audio, etc. don't overlap primary CTAs.
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getFloatingBottomOffset } from '../utils/layoutConstants';

const DESKTOP_BREAKPOINT = 768;

export function useFloatingSafeArea() {
  const location = useLocation();
  const [state, setState] = useState(() => {
    const isDesktop = typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT;
    return {
      bottomOffset: getFloatingBottomOffset(location.pathname, isDesktop),
      isDesktop,
    };
  });

  useEffect(() => {
    const update = () => {
      const isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;
      setState({
        bottomOffset: getFloatingBottomOffset(location.pathname, isDesktop),
        isDesktop,
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [location.pathname]);

  return { bottomOffset: state.bottomOffset, isDesktop: state.isDesktop };
}
