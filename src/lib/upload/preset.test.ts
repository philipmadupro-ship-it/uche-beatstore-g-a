import { describe, expect, it, vi } from 'vitest';
import { applyUploadPreset, presetCount, toggleUploadTag, EMPTY_PRESET, type UploadPreset } from './preset';

const res = (status = 200, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const preset: UploadPreset = {
  status: 'finished',
  tags: [{ tag: 'Ready to send', category: 'status' }, { tag: 'Dark', category: 'mood' }],
  destination: { kind: 'project', id: 'p1', name: 'Demo' },
};

describe('presetCount / toggleUploadTag', () => {
  it('counts every thing the preset will do', () => {
    expect(presetCount(EMPTY_PRESET)).toBe(0);
    expect(presetCount(preset)).toBe(4);
  });
  it('toggles a tag on and off, ignoring case', () => {
    const on = toggleUploadTag([], { tag: 'Dark', category: 'mood' });
    expect(on).toHaveLength(1);
    expect(toggleUploadTag(on, { tag: 'dark', category: 'mood' })).toEqual([]);
  });
});

describe('applyUploadPreset', () => {
  it('writes status, each tag and the destination for the new track', async () => {
    const f = vi.fn((_url: string, _init?: RequestInit) => res(200, { added: 1 }));
    const r = await applyUploadPreset('t 1', preset, { fetchImpl: f as never });
    expect(r.failed).toEqual([]);
    const calls = f.mock.calls.map((c) => [c[0], (c[1] as RequestInit).method, (c[1] as RequestInit).body]);
    expect(calls).toEqual([
      ['/api/tracks/t%201', 'PATCH', JSON.stringify({ status: 'finished' })],
      ['/api/tracks/t%201/tags', 'POST', JSON.stringify({ tag: 'Ready to send', category: 'status' })],
      ['/api/tracks/t%201/tags', 'POST', JSON.stringify({ tag: 'Dark', category: 'mood' })],
      ['/api/projects/p1/tracks', 'POST', JSON.stringify({ track_ids: ['t 1'] })],
    ]);
  });

  it('does nothing for an empty preset', async () => {
    const f = vi.fn();
    expect(await applyUploadPreset('t', EMPTY_PRESET, { fetchImpl: f as never })).toEqual({ failed: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it('skips the destination when the page already uploads into one', async () => {
    const f = vi.fn((_url: string, _init?: RequestInit) => res());
    await applyUploadPreset('t', preset, { skipDestination: true, fetchImpl: f as never });
    expect(f.mock.calls.some((c) => String(c[0]).includes('/projects/'))).toBe(false);
  });

  it('keeps going after a failure and names what failed', async () => {
    const f = vi.fn((url: string, _init?: RequestInit) => (url.endsWith('/tags') ? res(500) : res()));
    const r = await applyUploadPreset('t', preset, { fetchImpl: f as never });
    expect(r.failed).toEqual(['tag “Ready to send”', 'tag “Dark”']);
    expect(f.mock.calls.some((c) => String(c[0]).includes('/projects/'))).toBe(true);
  });
});
