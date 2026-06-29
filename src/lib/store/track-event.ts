/**
 * Client-side storefront funnel emitter.
 *
 * Fire-and-forget POSTs to /api/store/event with an anonymous, persisted
 * session id so the producer's /analytics funnel can stitch a visitor's
 * actions together (pdp_view → add_to_cart → checkout_start → purchase)
 * without us storing any PII.
 *
 * Browser-only and defensive: every call is wrapped so a telemetry failure
 * can never throw into the shopping UX. Safe to import from client
 * components and Zustand stores.
 */
import type { StoreEventType } from '@/lib/store/funnel';

const SESSION_KEY = 'antigravity-store-session';

/** Get-or-create the anonymous store session id (localStorage). */
export function getStoreSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

export interface StoreEventInput {
  track_id?: string;
  license_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Emit a funnel event. Never awaited, never throws. Uses `keepalive` so the
 * request survives a navigation (e.g. checkout_start right before redirect).
 */
export function trackStoreEvent(eventType: StoreEventType, input: StoreEventInput = {}): void {
  if (typeof window === 'undefined') return;
  const session_id = getStoreSessionId();
  if (!session_id) return;

  const body = JSON.stringify({
    event_type: eventType,
    session_id,
    track_id: input.track_id,
    license_id: input.license_id,
    metadata: input.metadata,
  });

  try {
    void fetch('/api/store/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore — telemetry is best-effort
  }
}
