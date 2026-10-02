'use client';

/**
 * The org a `/o/<slug>` page is in, and the viewer's standing in it, as the
 * (label) layout resolved it on the server (`orgShellFor`). Pages read it
 * instead of fetching it again. It is a convenience for rendering only:
 * every `/api/org/*` request is re-authorised by the route.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Capability, OrgKind, Role } from '@/lib/labelos/capabilities';

export type OrgShellValue = {
  org: { id: string; name: string; slug: string; kind: OrgKind };
  role: Role;
  scope: 'org' | 'artists';
  capabilities: Capability[];
  viewerIsProducer: boolean;
};

type Ctx = OrgShellValue & {
  can: (cap: Capability) => boolean;
  /** After a rename, so the top bar and the page agree without a reload. */
  setOrgName: (name: string) => void;
};

const OrgShellContext = createContext<Ctx | null>(null);

export function OrgShellProvider({ value, children }: { value: OrgShellValue; children: ReactNode }) {
  const [name, setName] = useState(value.org.name);
  const can = useCallback((cap: Capability) => value.capabilities.includes(cap), [value.capabilities]);
  const ctx = useMemo<Ctx>(
    () => ({ ...value, org: { ...value.org, name }, can, setOrgName: setName }),
    [value, name, can],
  );
  return <OrgShellContext.Provider value={ctx}>{children}</OrgShellContext.Provider>;
}

/** The current org shell, or null outside `/o/<slug>`. */
export function useOrgShell(): Ctx | null {
  return useContext(OrgShellContext);
}
