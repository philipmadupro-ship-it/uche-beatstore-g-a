import { describe, expect, it } from 'vitest';
import {
  MAX_DESKTOP_BURST,
  desktopPrefEnabled,
  selectDesktopNotifications,
  setDesktopPref,
  summarizeBurst,
  type DesktopCandidate,
} from './desktop';

const n = (id: string, over: Partial<DesktopCandidate> = {}): DesktopCandidate => ({
  id,
  title: `Sale ${id}`,
  read: false,
  ...over,
});

describe('selectDesktopNotifications', () => {
  it('fires nothing on the priming pass', () => {
    // Otherwise opening the app detonates every notification in the table at
    // once — the single worst thing this feature could do.
    const r = selectDesktopNotifications([n('a'), n('b')], { seen: new Set(), primed: false });
    expect(r.fire).toEqual([]);
  });

  it('still records the priming batch as seen, so it never fires later', () => {
    const first = selectDesktopNotifications([n('a')], { seen: new Set(), primed: false });
    const second = selectDesktopNotifications([n('a')], { seen: first.seen, primed: true });
    expect(second.fire).toEqual([]);
  });

  it('fires a genuinely new notification once primed', () => {
    const first = selectDesktopNotifications([n('a')], { seen: new Set(), primed: false });
    const second = selectDesktopNotifications([n('b'), n('a')], { seen: first.seen, primed: true });
    expect(second.fire.map((x) => x.id)).toEqual(['b']);
  });

  it('is idempotent across polls — the same row never fires twice', () => {
    const primed = selectDesktopNotifications([], { seen: new Set(), primed: false });
    const once = selectDesktopNotifications([n('b')], { seen: primed.seen, primed: true });
    const twice = selectDesktopNotifications([n('b')], { seen: once.seen, primed: true });
    expect(once.fire.map((x) => x.id)).toEqual(['b']);
    expect(twice.fire).toEqual([]);
  });

  it('skips a notification already read elsewhere', () => {
    const primed = selectDesktopNotifications([], { seen: new Set(), primed: false });
    const r = selectDesktopNotifications([n('b', { read: true })], { seen: primed.seen, primed: true });
    expect(r.fire).toEqual([]);
    // …and it is marked seen, so marking it unread again does not resurrect it.
    expect(r.seen.has('b')).toBe(true);
  });

  it('fires oldest first, so the newest is the one left on screen', () => {
    const primed = selectDesktopNotifications([], { seen: new Set(), primed: false });
    // The API returns newest first.
    const r = selectDesktopNotifications([n('new'), n('old')], { seen: primed.seen, primed: true });
    expect(r.fire.map((x) => x.id)).toEqual(['old', 'new']);
  });

  it('does not mutate the seen set it was given', () => {
    const seen = new Set(['a']);
    selectDesktopNotifications([n('b')], { seen, primed: true });
    expect([...seen]).toEqual(['a']);
  });
});

describe('summarizeBurst', () => {
  it('passes a small batch through untouched', () => {
    const fire = [n('a'), n('b')];
    expect(summarizeBurst(fire)).toBe(fire);
  });

  it('collapses a large batch into one summary', () => {
    const fire = Array.from({ length: 11 }, (_, i) => n(String(i)));
    const out = summarizeBurst(fire);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('11 new notifications');
  });

  it('keeps the boundary case uncollapsed', () => {
    const fire = Array.from({ length: MAX_DESKTOP_BURST }, (_, i) => n(String(i)));
    expect(summarizeBurst(fire)).toHaveLength(MAX_DESKTOP_BURST);
  });
});

describe('desktopPrefEnabled', () => {
  const fakeStorage = (initial: Record<string, string> = {}): Storage => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  };

  it('is off until explicitly switched on', () => {
    expect(desktopPrefEnabled(fakeStorage())).toBe(false);
  });

  it('round-trips through storage', () => {
    const s = fakeStorage();
    setDesktopPref(true, s);
    expect(desktopPrefEnabled(s)).toBe(true);
    setDesktopPref(false, s);
    expect(desktopPrefEnabled(s)).toBe(false);
  });

  it('reads as off when storage throws, rather than crashing', () => {
    // Private windows and "block site data" throw on access, and a settings
    // page that explodes is worse than a feature that stays off.
    const hostile = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    } as unknown as Storage;
    expect(desktopPrefEnabled(hostile)).toBe(false);
    expect(() => setDesktopPref(true, hostile)).not.toThrow();
  });
});
