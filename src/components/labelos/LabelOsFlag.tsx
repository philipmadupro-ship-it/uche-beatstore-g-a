'use client';

/**
 * Whether Label OS is switched on (`LABEL_OS_ENABLED`, read on the server by
 * the layout and handed down). Client components that would otherwise call
 * `/api/org` ask this first, so with the flag off they render exactly what
 * they rendered before Label OS and make no request at all — a 404 from the
 * proxy is not "nothing changed".
 */
import { createContext, useContext, type ReactNode } from 'react';

const LabelOsFlagContext = createContext(false);

export function LabelOsFlagProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <LabelOsFlagContext.Provider value={enabled}>{children}</LabelOsFlagContext.Provider>;
}

export function useLabelOsEnabled(): boolean {
  return useContext(LabelOsFlagContext);
}
