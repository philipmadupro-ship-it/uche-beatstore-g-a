// @vitest-environment jsdom

/**
 * The release page (LABEL-33): tracklist controls call the right route with
 * the right body, delivery offers the override only to an owner, and a rights
 * detail the member may not read is never drawn. The rules are the server's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReleaseDetailView } from './ReleaseDetailView';
import type { ReleaseDetail } from '@/lib/labelos/release-detail-store';
import { RELEASE_GATES, type ReleaseGate } from '@/lib/labelos/release-readiness';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({ toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const ORG = 'org1';
const REL = 'rel1';
let calls: { url: string; method: string; body: unknown }[];
/** Every request, including the approvals panel's own read; `calls` leaves that one out so the page's actions are calls[0]. */
let everything: { url: string; method: string; body: unknown }[];
let reply: { status: number; body: unknown };
/** What GET …/master-options answers (the chooser's read); every other call answers `reply`. */
let optionsReply: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  everything = [];
  reply = { status: 200, body: {} };
  optionsReply = { status: 200, body: { songId: 's9', options: [{ id: 's9', relation: 'self', title: 'Extra' }], defaultId: null, ask: true } };
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    everything.push(call);
    if (!(call.method === 'GET' && url.includes('/approvals?'))) calls.push(call);
    if (url.includes('/master-options')) return { ok: optionsReply.status < 400, status: optionsReply.status, json: async () => optionsReply.body } as Response;
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as Response;
  });
  toast.success.mockReset();
  toast.error.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const gate = (status: string, blockers: { code: string; message: string }[] = [], withheld = 0) => ({
  status, blockerCount: blockers.length + withheld, warningCount: 0,
  blockers: blockers.map((b) => ({ ...b, fixCapability: 'release.write', itemId: null, songId: null, trackId: null })), warnings: [], withheld, approval: null,
});
const readiness = (over: Partial<Record<ReleaseGate, ReturnType<typeof gate>>> = {}, ready = false) => ({
  releaseState: 'draft',
  readyToDeliver: ready,
  gates: { ...Object.fromEntries(RELEASE_GATES.map((g) => [g, gate('satisfied')])), ...over } as never,
});
const detail = (over: Partial<ReleaseDetail> = {}): ReleaseDetail => ({
  release: {
    id: REL, projectId: 'p1', contactId: 'c1', title: 'Midnight EP', type: 'ep', upc: null, labelName: null, cLine: null, pLine: null, primaryGenre: null, distributor: null, territories: null, language: null,
    targetDate: null, releaseDate: null, artworkAssetId: null, state: 'draft', deliveredAt: null, deliveredTo: null, importedReleased: false,
    storeListed: false, storeListedAt: null, createdBy: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  },
  artist: { id: 'c1', name: 'Nova' },
  items: [
    { id: 'i1', position: 1, songId: 's1', title: 'Midnight', masterId: 'm1', ownMaster: false, versionTitle: null, explicit: false },
    { id: 'i2', position: 2, songId: 's2', title: 'Dawn', masterId: 's2', ownMaster: true, versionTitle: null, explicit: true },
    { id: 'i3', position: 3, songId: 's3', title: null, masterId: 's3', ownMaster: true, versionTitle: null, explicit: false },
  ],
  candidates: [{ id: 's9', title: 'Extra' }],
  readiness: readiness({ legal: gate('blocked', [{ code: 'x', message: 'Track 1: the split is open' }]) }),
  gatesSkipped: [],
  artwork: { current: null, options: [] },
  me: { canWrite: true, isOwner: false, canManagePublic: false, mayReadRights: true },
  ...over,
});
const mount = (d: ReleaseDetail) => render(<ReleaseDetailView orgId={ORG} orgSlug="ns" detail={d} />);

