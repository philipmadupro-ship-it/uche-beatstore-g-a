import { describe, expect, it } from 'vitest';
import type { AttentionItem } from './attention';
import type { DigestEvent } from './digest';
import { MAX_ACTIVITY, MAX_ATTENTION, activityLines, slackLabel, slackText, slackUrl, buildWeeklyDigest, digestSince, dueMembers, isEmptyDigest, isoWeekKey, type WeeklyDigestContent } from './weekly-digest';

const item = (n: number, over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: `release:${n}`,
  kind: 'release',
  severity: 4,
  title: `EP ${n}`,
  artistName: 'Nova',
  detail: 'Artwork blocked for 3 days',
  person: { id: null, name: 'Sam' },
  people: [],
  action: { verb: 'Open', href: `/o/night-shift/releases/${n}` },
  dueDate: null,
  ...over,
});

const content = (over: Partial<WeeklyDigestContent> = {}): WeeklyDigestContent => ({ orgName: 'Night Shift', orgSlug: 'night-shift', attention: [item(1)], activity: [], ...over });

describe('isoWeekKey', () => {
  it.each([
    ['2026-10-12T07:00:00Z', '2026-W42'],
    ['2026-10-18T23:59:59Z', '2026-W42'], // Sunday is the end of the week
    ['2026-10-19T00:00:00Z', '2026-W43'],
    ['2026-01-01T12:00:00Z', '2026-W01'],
    ['2024-12-30T12:00:00Z', '2025-W01'], // the week that holds the first Thursday of 2025
    ['2021-01-03T12:00:00Z', '2020-W53'],
    ['2027-01-03T12:00:00Z', '2026-W53'],
  ])('%s is %s', (iso, key) => expect(isoWeekKey(new Date(iso))).toBe(key));

  it('is stable across one week and changes on Monday', () => {
    const days = Array.from({ length: 7 }, (_, i) => isoWeekKey(new Date(Date.UTC(2026, 9, 12 + i, 3))));
    expect(new Set(days).size).toBe(1);
    expect(isoWeekKey(new Date(Date.UTC(2026, 9, 19, 3)))).not.toBe(days[0]);
  });
});

describe('dueMembers', () => {
  it('takes opted-in members not yet sent this week, sorted', () => {
    const subs = [
      { userId: 'b', enabled: true, lastSentWeek: '' },
      { userId: 'a', enabled: true, lastSentWeek: '2026-W41' },
      { userId: 'c', enabled: true, lastSentWeek: '2026-W42' },
      { userId: 'd', enabled: false, lastSentWeek: '' },
    ];
    expect(dueMembers(subs, '2026-W42')).toEqual(['a', 'b']);
    expect(dueMembers(subs, '2026-W43')).toEqual(['a', 'b', 'c']);
  });
});

describe('digestSince', () => {
  it('is seven days back', () => expect(digestSince(new Date('2026-10-12T07:00:00Z'))).toBe('2026-10-05T07:00:00.000Z'));
});

describe('activityLines', () => {
  const ev = (over: Partial<DigestEvent>): DigestEvent => ({ id: 'e', verb: 'song.created', at: '2026-10-10T10:00:00Z', actorId: 'u1', artistId: 'c1', projectId: null, songId: null, releaseId: null, subjectId: 's1', summary: {}, ...over });

  it('names only what the loader handed over, and nothing for a missing name', () => {
    const lines = activityLines([ev({}), ev({ id: 'e2', subjectId: 's2', artistId: 'c9' })], { actors: { u1: 'Sam' }, artists: { c1: 'Nova' }, releases: {} });
    expect(lines.map((l) => l.artist)).toHaveLength(2);
    expect(lines.map((l) => l.artist)).toContain('Nova');
    expect(lines.map((l) => l.artist)).toContain(null);
    expect(lines.every((l) => l.actor === 'Sam')).toBe(true);
    expect(JSON.stringify(lines)).not.toContain('c9');
  });

  it('is empty for no events', () => expect(activityLines([], { actors: {}, artists: {}, releases: {} })).toEqual([]));
});

describe('isEmptyDigest', () => {
  it('needs both lists empty', () => {
    expect(isEmptyDigest({ attention: [], activity: [] })).toBe(true);
    expect(isEmptyDigest({ attention: [item(1)], activity: [] })).toBe(false);
    expect(isEmptyDigest({ attention: [], activity: [{ artist: null, actor: 'Sam', text: 'x' }] })).toBe(false);
  });
});

