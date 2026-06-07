import { createContext, useContext } from 'react';

/** @typedef {{ authenticated: boolean, actorId: string|null, role: string, modules: string[], actions: string[], defaultRoute: string }} OpsSession */

export const OpsSessionContext = createContext(/** @type {OpsSession|null} */ (null));

export function OpsSessionProvider({ session, children }) {
  return <OpsSessionContext.Provider value={session}>{children}</OpsSessionContext.Provider>;
}

export function useOpsSession() {
  return useContext(OpsSessionContext);
}
