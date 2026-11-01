import { describe, expect, it } from 'vitest';
import { buildIcs, calendarDay, escapeText, foldLine, icsDate, icsStamp, parseDay, type CalendarRelease } from './release-calendar';

const rel = (id: string, over: Partial<CalendarRelease> = {}): CalendarRelease => ({
  id,
  title: 'Midnight Run',
  releaseDate: null,
  targetDate: null,
  state: 'draft',
  updatedAt: '2026-10-01T08:30:00.000Z',
  ...over,
});

describe('dates', () => {
  it('accepts only real calendar days', () => {
    expect(parseDay('2026-11-06')).toEqual({ y: 2026, m: 11, d: 6 });
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('2026-11-06T10:00:00Z')).toBeNull();
    expect(parseDay('11/06/2026')).toBeNull();
    expect(parseDay(null)).toBeNull();
  });

  it('formats all-day DATE values and stable DTSTAMPs', () => {
    expect(icsDate({ y: 2026, m: 1, d: 5 })).toBe('20260105');
    expect(icsStamp('2026-10-01T08:30:00.000Z')).toBe('20261001T083000Z');
    expect(icsStamp('garbage')).toBe('19700101T000000Z');
  });

  it('puts a release on its release date, else its target (tentative); cancelled and undated are off', () => {
    expect(calendarDay({ releaseDate: '2026-11-06', targetDate: '2026-11-01', state: 'draft' })).toEqual({ day: { y: 2026, m: 11, d: 6 }, tentative: false });
    expect(calendarDay({ releaseDate: null, targetDate: '2026-11-01', state: 'draft' })?.tentative).toBe(true);
    expect(calendarDay({ releaseDate: '2026-11-06', targetDate: null, state: 'withdrawn' })).toBeNull();
    expect(calendarDay({ releaseDate: '2026-11-06', targetDate: null, state: 'cancelled' })).toBeNull();
    expect(calendarDay({ releaseDate: null, targetDate: null, state: 'draft' })).toBeNull();
  });
});

describe('escaping and folding', () => {
  it('escapes TEXT and drops anything that could add a property', () => {
    expect(escapeText('A, B; C \\ D')).toBe('A\\, B\\; C \\\\ D');
    expect(escapeText('Line1\r\nDTSTART:20300101')).toBe('Line1 DTSTART:20300101');
    expect(escapeText('x\u0000y\u001fz')).toBe('xyz');
  });

  it('escapes every semicolon (one backslash each) and treats NEL / LS / PS as line breaks, not text', () => {
    expect(escapeText(';;')).toBe('\\;\\;');
    expect(escapeText('a;b')).toBe(String.raw`a\;b`);
    for (const sep of ['\u0085', '\u2028', '\u2029']) {
      const out = escapeText(`one${sep}two`);
      expect(out).toBe('one two');
      expect(out).not.toContain(sep);
    }
  });

  it('folds at 75 octets with a leading space, never inside a UTF-8 character', () => {
    const long = `SUMMARY:${'é'.repeat(80)}`;
    const folded = foldLine(long);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const line of physical) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    for (const line of physical.slice(1)) expect(line.startsWith(' ')).toBe(true);
    expect(physical.join('').replace(/ /g, '')).toBe(long.replace(/ /g, ''));
    expect(foldLine('SHORT:line')).toBe('SHORT:line');
    const exactly75 = 'X'.repeat(75);
    expect(foldLine(exactly75)).toBe(exactly75);
    expect(foldLine('X'.repeat(76)).split('\r\n')).toHaveLength(2);
  });
});

