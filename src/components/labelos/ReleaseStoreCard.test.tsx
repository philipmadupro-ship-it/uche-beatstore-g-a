// @vitest-environment jsdom

/**
 * The release's "On the store" card (LABEL-42): it offers listing only where
 * the server says it can apply, says why when it cannot, asks about deleting
 * previews only when the server says the owner has that choice, and sends the
 * playback the member picked.
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReleaseStoreCard } from './ReleaseStoreCard';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const confirmToast = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({ toast, confirmToast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

let calls: { url: string; method: string; body: unknown }[];
let state: Record<string, unknown>;

const base = {
  listed: false, listedAt: null, playback: 'preview', playbackChoice: true,
  canList: { ok: true }, unlist: { askToDeletePreviews: false },
};

beforeEach(() => {
  calls = [];
  state = { ...base };
  confirmToast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { ok: true, status: 200, json: async () => (method === 'GET' ? state : { listed: true, playback: 'full', promoted: 0 }) } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (canWrite = true, canManagePublic = true, imported = false) =>
  render(<ReleaseStoreCard orgId="o1" releaseId="r1" canWrite={canWrite} canManagePublic={canManagePublic} imported={imported} />);

describe('ReleaseStoreCard', () => {
  it('lists with the playback the member picked', async () => {
    mount();
    await screen.findByTestId('release-store');
    fireEvent.click(screen.getByTestId('release-store-playback-full'));
    fireEvent.click(screen.getByTestId('release-store-list'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/org/o1/releases/r1/store', body: { listed: true, playback: 'full' } });
  });


  it('a slow second load never undoes the playback the member already picked', async () => {
    // Under StrictMode (dev) the mount effect runs twice: the first answer draws the card, and the
    // second, slower one lands AFTER the member clicked "full". It used to reset the choice to the
    // server's value, so "Put on the store" listed with the wrong playback (found by e2e under load).
    let release: (() => void) | null = null;
    let gets = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'GET' && ++gets === 2) await new Promise<void>((resolve) => { release = resolve; });
      return { ok: true, status: 200, json: async () => (method === 'GET' ? state : { listed: true, playback: 'full', promoted: 0 }) } as Response;
    });
    render(
      <StrictMode>
        <ReleaseStoreCard orgId="o1" releaseId="r1" canWrite canManagePublic imported={false} />
      </StrictMode>,
    );
    await screen.findByTestId('release-store');
    fireEvent.click(screen.getByTestId('release-store-playback-full'));
    await waitFor(() => expect(release).not.toBeNull());
    release!();
    await waitFor(() => expect(gets).toBe(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('release-store-playback-full').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('release-store-list'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ playback: 'full' });
  });

  it('draws nothing where the org can never list (a label-owned release)', async () => {
    state = { ...base, canList: { ok: false, error: 'nope', field: 'org' } };
    mount();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId('release-store')).toBeNull();
  });

  it('says why an unreleased release cannot be listed, and offers no button', async () => {
    state = { ...base, canList: { ok: false, error: 'Only a released release can be listed', field: 'state' } };
    mount();
    expect((await screen.findByTestId('release-store-blocked')).textContent).toMatch(/released release/);
    expect(screen.queryByTestId('release-store-list')).toBeNull();
  });

  it('unlisting music that was out asks nothing and keeps the previews', async () => {
    state = { ...base, listed: true, unlist: { askToDeletePreviews: false } };
    mount();
    fireEvent.click(await screen.findByTestId('release-store-unlist'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(confirmToast).not.toHaveBeenCalled();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ listed: false, delete_previews: false });
  });

  it('unlisting music that was never out asks the owner, and sends the answer', async () => {
    state = { ...base, listed: true, unlist: { askToDeletePreviews: true } };
    confirmToast.mockResolvedValue(true);
    mount();
    fireEvent.click(await screen.findByTestId('release-store-unlist'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(confirmToast).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ listed: false, delete_previews: true });
  });

  it('a member who cannot write sees the state and no buttons', async () => {
    state = { ...base, listed: true };
    mount(false);
    expect((await screen.findByTestId('release-store-state')).textContent).toMatch(/Listed/);
    expect(screen.queryByTestId('release-store-unlist')).toBeNull();
  });

  it('an A&R cannot choose full songs: the button is off and says why', async () => {
    mount(true, false);
    await screen.findByTestId('release-store');
    expect((screen.getByTestId('release-store-playback-full') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('release-store-full-locked')).toBeTruthy();
    expect((screen.getByTestId('release-store-playback-preview') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an imported release is the owner’s: an A&R sees the reason and no list / unlist button', async () => {
    state = { ...base, listed: true };
    mount(true, false, true);
    expect((await screen.findByTestId('release-store-owner-only')).textContent).toMatch(/only an owner or an admin/);
    expect(screen.queryByTestId('release-store-unlist')).toBeNull();
    expect(screen.queryByTestId('release-store-list')).toBeNull();
    cleanup();
    mount(true, true, true);
    expect(await screen.findByTestId('release-store-unlist')).toBeTruthy();
  });

  it('a non-manager never starts on a disabled "full": an unlisted release with a stale full shows preview selected', async () => {
    state = { ...base, listed: false, playback: 'full' };
    mount(true, false);
    await screen.findByTestId('release-store');
    expect(screen.getByTestId('release-store-playback-preview').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('release-store-playback-full').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('release-store-list'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ listed: true, playback: 'preview' });
  });

  describe('artist consent (LABEL-71)', () => {
    const consent = (over: Record<string, unknown> = {}) => ({
      schemaReady: true,
      status: 'waiting',
      artists: [
        { contactId: 'c1', name: 'Nova', state: 'proposed', decidedAt: null, mine: false },
        { contactId: 'c2', name: 'Feat', state: 'yes', decidedAt: '2026-10-02', mine: false },
      ],
      ...over,
    });

    it('shows each artist in the viewer’s scope with where they stand, and what that means for the release', async () => {
      state = { ...base, listed: true, consent: consent() };
      mount();
      const block = await screen.findByTestId('release-store-consent');
      expect(block.getAttribute('data-status')).toBe('waiting');
      expect(block.textContent).toMatch(/Nova/);
      expect(block.textContent).toMatch(/an artist’s no takes it off at once/);
      expect(screen.getAllByTestId('release-store-consent-artist').map((e) => e.getAttribute('data-state'))).toEqual(['proposed', 'yes']);
      // Nobody but the artist has Yes / No buttons.
      expect(screen.queryByTestId('release-store-consent-no')).toBeNull();
    });

    it('the artist’s own row has the buttons; a no is confirmed and sent as { decision: "no" }', async () => {
      confirmToast.mockResolvedValue(true);
      state = { ...base, listed: true, consent: consent({ artists: [{ contactId: 'c1', name: 'Nova', state: 'proposed', decidedAt: null, mine: true }] }) };
      mount(false, false);
      fireEvent.click(await screen.findByTestId('release-store-consent-no'));
      await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/org/o1/releases/r1/consent', body: { decision: 'no' } });
    });

    it('a refused release says so, and offers no way around it', async () => {
      state = {
        ...base,
        listed: false,
        canList: { ok: false, error: 'An artist on this release has said no to the store. It can be listed again once they say yes.', field: 'consent' },
        consent: consent({ status: 'refused', artists: [{ contactId: 'c1', name: 'Nova', state: 'no', decidedAt: '2026-10-02', mine: false }] }),
      };
      mount();
      expect((await screen.findByTestId('release-store-blocked')).textContent).toMatch(/said no/);
      expect(screen.getByTestId('release-store-consent').textContent).toMatch(/stays off the store until they say yes/);
      expect(screen.queryByTestId('release-store-list')).toBeNull();
    });

    it('after listing, says how many artists were asked and how many nobody could tell', async () => {
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return { ok: true, status: 200, json: async () => (method === 'GET' ? state : { listed: true, playback: 'preview', promoted: 1, consent: { schemaReady: true, asked: 2, notified: 1, unreachable: 1, status: 'waiting' } }) } as Response;
      });
      mount();
      fireEvent.click(await screen.findByTestId('release-store-list'));
      const note = await screen.findByTestId('release-store-asked');
      expect(note.textContent).toMatch(/2 artists were asked/);
      expect(note.textContent).toMatch(/1 has no account in this organization, so nobody could be told/);
    });

    it('the store owner’s veto is stated', async () => {
      state = { ...base, listed: false, vetoed: true };
      mount();
      expect((await screen.findByTestId('release-store-vetoed')).textContent).toMatch(/store owner has taken this release off/);
    });
  });
});

