import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const OpsPageWidthContext = createContext(null);

/**
 * Lets a mounted OpsPage opt the shell out of the legacy max-w-7xl cap.
 * Count-based so unmount restores legacy width without pathname maps.
 */
export function OpsPageWidthProvider({ children }) {
  const [ownerCount, setOwnerCount] = useState(0);

  const register = useCallback(() => {
    setOwnerCount((count) => count + 1);
    return () => {
      setOwnerCount((count) => Math.max(0, count - 1));
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV && ownerCount > 1) {
      console.warn(
        'OpsPage: nested OpsPage is unsupported. The shell stays opted out of the legacy max-w-7xl cap while any OpsPage is mounted.'
      );
    }
  }, [ownerCount]);

  const value = useMemo(
    () => ({
      ownsWidth: ownerCount > 0,
      register
    }),
    [ownerCount, register]
  );

  return <OpsPageWidthContext.Provider value={value}>{children}</OpsPageWidthContext.Provider>;
}

export function useOpsPageOwnsWidth() {
  return Boolean(useContext(OpsPageWidthContext)?.ownsWidth);
}

export function useRegisterOpsPageWidth() {
  return useContext(OpsPageWidthContext)?.register || null;
}
