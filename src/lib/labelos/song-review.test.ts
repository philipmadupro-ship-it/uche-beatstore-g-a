import { describe, expect, it } from 'vitest';
import {
  INBOX_STAGES,
  cursorAfterRemoval,
  REVIEW_VERDICTS,
  inboxKeyAction,
  mayReview,
  mergeReview,
  offeredStageKeys,
  sortInbox,
  summarizeReviews,
  validReview,
  type KeyInput,
} from './song-review';
import { capabilitiesFor } from './capabilities';

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, typing: false, ...extra });

describe('mergeReview', () => {
  it('keeps what the patch leaves out, replaces what it names, clears on null', () => {
    const mine = { rating: 4, verdict: 'shortlist' as const, note: 'hook' };
    expect(mergeReview(mine, { rating: 2 })).toEqual({ rating: 2, verdict: 'shortlist', note: 'hook' });
    expect(mergeReview(mine, { verdict: null })).toEqual({ rating: 4, verdict: null, note: 'hook' });
    expect(mergeReview(null, { note: '  thin mix  ' })).toEqual({ rating: null, verdict: null, note: 'thin mix' });
  });
  it('treats a blank note as no note', () => {
    expect(mergeReview({ rating: 3, verdict: null, note: 'x' }, { note: '   ' }).note).toBeNull();
  });
});

describe('validReview', () => {
  it('needs a rating, a verdict or a note', () => {
    expect(validReview({ rating: null, verdict: null, note: null })).toBe(false);
    expect(validReview({ rating: 1, verdict: null, note: null })).toBe(true);
    expect(validReview({ rating: null, verdict: 'hold', note: null })).toBe(true);
    expect(validReview({ rating: null, verdict: null, note: 'x' })).toBe(true);
  });
});

describe('mayReview', () => {
  const caps = (role: 'owner' | 'member' | 'artist', fns: string[] = []) => capabilitiesFor('label', role, fns as never);
  it('is review.write: A&R and owner yes; a roster artist, marketing, legal no', () => {
    expect(mayReview(caps('owner'))).toBe(true);
    expect(mayReview(caps('member', ['a_and_r']))).toBe(true);
    expect(mayReview(caps('artist'))).toBe(false);
    expect(mayReview(caps('member', ['marketing']))).toBe(false);
    expect(mayReview(caps('member', ['legal']))).toBe(false);
  });
});

describe('summarizeReviews', () => {
  it('averages the ratings that exist and counts verdicts', () => {
    const s = summarizeReviews([
      { rating: 4, verdict: 'shortlist' },
      { rating: 2, verdict: 'pass' },
      { rating: null, verdict: 'shortlist' },
    ]);
    expect(s).toEqual({ count: 3, rated: 2, average: 3, verdicts: { shortlist: 2, hold: 0, pass: 1, changes_requested: 0 } });
  });
  it('has no average without a rating', () => {
    expect(summarizeReviews([{ rating: null, verdict: 'hold' }]).average).toBeNull();
    expect(summarizeReviews([]).count).toBe(0);
  });
});

describe('sortInbox', () => {
  it('keeps inbox and in_review songs, oldest first, id as the tiebreak', () => {
    const rows = [
      { id: 'b', stage: 'inbox', created_at: '2026-01-02' },
      { id: 'x', stage: 'passed', created_at: '2026-01-01' },
      { id: 'c', stage: 'in_review', created_at: '2026-01-01' },
      { id: 'a', stage: 'inbox', created_at: '2026-01-01' },
    ];
    expect(sortInbox(rows).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(INBOX_STAGES).toEqual(['inbox', 'in_review']);
  });
});

describe('inboxKeyAction', () => {
  it('maps the documented keys', () => {
    expect(inboxKeyAction(key('j'))).toEqual({ kind: 'move', delta: 1 });
    expect(inboxKeyAction(key('K'))).toEqual({ kind: 'move', delta: -1 });
    expect(inboxKeyAction(key(' '))).toEqual({ kind: 'play' });
    expect(inboxKeyAction(key('1'))).toEqual({ kind: 'rate', value: 1 });
    expect(inboxKeyAction(key('5'))).toEqual({ kind: 'rate', value: 5 });
    expect(inboxKeyAction(key('s'))).toEqual({ kind: 'stage', to: 'shortlisted' });
    expect(inboxKeyAction(key('h'))).toEqual({ kind: 'stage', to: 'on_hold' });
    expect(inboxKeyAction(key('P'))).toEqual({ kind: 'stage', to: 'passed' });
    expect(inboxKeyAction(key('r'))).toEqual({ kind: 'stage', to: 'in_review' });
    expect(inboxKeyAction(key('c'))).toEqual({ kind: 'comment' });
    expect(inboxKeyAction(key('x'))).toEqual({ kind: 'select' });
  });
  it('ignores 0, 6–9, other keys, modifiers and typing', () => {
    for (const k of ['0', '6', '9', 'a', 'Enter', 'ArrowDown']) expect(inboxKeyAction(key(k))).toBeNull();
    expect(inboxKeyAction(key('j', { metaKey: true }))).toBeNull();
    expect(inboxKeyAction(key('j', { ctrlKey: true }))).toBeNull();
    expect(inboxKeyAction(key('j', { altKey: true }))).toBeNull();
    expect(inboxKeyAction(key('s', { typing: true }))).toBeNull();
    expect(inboxKeyAction(key(' ', { typing: true }))).toBeNull();
  });
});

describe('offeredStageKeys', () => {
  it('offers only the moves the transition table allows this member', () => {
    const ar = capabilitiesFor('label', 'member', ['a_and_r'] as never);
    expect(offeredStageKeys('inbox', ar)).toEqual(['in_review', 'passed']);
    expect(offeredStageKeys('in_review', ar)).toEqual(['shortlisted', 'passed', 'on_hold']);
    const marketing = capabilitiesFor('label', 'member', ['marketing'] as never);
    expect(offeredStageKeys('in_review', marketing)).toEqual([]);
    const artist = capabilitiesFor('label', 'artist', []);
    expect(offeredStageKeys('inbox', artist, 'artist')).toEqual(['in_review']);
  });
  it('has a verdict list that is the migration check', () => {
    expect(REVIEW_VERDICTS).toEqual(['shortlist', 'hold', 'pass', 'changes_requested']);
  });
});

describe('cursorAfterRemoval', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('stays put while the current row remains', () => {
    expect(cursorAfterRemoval(ids, 'b', new Set(['d']))).toBe('b');
  });
  it('moves to the next remaining row, skipping other removed rows', () => {
    expect(cursorAfterRemoval(ids, 'b', new Set(['b']))).toBe('c');
    expect(cursorAfterRemoval(ids, 'b', new Set(['b', 'c']))).toBe('d');
  });
  it('falls back to the previous row at the end, and to null when nothing is left', () => {
    expect(cursorAfterRemoval(ids, 'd', new Set(['d']))).toBe('c');
    expect(cursorAfterRemoval(ids, 'c', new Set(['c', 'd']))).toBe('b');
    expect(cursorAfterRemoval(['a'], 'a', new Set(['a']))).toBeNull();
  });
  it('starts at the first row without a cursor', () => {
    expect(cursorAfterRemoval(ids, null, new Set())).toBe('a');
    expect(cursorAfterRemoval([], null, new Set())).toBeNull();
  });
});