describe('buildWeeklyDigest', () => {
  const base = 'https://app.test/';

  it('links every item under /o/<slug> with an absolute URL, in text, html and Slack', () => {
    const m = buildWeeklyDigest(content(), base);
    const link = 'https://app.test/o/night-shift/releases/1';
    expect(m.text).toContain(link);
    expect(m.html).toContain(`href="${link}"`);
    expect(JSON.stringify(m.slack)).toContain(link);
    expect(m.subject).toBe('Night Shift: 1 item needs attention');
  });

  it('escapes html and slack control characters in names and titles', () => {
    const m = buildWeeklyDigest(content({ attention: [item(1, { title: '<img src=x onerror=1> & "q"', artistName: 'A|B' })] }), base);
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&lt;img');
    const slack = JSON.stringify(m.slack);
    expect(slack).not.toContain('<img');
    expect(slack).toContain('&lt;img');
  });

  it('caps each list and says how many more, without inventing a total of hidden things', () => {
    const attention = Array.from({ length: MAX_ATTENTION + 3 }, (_, i) => item(i + 1));
    const activity = Array.from({ length: MAX_ACTIVITY + 2 }, (_, i) => ({ artist: 'Nova', actor: 'Sam', text: `did thing ${i}` }));
    const m = buildWeeklyDigest(content({ attention, activity }), base);
    expect(m.text).toContain('and 3 more');
    expect(m.text).toContain('and 2 more');
    expect(m.text.match(/did thing/g)).toHaveLength(MAX_ACTIVITY);
  });

  it('carries only the sections it has', () => {
    const onlyActivity = buildWeeklyDigest(content({ attention: [], activity: [{ artist: null, actor: 'Sam', text: 'added a demo' }] }), base);
    expect(onlyActivity.text).not.toContain('NEEDS ATTENTION');
    expect(onlyActivity.subject).toBe('Night Shift: 1 update');
    expect(onlyActivity.text).toContain('Sam added a demo');
  });

  it('says how to turn it off', () => expect(buildWeeklyDigest(content(), base).text).toMatch(/Turn it off/));
});

describe('Slack text is inert', () => {
  const BAD = ['<!channel>', '<!here|everyone>', '<@U12345>', '<#C12345|general>', '<https://evil.test|click>', '<!subteam^S123>'];

  it.each(BAD)('%s cannot become a mention or a link in any field', (bad) => {
    const m = buildWeeklyDigest(
      content({
        orgName: `Org ${bad}`,
        attention: [item(1, { title: bad, artistName: bad, detail: bad })],
        activity: [{ artist: bad, actor: bad, text: bad }],
      }),
      'https://app.test',
    );
    const slack = JSON.stringify(m.slack);
    // No raw angle bracket survives except the ones WE build: <url|label> links.
    const withoutOurLinks = slack.replace(/<https:\/\/app\.test[^>|]*\|[^>]*>/g, '');
    expect(withoutOurLinks).not.toMatch(/<[!@#]/);
    expect(withoutOurLinks).not.toContain('<https://evil');
    expect(slack).not.toContain('<!');
    expect(m.slack.text).not.toContain('<');
    expect(m.slack.text).toContain('&lt;');
  });

  it('puts the escaped org name in the top-level text too', () => {
    expect(buildWeeklyDigest(content({ orgName: '<!channel> HQ' }), 'https://app.test').slack.text).toBe('&lt;!channel&gt; HQ: 1 item needs attention');
  });

  it('neutralises formatting characters and a pipe inside a link label', () => {
    expect(slackText('*bold* _it_ `code` ~gone~')).not.toMatch(/\*b|_i|`c|~g/);
    expect(slackText('a*b')).toBe('a*\u200bb');
    expect(slackLabel('a|b')).not.toContain('|');
    expect(slackUrl('https://x.test/a b|c>d')).not.toMatch(/[ |>]/);
  });

  it('clips the PLAIN text before building, so an entity or link is never cut in half', () => {
    const long = '&'.repeat(500);
    const t = slackText(long);
    expect(t).toBe('&amp;'.repeat(200));
    const m = buildWeeklyDigest(content({ attention: Array.from({ length: 8 }, (_, i) => item(i + 1, { title: long })) }), 'https://app.test');
    for (const b of m.slack.blocks as Array<{ text?: { text: string } }>) {
      const text = b.text?.text ?? '';
      expect(text.length).toBeLessThanOrEqual(3000);
      expect(text).not.toMatch(/&(?!amp;|lt;|gt;)/); // no entity cut mid-way
      expect((text.match(/</g) ?? []).length).toBe((text.match(/>/g) ?? []).length); // every link closed
    }
  });

  it('what does not fit is counted as "more", not cut', () => {
    const m = buildWeeklyDigest(content({ attention: Array.from({ length: 8 }, (_, i) => item(i + 1, { title: '&'.repeat(500) })) }), 'https://app.test');
    const section = (m.slack.blocks as Array<{ type: string; text?: { text: string } }>).find((b) => b.type === 'section')!.text!.text;
    expect(section).toMatch(/and \d+ more/);
  });
});
