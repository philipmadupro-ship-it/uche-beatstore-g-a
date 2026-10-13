/**
 * The release calendar as an iCalendar feed (LABEL-34, RFC 5545). Pure.
 * Titles and dates ONLY: each release is one all-day event whose SUMMARY is
 * its title and whose date is its release date, else its target date (then
 * STATUS:TENTATIVE). No artist, no project, no description, no link, nothing
 * a subscription URL leaking would add to what the dates already say.
 *
 *  - Lines end CRLF and fold at 75 OCTETS (never inside a UTF-8 character).
 *  - TEXT is escaped (\\, ;, comma, newline) and stripped of control characters.
 *  - UID is stable per release (the feed makes it an opaque keyed hash); DTSTAMP is the release's own updated_at, so a
 *    re-fetch with nothing changed is byte-identical and clients do not churn.
 *  - All-day DATE values; DTEND is the next day (exclusive), as the RFC says.
 */
export type CalendarRelease = {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  releaseDate: string | null;
  targetDate: string | null;
  state: string;
  updatedAt: string;
};

const CRLF = '\r\n';
const FOLD_OCTETS = 75;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD, else null. */
export function parseDay(value: string | null | undefined): { y: number; m: number; d: number } | null {
  const hit = typeof value === 'string' ? DATE.exec(value) : null;
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `2026-10-13` → `20261013` */
export function icsDate(day: { y: number; m: number; d: number }): string {
  return `${pad(day.y, 4)}${pad(day.m)}${pad(day.d)}`;
}

function nextDay(day: { y: number; m: number; d: number }): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** `2026-10-13T08:30:00.000Z` → `20261013T083000Z`; an unreadable stamp falls back to the epoch (stable). */
export function icsStamp(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null;
  const ms = t && Number.isFinite(t.getTime()) ? t.getTime() : 0;
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** RFC 5545 §3.3.11 TEXT. Control characters (a CR/LF in a title would add a property) are dropped first. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n|\r|\n|\u0085|\u2028|\u2029/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Fold one logical line into physical lines of at most 75 octets (continuations start with one space). */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line) <= FOLD_OCTETS) return line;
  const out: string[] = [];
  let current = '';
  let used = 0;
  let limit = FOLD_OCTETS;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (used + size > limit) {
      out.push(current);
      current = ' ';
      used = 1;
      limit = FOLD_OCTETS;
    }
    current += ch;
    used += size;
  }
  out.push(current);
  return out.join(CRLF);
}

/** The event date of a release: its release date, else its target (tentative); null = not on the calendar. */
export function calendarDay(r: Pick<CalendarRelease, 'releaseDate' | 'targetDate' | 'state'>): { day: { y: number; m: number; d: number }; tentative: boolean } | null {
  if (r.state === 'cancelled') return null;
  const release = parseDay(r.releaseDate);
  if (release) return { day: release, tentative: false };
  const target = parseDay(r.targetDate);
  return target ? { day: target, tentative: true } : null;
}

export function buildIcs(opts: {
  name: string;
  /** UID of an event. Defaults to the release id; the feed passes a keyed hash so no row id leaves the building. */
  uidFor?: (releaseId: string) => string;
  releases: readonly CalendarRelease[];
}): string {
  const uidFor = opts.uidFor ?? ((id: string) => `release-${id}@label-os`);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//U2C Label OS//Release calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
  ];
  const events = opts.releases
    .map((r) => ({ r, when: calendarDay(r) }))
    .filter((e): e is { r: CalendarRelease; when: NonNullable<ReturnType<typeof calendarDay>> } => e.when !== null)
    .sort((a, b) => icsDate(a.when.day).localeCompare(icsDate(b.when.day)) || a.r.id.localeCompare(b.r.id));
  for (const { r, when } of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uidFor(r.id)}`,
      `DTSTAMP:${icsStamp(r.updatedAt)}`,
      `DTSTART;VALUE=DATE:${icsDate(when.day)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDay(when.day))}`,
      `SUMMARY:${escapeText(r.title)}`,
      `STATUS:${when.tentative ? 'TENTATIVE' : 'CONFIRMED'}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}