describe('buildIcs', () => {
  const ics = buildIcs({
    name: 'Night Shift releases',
    releases: [
      rel('b-2', { title: 'Later, "Single"; x', releaseDate: '2026-12-01' }),
      rel('a-1', { title: 'Midnight Run', releaseDate: '2026-11-06' }),
      rel('c-3', { title: 'Only a target', targetDate: '2026-11-20' }),
      rel('d-4', { title: 'Cancelled', releaseDate: '2026-11-07', state: 'cancelled' }),
      rel('e-5', { title: 'No date' }),
    ],
  });

  it('is a CRLF-terminated VCALENDAR with only the dated, live releases, in date order', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
    expect(ics).not.toMatch(/Cancelled|No date/);
    const summaries = [...ics.matchAll(/SUMMARY:(.*)\r\n/g)].map((m) => m[1]);
    expect(summaries).toEqual(['Midnight Run', 'Only a target', 'Later\\, "Single"\\; x']);
  });

  it('writes all-day DATE values with an exclusive next-day end, stable UID and DTSTAMP', () => {
    expect(ics).toContain('UID:release-a-1@label-os\r\n');
    const keyed = buildIcs({ name: 'x', uidFor: (id) => `opaque-${id.length}@label-os`, releases: [rel('a-1', { releaseDate: '2026-11-06' })] });
    expect(keyed).toContain('UID:opaque-3@label-os\r\n');
    expect(keyed).not.toContain('a-1');
    expect(ics).toContain('DTSTAMP:20261001T083000Z\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261106\r\nDTEND;VALUE=DATE:20261107\r\n');
    expect(ics).toContain('STATUS:TENTATIVE'); // the target-only release
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('X-WR-CALNAME:Night Shift releases\r\n');
  });

  it('rolls month and year ends over', () => {
    const edge = buildIcs({ name: 'x', releases: [rel('z', { releaseDate: '2026-12-31' })] });
    expect(edge).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('is byte-identical when nothing changed (no churn for subscribers)', () => {
    const again = buildIcs({ name: 'Night Shift releases', releases: [rel('a-1', { releaseDate: '2026-11-06' })] });
    expect(again).toBe(buildIcs({ name: 'Night Shift releases', releases: [rel('a-1', { releaseDate: '2026-11-06' })] }));
  });

  it('carries titles and dates only: no description, location, url, attendee or organizer', () => {
    expect(ics).not.toMatch(/DESCRIPTION|LOCATION|URL|ATTENDEE|ORGANIZER|CONTACT|ATTACH/);
  });

  it('folds a long title and keeps every physical line within 75 octets', () => {
    const long = buildIcs({ name: 'x', releases: [rel('z', { title: 'Ö'.repeat(120), releaseDate: '2026-11-06' })] });
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    // Unfolding (CRLF + one space) restores the logical line.
    expect(long.replace(/\r\n /g, '')).toContain(`SUMMARY:${'Ö'.repeat(120)}`);
  });

  it('an empty calendar is still a valid one', () => {
    const empty = buildIcs({ name: 'x', releases: [] });
    expect(empty).toContain('BEGIN:VCALENDAR');
    expect(empty).not.toContain('VEVENT');
  });
});

describe('contract expiry events (LABEL-60)', () => {
  const contract = (over: Partial<import('./release-calendar').CalendarContract> = {}): import('./release-calendar').CalendarContract => ({
    id: 'c1',
    title: 'Nova recording agreement',
    status: 'signed',
    effectiveDate: '2026-01-01',
    termMonths: 12,
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  });
  const ics = (contracts: import('./release-calendar').CalendarContract[]) => buildIcs({ name: 'Releases', releases: [], contracts });

  it('is one all-day event on the last day of the term, with a month and a week reminder', () => {
    const body = ics([contract()]);
    expect(body).toContain('DTSTART;VALUE=DATE:20261231');
    expect(body).toContain('DTEND;VALUE=DATE:20270101');
    expect(body).toContain('SUMMARY:Contract ends: Nova recording agreement');
    expect(body).toContain('TRIGGER:-P30D');
    expect(body).toContain('TRIGGER:-P7D');
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('carries the title and the dates only: no party, no amount, no term length, no id', () => {
    const body = buildIcs({ name: 'Releases', releases: [], contracts: [contract({ id: 'secret-row-id' })], contractUidFor: () => 'opaque@label-os' });
    expect(body).not.toContain('secret-row-id');
    expect(body).not.toMatch(/12 months|term_months|advance|party/i);
    expect(ics([contract({ id: 'x1' })])).toContain('UID:contract-x1@label-os'); // the default, when the caller passes no opaque one
  });

  it('uses the opaque uid the feed passes', () => {
    const body = buildIcs({ name: 'Releases', releases: [], contracts: [contract()], contractUidFor: () => 'abc@label-os' });
    expect(body).toContain('UID:abc@label-os');
  });

  it('drafts, void contracts and contracts with no term are not on the calendar; sent ones are', () => {
    const body = ics([
      contract({ id: 'd', status: 'draft' }),
      contract({ id: 'v', status: 'void' }),
      contract({ id: 'n', termMonths: null }),
      contract({ id: 'e', effectiveDate: null }),
      contract({ id: 's', status: 'sent' }),
    ]);
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(body).toContain('contract-s@label-os');
  });

  it('escapes a title like any text and keeps the file stable', () => {
    const body = ics([contract({ title: 'A, B; C\nD' })]);
    expect(body).toContain('SUMMARY:Contract ends: A\\, B\\; C D');
    expect(ics([contract()])).toBe(ics([contract()]));
  });

  it('sits beside releases, in date order after them', () => {
    const body = buildIcs({
      name: 'Releases',
      releases: [{ id: 'r1', title: 'Single', releaseDate: '2026-12-01', targetDate: null, state: 'draft', updatedAt: '2026-10-01T00:00:00Z' }],
      contracts: [contract()],
    });
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body.indexOf('SUMMARY:Single')).toBeLessThan(body.indexOf('SUMMARY:Contract ends'));
  });
});
