/**
 * System (OS) notifications for the dashboard.
 *
 * The app already knows when something happens: `/api/notifications` is polled
 * every 60s and the `notifications` table is subscribed to over realtime. What
 * was missing was telling the operating system, so a sale landing while the
 * producer is in their DAW went unseen until they next looked at the tab.
 *
 * SCOPE, stated plainly: this fires while a tab is open. It is not Web Push —
 * push to a closed browser needs a VAPID key pair, a stored `PushSubscription`
 * per device, and a server that signs and sends. That is a separate piece of
 * infrastructure, not a flag on this one.
 *
 * The decision of what to fire is here, and pure, because it is the part that
 * is embarrassing when wrong: firing on first load means twenty notifications
 * detonating at once the moment the app opens, and re-firing on each poll means
 * the same sale buzzing every sixty seconds forever.
 */

export interface DesktopCandidate {
  id: string;
  title: string;
  body?: string | null;
  read?: boolean | null;
}

export interface SelectOptions {
  /** Ids already delivered to the OS this session. */
  seen: ReadonlySet<string>;
  /**
   * False on the very first fetch after the app loads. Everything present then
   * is history the producer has not asked to be re-told; it is recorded as seen
   * without firing.
   */
  primed: boolean;
}

export interface SelectResult {
  /** Notifications to hand to the OS, oldest first so the newest lands last. */
  fire: DesktopCandidate[];
  /** The full seen set to carry forward — includes what was suppressed. */
  seen: Set<string>;
}

/**
 * Pick which notifications the OS should be told about.
 *
 * Rules, in order:
 *  - anything already seen this session is skipped, so polling is idempotent;
 *  - anything already read is skipped — it was read somewhere else, and an
 *    alert for something already dealt with is noise;
 *  - on the priming pass nothing fires, but everything is marked seen.
 */
export function selectDesktopNotifications(
  notifications: readonly DesktopCandidate[],
  { seen, primed }: SelectOptions,
): SelectResult {
  const nextSeen = new Set(seen);
  const fire: DesktopCandidate[] = [];

  // The API returns newest first; fire oldest first so the most recent is the
  // one left on screen.
  for (const n of [...notifications].reverse()) {
    if (nextSeen.has(n.id)) continue;
    nextSeen.add(n.id);
    if (!primed) continue;
    if (n.read) continue;
    fire.push(n);
  }

  return { fire, seen: nextSeen };
}

/** Cap on how many alerts one refresh may produce. */
export const MAX_DESKTOP_BURST = 3;

/**
 * Collapse a large batch into a single summary.
 *
 * Coming back to the laptop after a good afternoon should not mean dismissing
 * eleven system notifications one at a time.
 */
export function summarizeBurst(fire: DesktopCandidate[]): DesktopCandidate[] {
  if (fire.length <= MAX_DESKTOP_BURST) return fire;
  return [{
    id: `burst:${fire[fire.length - 1]?.id ?? 'latest'}`,
    title: `${fire.length} new notifications`,
    body: fire.slice(-2).map((n) => n.title).join(' · '),
  }];
}

export const DESKTOP_PREF_KEY = 'antigravity-desktop-notifications';

/**
 * Whether the producer has switched this on, per device.
 *
 * Deliberately localStorage rather than `creator_profiles`: OS permission is
 * granted per browser, so a server-side flag would claim the studio Mac's
 * choice also applies to the laptop, where permission was never asked for.
 */
export function desktopPrefEnabled(storage?: Storage): boolean {
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    return store?.getItem(DESKTOP_PREF_KEY) === 'on';
  } catch {
    // Private windows and blocked site data throw on access.
    return false;
  }
}

export function setDesktopPref(on: boolean, storage?: Storage): void {
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    store?.setItem(DESKTOP_PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* nothing we can do, and it must not break the toggle */
  }
}

export type DesktopPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function desktopPermission(): DesktopPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as DesktopPermission;
}

/**
 * Is the whole chain actually live? Both halves are required: the browser has
 * to have granted permission AND the producer has to have asked for this.
 * Permission alone is not consent to keep being interrupted.
 */
export function desktopNotificationsActive(): boolean {
  return desktopPermission() === 'granted' && desktopPrefEnabled();
}
