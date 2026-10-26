/**
 * `LABEL_OS_ENABLED` — the server-side switch for BStudio Label OS
 * (10-technical-architecture.md §12). OFF unless set to "true" or "1", the
 * same spelling `ENABLE_LOCAL_STORE` accepts. While it is off, src/proxy.ts
 * answers 404 on `/api/org/*` and `/o/*`, so nothing of Label OS is reachable
 * and every other path behaves exactly as it does without Label OS.
 */
export function isLabelOsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.LABEL_OS_ENABLED?.trim().toLowerCase();
  return value === 'true' || value === '1';
}
