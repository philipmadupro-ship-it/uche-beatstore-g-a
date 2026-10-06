// @vitest-environment jsdom

/**
 * The A&R inbox keyboard flow (LABEL-25, 07 §2.4) against a stubbed fetch:
 * J/K move, 1–5 rate (PUT my review), S/H/P/R move the stage only when the
 * transition table allows it (POST …/stage) and the row leaves the queue, C
 * opens the note, nothing fires while typing, a roster artist reads but cannot
 * rate, and the bulk bar moves the selected songs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { capabilitiesFor, type Capability, type Role } from '@/lib/labelos/capabilities';
import { useToastStore } from '@/hooks/useToast';
import { usePlayer } from '@/hooks/usePlayer';
import type { ArInbox, ArInboxSong } from '@/lib/labelos/ar-inbox-store';
import { OrgShellProvider, type OrgShellValue } from './OrgShellContext';
import { ArInboxView } from './ArInboxView';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const summary = { count: 0, rated: 0, average: null, verdicts: { shortlist: 0, hold: 0, pass: 0, changes_requested: 0 } };
const song = (id: string, title: string, stage: string): ArInboxSong => ({
  id, title, stage, cover_url: null, bpm: null, key: null, duration_seconds: null, created_at: '2026-10-01',
  artist: { id: 'c1', name: 'Nova' }, project: { id: 'p1', name: 'Nova EP' }, mine: null, summary,
});

function shell(role: Role, functions: string[] = []): OrgShellValue {
  return {
    org: { id: 'o1', name: 'Night Shift', slug: 'night-shift', kind: 'label' },
    role,
    scope: role === 'artist' ? 'artists' : 'org',
    capabilities: [...capabilitiesFor('label', role, functions)] as Capability[],
    viewerIsProducer: false,
  };
}

let db: ArInbox;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView = vi.fn();
  calls = [];
  db = { songs: [song('s1', 'Midnight', 'inbox'), song('s2', 'Dawn', 'in_review'), song('s3', 'Dusk', 'inbox')], restricted: 0, canReview: true };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b });
    let m: RegExpMatchArray | null;
    if ((m = url.match(/\/tracks\/([^/]+)\/stage$/))) {
      const s = db.songs.find((x) => x.id === m![1])!;
      s.stage = body.to;
      if (!['inbox', 'in_review'].includes(body.to)) db.songs = db.songs.filter((x) => x.id !== s.id);
      return json(200, { song: { id: s.id, stage: body.to }, from: body.from, to: body.to });
    }
    if ((m = url.match(/\/tracks\/([^/]+)\/reviews$/))) {
      if (method === 'PUT') {
        const s = db.songs.find((x) => x.id === m![1])!;
        s.mine = { rating: null, verdict: null, note: null, ...s.mine, ...body };
        return json(200, { review: s.mine });
      }
      return json(200, { reviews: [] });
    }
    return json(200, structuredClone(db));
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  usePlayer.setState({ currentTrack: null, isPlaying: false });
});

async function open(who: OrgShellValue = shell('member', ['a_and_r'])) {
  render(<OrgShellProvider value={who}><ArInboxView orgId="o1" orgSlug="night-shift" /></OrgShellProvider>);
  await screen.findByTestId('ar-list');
}
const key = (k: string, target: Element | Document = document) => fireEvent.keyDown(target, { key: k });
const rows = () => screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-song-row'));
const current = () => document.querySelector('[aria-current="true"]')?.getAttribute('data-song-row');
const puts = () => calls.filter((c) => c.method === 'PUT');
const stages = () => calls.filter((c) => c.url.endsWith('/stage'));

describe('the inbox', () => {
  it('lists the queue in order, spells keys out, and starts on the first song', async () => {
    await open();
    expect(rows().map((r) => r.getAttribute('data-song-row'))).toEqual(['s1', 's2', 's3']);
    expect(current()).toBe('s1');
    const hints = screen.getByTestId('ar-hints').textContent!;
    expect(hints).toContain('Space');
    expect(hints).not.toMatch(/[⇧⌥]/);
  });

  it('J and K move the cursor, stopping at the ends', async () => {
    await open();
    key('j'); await waitFor(() => expect(current()).toBe('s2'));
    key('j'); key('j'); await waitFor(() => expect(current()).toBe('s3'));
    key('k'); await waitFor(() => expect(current()).toBe('s2'));
    key('k'); key('k'); await waitFor(() => expect(current()).toBe('s1'));
  });

  it('1–5 save MY rating of the focused song', async () => {
    await open();
    key('j');
    await waitFor(() => expect(current()).toBe('s2'));
    key('4');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toMatchObject({ url: '/api/org/o1/tracks/s2/reviews', body: { rating: 4 } });
    await waitFor(() => expect(screen.getAllByTestId('ar-rate-4')[1].getAttribute('aria-pressed')).toBe('true'));
    key('6'); key('0');
    expect(puts()).toHaveLength(1);
  });

  it('S is refused from Inbox (the table has no such move); R then S works, and the row leaves', async () => {
    await open();
    key('s');
    expect(stages()).toHaveLength(0);
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.kind)).toContain('error'));
    key('r');
    await waitFor(() => expect(stages()).toHaveLength(1));
    expect(stages()[0].body).toEqual({ to: 'in_review', from: 'inbox' });
    await waitFor(() => expect(screen.getByTestId('ar-list')).toBeTruthy());
    expect(rows().map((r) => r.getAttribute('data-song-row'))).toContain('s1'); // still in the inbox stages

    key('s');
    await waitFor(() => expect(stages()).toHaveLength(2));
    expect(stages()[1].body).toEqual({ to: 'shortlisted', from: 'in_review' });
    await waitFor(() => expect(rows().map((r) => r.getAttribute('data-song-row'))).toEqual(['s2', 's3']));
    expect(current()).toBe('s2'); // the cursor moved on
  });

  it('a quick S right after R judges the song by its new stage, not the last fetch', async () => {
    await open();
    key('r');
    await waitFor(() => expect(stages()).toHaveLength(1));
    key('s'); // as soon as the first move has answered, before anything is refetched
    await waitFor(() => expect(stages()).toHaveLength(2));
    expect(stages()[1].body).toEqual({ to: 'shortlisted', from: 'in_review' });
  });

  it('H and P move an In review song; P is also legal from Inbox', async () => {
    await open();
    key('p');
    await waitFor(() => expect(stages()[0]?.body).toEqual({ to: 'passed', from: 'inbox' }));
    await waitFor(() => expect(current()).toBe('s2'));
    key('h');
    await waitFor(() => expect(stages()[1]?.body).toEqual({ to: 'on_hold', from: 'in_review' }));
  });

  it('Space plays the focused song through the org audio route', async () => {
    await open();
    key('j');
    key(' ');
    await waitFor(() => expect(usePlayer.getState().currentTrack?.id).toBe('s2'));
    expect(usePlayer.getState().currentTrack?.audio_url).toBe('/api/org/o1/audio/s2');
  });

  it('C opens the note, which saves on Ctrl+Enter and never fires the song keys while typing', async () => {
    await open();
    key('c');
    const note = (await screen.findByTestId('ar-note')) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: 'sjs 14 hook' } });
    for (const k of ['j', 'k', 's', 'p', '1', ' ']) key(k, note);
    expect(puts()).toHaveLength(0);
    expect(stages()).toHaveLength(0);
    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ note: 'sjs 14 hook' });
  });

  it('Escape abandons the note without saving', async () => {
    await open();
    key('c');
    const note = await screen.findByTestId('ar-note');
    fireEvent.change(note, { target: { value: 'x' } });
    fireEvent.keyDown(note, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('ar-note')).toBeNull());
    expect(puts()).toHaveLength(0);
  });

  it('X selects; the bulk bar moves the selected songs and reports what was refused', async () => {
    await open();
    key('x'); key('j'); key('j'); key('x');
    await waitFor(() => expect(screen.getByText(/2 songs/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Shortlist' }));
    // s1 and s3 are in Inbox: Inbox → Shortlisted is not a move, so nothing is sent and the bar says so.
    expect(stages()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }));
    await waitFor(() => expect(stages()).toHaveLength(2));
    expect(stages().map((c) => (c.body as { to: string }).to)).toEqual(['in_review', 'in_review']);
  });

  it('a modifier key keeps its browser meaning', async () => {
    await open();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    expect(current()).toBe('s1');
    expect(stages()).toHaveLength(0);
  });
});

describe('a roster artist', () => {
  it('reads the queue but has no rating buttons, no bulk bar, and the keys refuse', async () => {
    db.canReview = false;
    await open(shell('artist'));
    expect(screen.queryByTestId('ar-rate-3')).toBeNull();
    key('3');
    key('c');
    expect(puts()).toHaveLength(0);
    expect(screen.queryByTestId('ar-note')).toBeNull();
    expect(useToastStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
    key('x');
    expect(screen.queryByRole('button', { name: 'Shortlist' })).toBeNull();
  });
});

describe('empty and failed', () => {
  it('says nothing is waiting, and counts what is restricted without naming it', async () => {
    db = { songs: [], restricted: 2, canReview: true };
    render(<OrgShellProvider value={shell('member', ['marketing'])}><ArInboxView orgId="o1" orgSlug="night-shift" /></OrgShellProvider>);
    expect((await screen.findByTestId('ar-empty')).textContent).toMatch(/2 more songs are restricted/);
  });
});