describe('the tracklist', () => {
  it('moves a track up with the whole new order, and refreshes', async () => {
    mount(detail());
    fireEvent.click(screen.getByLabelText('Move Dawn up'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: `/api/org/${ORG}/releases/${REL}/items`, method: 'PATCH', body: { order: ['i2', 'i1', 'i3'] } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('moves to an explicit position typed in the field', async () => {
    mount(detail());
    const field = screen.getByLabelText('Position of Midnight') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '3' } });
    fireEvent.blur(field);
    await waitFor(() => expect(calls[0]?.body).toEqual({ order: ['i2', 'i3', 'i1'] }));
  });

  it('the first cannot go up, the last cannot go down; a restricted song is not named', () => {
    mount(detail());
    expect((screen.getByLabelText('Move Midnight up') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Move track down') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Restricted song')).toBeTruthy();
  });

  it('removes and adds through the item routes; the server’s words are the toast on failure', async () => {
    mount(detail());
    fireEvent.click(screen.getByLabelText('Remove Dawn'));
    await waitFor(() => expect(calls[0]).toMatchObject({ url: `/api/org/${ORG}/releases/${REL}/items/i2`, method: 'DELETE' }));
    // The controls stay disabled (busy) until the first write has settled and the page refreshed: a click before then is ignored.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByLabelText('Remove Midnight') as HTMLButtonElement).disabled).toBe(false));
    reply = { status: 409, body: { error: 'The tracklist changed at the same time; reload and try again' } };
    fireEvent.click(screen.getByLabelText('Remove Midnight'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The tracklist changed at the same time; reload and try again'));
  });

  it('has no controls on a delivered release or for a member without release.write, and nothing draggable', () => {
    const delivered = detail();
    delivered.release.state = 'delivered';
    const { container } = mount(delivered);
    expect(screen.queryByLabelText('Move Midnight down')).toBeNull();
    expect(screen.queryByTestId('release-add-track')).toBeNull();
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    cleanup();
    mount(detail({ me: { canWrite: false, isOwner: false, canManagePublic: false, mayReadRights: true } }));
    expect(screen.queryByLabelText('Move Midnight down')).toBeNull();
  });
});

describe('the skipped-approval banner (LABEL-51)', () => {
  it('shows on a release when the owner switched legal approval off, naming credits & splits as still gating', () => {
    mount(detail({ gatesSkipped: ['legal'] }));
    const note = screen.getByTestId('release-gate-skipped');
    expect(note.textContent).toMatch(/Legal approval is switched off/);
    expect(note.textContent).toMatch(/Credits & splits still gate/);
  });
  it('shows on a delivered release too, but not on a cancelled one or with nothing skipped', () => {
    const base = detail().release;
    mount(detail({ gatesSkipped: ['legal'], release: { ...base, state: 'delivered' } }));
    expect(screen.getByTestId('release-gate-skipped').textContent).toMatch(/Legal approval is switched off/);
    cleanup();
    cleanup();
    mount(detail({ gatesSkipped: ['legal'], release: { ...base, state: 'cancelled' } }));
    expect(screen.queryByTestId('release-gate-skipped')).toBeNull();
    cleanup();
    mount(detail());
    expect(screen.queryByTestId('release-gate-skipped')).toBeNull();
  });
});

describe('the gates', () => {
  it('name what blocks each one in a popover', async () => {
    mount(detail());
    expect(screen.getByTestId('release-gate-chip-legal').textContent).toBe('Blocked');
    expect(screen.queryByTestId('release-gate-popover-legal')).toBeNull();
    fireEvent.click(screen.getByTestId('release-gate-open-legal'));
    const pop = await screen.findByTestId('release-gate-popover-legal');
    expect(pop.textContent).toMatch(/Track 1: the split is open/);
  });

  it('"Track has no ISRC" links to the metadata editor open on that recording (LABEL-53)', async () => {
    const g = gate('blocked');
    g.blockers = [{ code: 'isrc', message: 'Track 1 has no ISRC.', fixCapability: 'release.write', itemId: 'i1', songId: 's1', trackId: 'm1' } as never];
    g.blockerCount = 1;
    mount(detail({ readiness: readiness({ metadata: g }) }));
    fireEvent.click(screen.getByTestId('release-gate-open-metadata'));
    const link = await screen.findByTestId('release-fix-isrc-m1');
    expect(link.getAttribute('href')).toMatch(/\/songs\/s1\?edit=m1#details$/);
  });

  it('the ISRC link is shown only to someone who can write the release', async () => {
    const g = gate('blocked');
    g.blockers = [{ code: 'isrc', message: 'Track 1 has no ISRC.', fixCapability: 'release.write', itemId: 'i1', songId: 's1', trackId: 'm1' } as never];
    g.blockerCount = 1;
    mount(detail({ me: { canWrite: false, isOwner: false, canManagePublic: false, mayReadRights: true }, readiness: readiness({ metadata: g }) }));
    fireEvent.click(screen.getByTestId('release-gate-open-metadata'));
    await screen.findByTestId('release-gate-popover-metadata');
    expect(screen.queryByTestId('release-fix-isrc-m1')).toBeNull();
  });

  it('without rights.read says how many details are withheld, and names none', async () => {
    mount(detail({ me: { canWrite: true, isOwner: false, canManagePublic: false, mayReadRights: false }, readiness: readiness({ credits_splits: gate('blocked', [], 2) }) }));
    fireEvent.click(screen.getByTestId('release-gate-open-credits_splits'));
    const pop = await screen.findByTestId('release-gate-popover-credits_splits');
    expect(pop.textContent).not.toMatch(/Blocking/);
    expect(screen.getByTestId('release-gate-withheld').textContent).toMatch(/2 more items involve rights details/);
  });

  it('say so when a migration is missing', () => {
    mount(detail({ readiness: null }));
    expect(screen.getByTestId('release-gates').textContent).toMatch(/could not be worked out/);
  });
});

describe('approvals', () => {
  it('a draft release shows the five approvals to ask for and answer, and the page refreshes when one is decided', async () => {
    const gateRow = (g: string, label: string) => ({
      gate: g, label, status: 'requested', stale: false, changed: [], chip: { label: 'Awaiting approval', tone: 'waiting' }, decision: null,
      pending: { id: 'r1', gate: g, decision: 'requested', note: null, at: '2026-10-05T10:00:00Z', by: 'Ari', approver: 'Lena', approverId: 'u1' },
      canDecide: g === 'artwork', snapshotKey: g === 'artwork' ? 'k1' : null, selfApprovalBlocked: false, canRequest: false, approvers: [],
    });
    reply = { status: 200, body: { schemaReady: true, gates: ['master', 'artwork', 'legal', 'marketing', 'metadata'].map((g) => gateRow(g, g)) } };
    mount(detail());
    const approve = await screen.findByTestId('org-approval-approve');
    expect(everything[0].url).toBe(`/api/org/${ORG}/approvals?release=${REL}`);
    expect(screen.getAllByTestId(/^org-approval-(master|artwork|legal|marketing|metadata)$/)).toHaveLength(5);
    reply = { status: 201, body: { schemaReady: true, gates: [{ ...gateRow('artwork', 'artwork'), status: 'approved', pending: null }] } };
    fireEvent.click(approve);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(everything.find((c) => c.url.endsWith('/approvals/decide'))?.body).toMatchObject({ subject: { kind: 'release', id: REL }, gate: 'artwork', decision: 'approved', seen: 'k1' });
  });

  it('a delivered or cancelled release asks for nothing', () => {
    mount(detail({ release: { ...detail().release, state: 'delivered', deliveredAt: '2026-10-05T00:00:00Z', deliveredTo: 'DistroKid' } }));
    expect(everything.some((c) => c.url.includes('/approvals'))).toBe(false);
  });
});

describe('delivery', () => {
  const fill = (distributor = 'DistroKid') => fireEvent.change(screen.getByTestId('release-distributor'), { target: { value: distributor } });
  const deliverBtn = () => screen.getByTestId('release-deliver') as HTMLButtonElement;

  it('a ready release is delivered with the distributor and the date', async () => {
    mount(detail({ readiness: readiness({}, true) }));
    expect(deliverBtn().disabled).toBe(true);
    fill();
    fireEvent.change(screen.getByTestId('release-delivered-on'), { target: { value: '2026-10-12' } });
    fireEvent.click(deliverBtn());
    await waitFor(() => expect(calls[0]).toMatchObject({ url: `/api/org/${ORG}/releases/${REL}/deliver`, method: 'POST', body: { distributor: 'DistroKid', delivered_on: '2026-10-12' } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Release delivered'));
  });

  it('a blocked release cannot be delivered by a non-owner: no override control, a reason on the button', () => {
    mount(detail());
    fill();
    expect(screen.queryByTestId('release-override')).toBeNull();
    expect(deliverBtn().disabled).toBe(true);
    expect(screen.getByTestId('release-deliver-reason').textContent).toMatch(/Only an owner/);
  });

  it('an owner may override, but only with a reason; the override and note are what is sent', async () => {
    mount(detail({ me: { canWrite: true, isOwner: true, canManagePublic: true, mayReadRights: true } }));
    fill('Believe');
    expect(deliverBtn().disabled).toBe(true);
    fireEvent.click(screen.getByTestId('release-override'));
    expect(deliverBtn().textContent).toBe('Deliver anyway');
    expect(deliverBtn().disabled).toBe(true);
    fireEvent.change(screen.getByTestId('release-override-note'), { target: { value: 'Label signed off' } });
    expect(deliverBtn().disabled).toBe(false);
    fireEvent.click(deliverBtn());
    await waitFor(() => expect(calls[0].body).toEqual({ distributor: 'Believe', override: true, override_note: 'Label signed off' }));
  });

  it('shows the delivery once it happened, and offers nothing more', () => {
    const d = detail();
    d.release.state = 'delivered';
    d.release.deliveredTo = 'DistroKid';
    d.release.deliveredAt = '2026-10-12T12:00:00.000Z';
    mount(d);
    expect(screen.getByTestId('release-delivered').textContent).toMatch(/Delivered to DistroKid/);
    expect(screen.queryByTestId('release-deliver')).toBeNull();
  });

  it('an imported already-released release keeps an editable tracklist until it is on the store (LABEL-42)', () => {
    const d = detail();
    d.release.state = 'delivered';
    d.release.importedReleased = true;
    d.me.canManagePublic = true;
    mount(d);
    expect(screen.queryByTestId('release-tracklist-empty')).toBeNull();
    expect(screen.getAllByRole('button', { name: /remove|move/i }).length).toBeGreaterThan(0);
    cleanup();
    d.release.storeListed = true;
    mount(d);
    expect(screen.getByText(/Take this release off the store to change its tracklist/)).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /remove/i })).toHaveLength(0);
  });

  it('an A&R sees an imported release’s tracklist read-only, with the reason', () => {
    const d = detail();
    d.release.state = 'delivered';
    d.release.importedReleased = true;
    d.me.canManagePublic = false;
    mount(d);
    expect(screen.queryAllByRole('button', { name: /remove/i })).toHaveLength(0);
    expect(screen.getByText(/Only an owner or an admin can change the tracklist/)).toBeTruthy();
  });

  it('leaves the actions area open for other buttons', () => {
    render(<ReleaseDetailView orgId={ORG} orgSlug="ns" detail={detail()} extraActions={<a href="/x">Export</a>} />);
    expect(within(screen.getByTestId('release-actions')).getByText('Export')).toBeTruthy();
  });
});

describe('withdrawing a delivered release (LABEL-56)', () => {
  const out = (over: Partial<ReleaseDetail['release']> = {}, me: Partial<ReleaseDetail['me']> = {}) => {
    const d = detail({ me: { ...detail().me, ...me } });
    d.release = { ...d.release, state: 'delivered', deliveredTo: 'DistroKid', deliveredAt: '2026-10-12T12:00:00.000Z', ...over };
    return d;
  };

  it('a delivered release offers Withdraw, not Cancel, and asks first with an optional reason', async () => {
    mount(out());
    expect(screen.queryByText('Cancel release')).toBeNull();
    expect(screen.queryByTestId('release-withdraw-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('release-withdraw-open'));
    expect(screen.getByTestId('release-withdraw-panel').textContent).toMatch(/not cancelled or deleted/);
    fireEvent.change(screen.getByTestId('release-withdraw-note'), { target: { value: '  wrong master ' } });
    fireEvent.click(screen.getByTestId('release-withdraw'));
    await waitFor(() => expect(calls[0]).toMatchObject({ url: `/api/org/${ORG}/releases/${REL}/withdraw`, method: 'POST', body: { note: 'wrong master' } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Release withdrawn'));
  });

  it('says it also comes off the store when it is listed, and "Keep it delivered" sends nothing', () => {
    mount(out({ storeListed: true }));
    fireEvent.click(screen.getByTestId('release-withdraw-open'));
    expect(screen.getByTestId('release-withdraw-panel').textContent).toMatch(/comes off the store/);
    fireEvent.click(screen.getByTestId('release-withdraw-cancel'));
    expect(screen.queryByTestId('release-withdraw-panel')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('shows the server’s words when it refuses', async () => {
    reply = { status: 503, body: { error: 'Withdrawing a release needs migration 193 applied on Supabase.' } };
    mount(out());
    fireEvent.click(screen.getByTestId('release-withdraw-open'));
    fireEvent.click(screen.getByTestId('release-withdraw'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/migration 193/)));
    expect(screen.getByTestId('release-withdraw-panel')).toBeTruthy();
  });

  it('no Withdraw without release.write, and none on a draft or a withdrawn release', () => {
    mount(out({}, { canWrite: false }));
    expect(screen.queryByTestId('release-withdraw-open')).toBeNull();
    cleanup();
    mount(detail());
    expect(screen.queryByTestId('release-withdraw-open')).toBeNull();
    cleanup();
    mount(out({ state: 'withdrawn' }));
    expect(screen.queryByTestId('release-withdraw-open')).toBeNull();
    expect(screen.getByTestId('release-state').textContent).toMatch(/Withdrawn/);
    expect(screen.getByTestId('release-withdrawn').textContent).toMatch(/then withdrawn/);
  });
});

describe('the export and calendar controls (LABEL-34)', () => {
  it('release.write sees the export buttons, the rights note and the calendar link, and drawing them requests nothing', () => {
    mount(detail());
    const actions = screen.getByTestId('release-actions');
    expect(within(actions).getByRole('button', { name: 'Download CSV' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: 'Download JSON' })).toBeTruthy();
    expect(within(actions).getByText('Credits are included only if you have rights access.')).toBeTruthy();
    expect(within(actions).getByRole('button', { name: 'Calendar link' })).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('a member without release.write sees none of it', () => {
    mount(detail({ me: { canWrite: false, isOwner: false, canManagePublic: false, mayReadRights: false } }));
    const actions = screen.getByTestId('release-actions');
    expect(within(actions).queryByRole('button', { name: 'Download CSV' })).toBeNull();
    expect(within(actions).queryByRole('button', { name: 'Calendar link' })).toBeNull();
  });

  it('a delivered release can still be exported (it is a copy of facts, not an edit)', () => {
    const d = detail();
    d.release.state = 'delivered';
    mount(d);
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeTruthy();
  });
});

const pickSong = async (title: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Song to add' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('option', { name: title }));
  });
};

describe('the master chooser (LABEL-55)', () => {
  it('the single linked master is selected for you and goes with the add', async () => {
    optionsReply = {
      status: 200,
      body: { songId: 's9', defaultId: 'm9', ask: false, options: [{ id: 'm9', relation: 'master', title: 'Extra (master)' }, { id: 's9', relation: 'self', title: 'Extra' }] },
    };
    mount(detail());
    await pickSong('Extra');
    await waitFor(() => expect(screen.getByTestId('release-master-choice').getAttribute('data-ask')).toBe('false'));
    expect(calls[0]).toMatchObject({ method: 'GET', url: `/api/org/${ORG}/releases/${REL}/master-options?song_track_id=s9` });
    expect(screen.getByTestId('release-master-hint').textContent).toBe('Its linked master is selected.');
    expect((screen.getByTestId('release-add-submit') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('release-add-submit'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: `/api/org/${ORG}/releases/${REL}/items`, body: { song_track_id: 's9', master_track_id: 'm9' } });
  });

  it('with several masters, or none, Add waits until one is chosen — nothing is guessed', async () => {
    optionsReply = {
      status: 200,
      body: { songId: 's9', defaultId: null, ask: true, options: [{ id: 'm1', relation: 'master', title: 'Mix A' }, { id: 'm2', relation: 'master', title: 'Mix B' }, { id: 's9', relation: 'self', title: 'Extra' }] },
    };
    mount(detail());
    await pickSong('Extra');
    await waitFor(() => expect(screen.getByTestId('release-master-choice').getAttribute('data-ask')).toBe('true'));
    expect(screen.getByTestId('release-master-hint').textContent).toMatch(/more than one recording/);
    expect((screen.getByTestId('release-add-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Master recording' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Mix B/ }));
    });
    expect((screen.getByTestId('release-add-submit') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('release-add-submit'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ song_track_id: 's9', master_track_id: 'm2' }));
  });

  it('a song with no linked master says the masters gate stays open on its own mix', async () => {
    mount(detail());
    await pickSong('Extra');
    await waitFor(() => expect(screen.getByTestId('release-master-hint').textContent).toMatch(/No master is linked/));
    expect((screen.getByTestId('release-add-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a refused read of the options is shown, and nothing can be added', async () => {
    optionsReply = { status: 404, body: { error: 'Not found' } };
    mount(detail());
    await pickSong('Extra');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Not found'));
    expect((screen.getByTestId('release-add-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('changes the master from the row: the options are read when it opens, the current one is marked, and the edit is a PATCH of the item', async () => {
    optionsReply = {
      status: 200,
      body: { songId: 's1', defaultId: 'm1', ask: false, options: [{ id: 'm1', relation: 'master', title: 'Midnight (master)' }, { id: 's1', relation: 'self', title: 'Midnight' }] },
    };
    mount(detail());
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByTestId('release-item-master-i1'));
    const current = await screen.findByTestId('release-item-master-option-m1');
    expect(current.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('release-item-master-option-s1'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: `/api/org/${ORG}/releases/${REL}/items/i1`, body: { master_track_id: 's1' } });
  });

  it('marks a track explicit from its row', async () => {
    mount(detail());
    fireEvent.click(screen.getByTestId('release-item-explicit-i1'));
    await waitFor(() => expect(calls[0]).toMatchObject({ url: `/api/org/${ORG}/releases/${REL}/items/i1`, method: 'PATCH', body: { explicit: true } }));
  });

  it('offers neither the chooser nor the row controls to a member who cannot write', () => {
    mount(detail({ me: { canWrite: false, isOwner: false, canManagePublic: false, mayReadRights: true } }));
    expect(screen.queryByTestId('release-add-track')).toBeNull();
    expect(screen.queryByTestId('release-item-master-i1')).toBeNull();
    expect(screen.queryByTestId('release-item-explicit-i1')).toBeNull();
  });
});

describe('the details (LABEL-55)', () => {
  const edit = async (testId: string, value: string) => {
    const field = screen.getByTestId(testId);
    fireEvent.click(within(field).getByRole('button'));
    const input = within(field).getByRole('textbox');
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('territories are typed as codes and sent as a list; language and distributor as text', async () => {
    mount(detail());
    await edit('release-field-territories', 'us gb');
    await waitFor(() => expect(calls[0]).toMatchObject({ method: 'PATCH', url: `/api/org/${ORG}/releases/${REL}`, body: { territories: ['US', 'GB'] } }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await edit('release-field-language', 'PT-br');
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ language: 'pt-BR' }));
    await edit('release-field-distributor', 'DistroKid');
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ distributor: 'DistroKid' }));
  });

  it('a territory that is not a country code is refused on the page, before anything is sent', async () => {
    mount(detail());
    await edit('release-field-territories', 'US, USA');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('“USA” is not a two-letter country code (use WW for worldwide).'));
    expect(calls).toEqual([]);
  });

  it('a UPC the server refuses is its words in a toast', async () => {
    reply = { status: 400, body: { error: 'upc: not a valid UPC/EAN (12 or 13 digits with a valid check digit)' } };
    mount(detail());
    await edit('release-field-upc', '123456789012');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('upc: not a valid UPC/EAN (12 or 13 digits with a valid check digit)'));
  });

  it('are read-only for a member who cannot write', () => {
    mount(detail({ me: { canWrite: false, isOwner: false, canManagePublic: false, mayReadRights: true } }));
    expect(within(screen.getByTestId('release-field-territories')).queryByRole('button')).toBeNull();
  });
});
