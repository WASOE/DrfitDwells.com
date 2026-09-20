import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyOpsAppearanceToRoot,
  getOpsRootDomProps,
  readOpsAppearanceMode,
  resolveOpsAppearance,
  resolveOpsProductHtmlAppearance,
  writeOpsAppearanceMode
} from './opsAppearance';

const OpsAppearanceContext = createContext(null);

function subscribeToColorScheme(onChange) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event) => onChange(Boolean(event.matches));
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }
  if (typeof mq.addListener === 'function') {
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }
  return () => {};
}

export function OpsAppearanceProvider({ children }) {
  const [mode, setModeState] = useState(() => readOpsAppearanceMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  const appearance = resolveOpsAppearance(mode, systemPrefersDark);
  const htmlAppearance = resolveOpsProductHtmlAppearance(mode, systemPrefersDark);

  useEffect(() => {
    applyOpsAppearanceToRoot(document.documentElement, {
      active: true,
      mode,
      appearance: htmlAppearance
    });
    return () => {
      applyOpsAppearanceToRoot(document.documentElement, { active: false });
    };
  }, [mode, htmlAppearance]);

  useEffect(() => {
    if (mode !== 'system') {
      return undefined;
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      setSystemPrefersDark(Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches));
    }
    return subscribeToColorScheme(setSystemPrefersDark);
  }, [mode]);

  const setMode = useCallback((nextMode) => {
    const parsed = writeOpsAppearanceMode(nextMode);
    setModeState(parsed);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      appearance,
      setMode
    }),
    [mode, appearance, setMode]
  );

  return <OpsAppearanceContext.Provider value={value}>{children}</OpsAppearanceContext.Provider>;
}

export function useOpsAppearance() {
  const ctx = useContext(OpsAppearanceContext);
  if (!ctx) {
    return {
      mode: 'system',
      appearance: 'light',
      setMode: () => {}
    };
  }
  return ctx;
}

export function OpsRoot({ className = '', themed = false, children, ...rest }) {
  const { appearance, mode } = useOpsAppearance();
  const rootProps = getOpsRootDomProps({ appearance, mode, themed });
  const mergedClassName = [rootProps.className, className].filter(Boolean).join(' ');
  return (
    <div {...rootProps} className={mergedClassName} {...rest}>
      {children}
    </div>
  );
}
