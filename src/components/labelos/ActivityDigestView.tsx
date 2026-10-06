'use client';

/**
 * The activity digest as lines (LABEL-20, 08 §B5, 07 §2.1): artist → day →
 * ONE line per actor per day ("Sam added 3 demos, created a project and added
 * a file"). Grouping and wording are lib/labelos/digest.ts; this only draws.
 *
 * Days are calendar days in the viewer's time zone. The first render (the
 * server's, and the client's hydration pass) uses UTC so the two agree; the
 * browser's own zone is applied right after mount. No colour: nothing here is
 * a state to signal. No toasts: a feed is read, it does not interrupt.
 */
import Link from 'next/link';
import { useMemo, useSyncExternalStore } from 'react';
import { Lock } from 'lucide-react';
import type { FeedEvent } from '@/lib/labelos/activity-feed';
import { buildDigest, dayKey, describeLine, type DigestNames, type DigestView } from '@/lib/labelos/digest';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';

export type ActivityDigestViewProps = {
  events: readonly FeedEvent[];
  names: DigestNames;
  /** Project-only events are filed under these artists (the overview view). */
  projectArtists?: Readonly<Record<string, readonly string[]>>;
  view: DigestView;
  orgSlug: string;
  /** The signed-in member: their own lines read "You". */
  viewerId?: string;
  /** Events withheld because they are about songs the member may not read (D4). */
  restricted?: number;
};

const noSubscription = () => () => {};
const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * The viewer's zone, UTC on the server and for the hydration pass (so the two
 * agree), the browser's own right after. useSyncExternalStore is React's
 * hydration-safe way to read something only the browser knows.
 */
function useTimeZone(): string {
  return useSyncExternalStore(noSubscription, browserZone, () => 'UTC');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Yesterday", else "Mon 5 Oct" — judged on calendar days in `zone`. */
export function dayLabel(day: string, now: Date, zone: string): string {
  const today = dayKey(now.toISOString(), zone);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), zone);
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  // Fixed names, not Intl: the short month differs between ICU versions ("Sep" / "Sept"), and a label that
  // changes with the runtime is a test that fails on someone else's machine.
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

const timeFormats = new Map<string, Intl.DateTimeFormat | null>();

function timeLabel(iso: string, zone: string): string {
  if (!timeFormats.has(zone)) {
    try {
      timeFormats.set(zone, new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone }));
    } catch {
      timeFormats.set(zone, null);
    }
  }
  return timeFormats.get(zone)?.format(new Date(iso)) ?? '';
}

export function ActivityDigestView({ events, names, projectArtists, view, orgSlug, viewerId, restricted = 0 }: ActivityDigestViewProps) {
  const zone = useTimeZone();
  const digest = useMemo(
    () => buildDigest(events, { view, timeZone: zone, projectArtists: new Map(Object.entries(projectArtists ?? {})) }),
    [events, view, zone, projectArtists],
  );
  const now = new Date();

  return (
    <div className="space-y-8" data-testid="activity-digest">
      {digest.sections.map((section) => (
        <section key={section.artistId ?? 'org'} aria-label={section.artistId ? (names.artists[section.artistId] ?? 'Artist') : view === 'overview' ? 'Organization' : 'Activity'}>
          {view === 'overview' && (
            <h3 className={`${LABEL} mb-3`}>
              {section.artistId ? (
                <Link href={`/o/${orgSlug}/artists/${section.artistId}`} className="text-white/70 hover:text-white" data-testid={`digest-artist-${section.artistId}`}>
                  {names.artists[section.artistId] ?? 'An artist'}
                </Link>
              ) : (
                <span data-testid="digest-org">Organization</span>
              )}
            </h3>
          )}
          <div className="space-y-5">
            {section.days.map((day) => (
              <div key={day.day}>
                <p className={`${LABEL} mb-2 text-white/30`} data-testid={`digest-day-${day.day}`}>{dayLabel(day.day, now, zone)}</p>
                <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0A]">
                  {day.lines.map((line) => {
                    const { actor, text } = describeLine(line, names);
                    const who = viewerId && line.actorId === viewerId ? 'You' : actor;
                    return (
                      <li key={line.key} className="flex items-baseline gap-3 px-4 py-3 text-[12px] leading-relaxed text-white/60" data-testid="digest-line">
                        <span className="min-w-0 flex-1">
                          <span className="text-white/80">{who}</span> {text}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] tracking-[0.1em] text-white/30">{timeLabel(line.lastAt, zone)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
      {restricted > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-[11px] text-white/50" data-testid="digest-restricted">
          <Lock size={12} className="shrink-0 text-white/30" aria-hidden="true" />
          <span>{restricted} {restricted === 1 ? 'update' : 'updates'} on songs you can’t see yet: restricted</span>
        </p>
      )}
    </div>
  );
}
