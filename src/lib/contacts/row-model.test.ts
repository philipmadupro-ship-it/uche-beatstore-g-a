import { describe, expect, it } from 'vitest';
import { sendTitleText, rolePatch, kindHint, nextSendPreset, recentSends, roleChoices, roleLine, roleName, sendPresetsFor, sentCountText, summarizeSends, tabLabelFor } from './row-model';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('roleLine', () => {
  it('main plus also-role', () => {
    expect(roleLine({ category: 'rapper', secondary_category: 'producer' })).toBe('Rapper · also Producer');
  });
  it('main alone, A&R and DJ keep their casing', () => {
    expect(roleLine({ category: 'a&r' })).toBe('A&R');
    expect(roleName('dj')).toBe('DJ');
    expect(roleLine({ category: 'press' })).toBe('Press');
  });
  it('ignores an extra role equal to the main one', () => {
    expect(roleLine({ category: 'producer', secondary_category: 'Producer' })).toBe('Producer');
  });
  it('falls back to the free-text role, then null', () => {
    expect(roleLine({ category: null, role: 'Mixing engineer' })).toBe('Mixing engineer');
    expect(roleLine({ category: null })).toBeNull();
  });
});

describe('kindHint', () => {
  it('says nothing for the no-signal kind and never uses a role word', () => {
    expect(kindHint('contact')).toBeNull();
    expect(kindHint('artist')).toBe('Has been sent music');
    expect(kindHint('buyer')).toBe('Has bought');
  });
});

describe('summarizeSends', () => {
  it('is empty with no sends', () => {
    const s = summarizeSends([], NOW);
    expect(s).toMatchObject({ count: 0, outcome: 'none', stale: false, lastAt: null });
    expect(sentCountText(s)).toBe('Nothing sent yet');
  });
  it('the latest send decides the outcome', () => {
    const s = summarizeSends([
      { sent_at: ago(20), status: 'interested', track_ids: ['a'] },
      { sent_at: ago(2), status: 'sent', opened_at: ago(1), track_ids: ['b', 'a'] },
    ], NOW);
    expect(s.outcome).toBe('opened');
    expect(s.tracks).toBe(2);
    expect(s.lastAt).toBe(ago(2));
    expect(sentCountText(s)).toBe('2 sends · 2 tracks');
  });
  it('a click outranks an open, a stored status outranks both', () => {
    expect(summarizeSends([{ sent_at: ago(1), opened_at: ago(1), link_clicked_at: ago(1) }], NOW).outcome).toBe('clicked');
    expect(summarizeSends([{ sent_at: ago(1), status: 'placed', opened_at: ago(1) }], NOW).outcome).toBe('placed');
    expect(summarizeSends([{ sent_at: ago(1), status: 'pass' }], NOW).outcomeLabel).toBe('Passed');
  });
  it('stale means unanswered and unopened past the nudge window', () => {
    expect(summarizeSends([{ sent_at: ago(9), status: 'sent' }], NOW).stale).toBe(true);
    expect(summarizeSends([{ sent_at: ago(3), status: 'sent' }], NOW).stale).toBe(false);
    expect(summarizeSends([{ sent_at: ago(9), status: 'sent', opened_at: ago(8) }], NOW).stale).toBe(false);
  });
});

describe('send presets follow the role', () => {
  it('artist, producer, label and other', () => {
    expect(nextSendPreset({ category: 'rapper' }).label).toBe('Send beats');
    expect(nextSendPreset({ category: 'producer' }).label).toBe('Send loops');
    expect(nextSendPreset({ category: 'a&r' }).label).toBe('Send toplines');
    expect(nextSendPreset({ category: 'buyer' }).label).toBe('Send tracks');
  });
  it('a two-role contact is offered both, main first, no duplicates', () => {
    expect(sendPresetsFor({ category: 'artist', secondary_category: 'producer' }).map((p) => p.id)).toEqual(['beats', 'loops']);
    expect(sendPresetsFor({ category: 'label' }).map((p) => p.id)).toEqual(['toplines', 'pack']);
  });
});

describe('roleChoices / tabLabelFor', () => {
  it('orders by tab group and names the landing tab', () => {
    const c = roleChoices(['press', 'producer', 'artist', 'a&r']);
    expect(c.map((x) => x.value)).toEqual(['artist', 'producer', 'a&r', 'press']);
    expect(c[2].label).toBe('A&R');
    expect(tabLabelFor('a&r')).toBe('Labels & A&R');
    expect(tabLabelFor('buyer')).toBe('Other contacts');
  });
});

describe('recentSends', () => {
  it('newest first, limited, stable on ties', () => {
    const rows = [
      { id: 'a', sent_at: ago(5) }, { id: 'b', sent_at: ago(1) }, { id: 'c', sent_at: ago(1) }, { id: 'd', sent_at: ago(9) },
    ];
    expect(recentSends(rows, 3).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0].id).toBe('a');
  });
});

describe('rolePatch', () => {
  it('sets the main role', () => {
    expect(rolePatch({ category: 'artist' }, 'producer')).toEqual({ category: 'producer' });
  });
  it('is a no-op for the current main role', () => {
    expect(rolePatch({ category: 'Producer' }, 'producer')).toBeNull();
    expect(rolePatch({ category: 'producer' }, '  ')).toBeNull();
  });
  it('promoting the extra role clears it so it is not shown twice', () => {
    expect(rolePatch({ category: 'artist', secondary_category: 'producer' }, 'producer')).toEqual({ category: 'producer', secondary_category: null });
  });
});

describe('sendTitleText', () => {
  const titles = new Map<string, string | null>([['a', 'Night Shift'], ['b', null]]);
  it('names the first known track and counts the rest', () => {
    expect(sendTitleText(['a'], titles)).toBe('Night Shift');
    expect(sendTitleText(['b', 'a', 'c'], titles)).toBe('Night Shift +2');
  });
  it('falls back to a count when no title is known, and to a plain note when empty', () => {
    expect(sendTitleText(['b', 'z'], titles)).toBe('2 tracks');
    expect(sendTitleText(['z'], titles)).toBe('1 track');
    expect(sendTitleText([], titles)).toBe('No tracks recorded');
    expect(sendTitleText(null, titles)).toBe('No tracks recorded');
  });
});
