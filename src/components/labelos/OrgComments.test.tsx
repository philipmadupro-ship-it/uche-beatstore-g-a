// @vitest-environment jsdom

/**
 * The org comments panel (LABEL-22): carry-forward is labelled where it
 * shows ("from mix v2") and only what the server sent is shown; resolved
 * threads are folded away until asked for; the "Team only" control exists
 * only for someone who may write a team-only note; a pin follows the
 * playhead; nothing opens a modal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { usePlayer } from '@/hooks/usePlayer';
import type { OrgComment } from '@/lib/labelos/org-comments';
import { OrgComments } from './OrgComments';

const ORG = '10000000-0000-4000-8000-000000000001';
const P = '40000000-0000-4000-8000-0000000000a1';
const V3 = '50000000-0000-4000-8000-000000000003';
const S1 = '50000000-0000-4000-8000-000000000001';

const c = (id: string, extra: Partial<OrgComment> = {}): OrgComment => ({
  id, projectId: P, trackId: V3, parentId: null, body: `body ${id}`, authorName: 'Dana', mine: false, regionStart: null, regionEnd: null,
  visibility: 'artist', resolvedAt: null, editedAt: null, createdAt: `2026-10-01T10:0${id}:00Z`, carriedFrom: null,
  can: { edit: !!extra.mine, delete: !!extra.mine, changeVisibility: !!extra.mine }, ...extra,
});

type Payload = { schemaReady?: boolean; comments: OrgComment[]; me: { canComment: boolean; canPostInternal: boolean }; version?: { label: string; current: boolean } | null };
let payload: Payload;
const fetchMock = vi.fn();

beforeEach(() => {
  payload = {
    schemaReady: true,
    me: { canComment: true, canPostInternal: true },
    version: { label: 'mix v3', current: true },
    comments: [
      c('1', { body: 'Vocal too bright', trackId: S1, regionStart: 12.5, regionEnd: 20, carriedFrom: { trackId: S1, label: 'mix v1' } }),
      c('2', { body: 'Reply to the vocal note', parentId: '1', trackId: S1, carriedFrom: { trackId: S1, label: 'mix v1' } }),
      c('3', { body: 'Clear the sample first', visibility: 'internal' }),
      c('4', { body: 'Great latest mix', mine: true }),
      c('5', { body: 'Bass sorted', resolvedAt: '2026-10-05T00:00:00Z' }),
    ],
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PATCH' || init?.method === 'DELETE') return new Response(JSON.stringify({ comment: {} }), { status: 200 });
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  usePlayer.setState({ currentTrack: null, isPlaying: false, progress: 0, seekTarget: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderPanel = (props: Partial<React.ComponentProps<typeof OrgComments>> = {}) =>
  render(<OrgComments orgId={ORG} projectId={P} trackId={V3} durationSeconds={200} pollMs={0} {...props} />);

describe('OrgComments', () => {
  it('asks for this recording’s list and shows the version it is', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/org/${ORG}/projects/${P}/comments?trackId=${V3}`); // no picker list unless asked
    expect(screen.getByText(/mix v3 · current/)).toBeTruthy();
  });

  it('labels carried threads “from mix v1”, with their reply in the same thread, and the native ones plain', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    const carried = screen.getAllByTestId('carried-label');
    expect(carried.map((n) => n.textContent)).toEqual(['from mix v1', 'from mix v1']); // root + its reply
    const thread = screen.getByTestId('thread-1');
    expect(within(thread).getByText('Vocal too bright')).toBeTruthy();
    expect(within(thread).getByText('Reply to the vocal note')).toBeTruthy();
    expect(within(screen.getByTestId('thread-4')).queryByTestId('carried-label')).toBeNull();
  });

  it('a team-only comment says so; resolved threads are folded away until asked for', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    expect(within(screen.getByTestId('thread-3')).getByTestId('internal-chip').textContent).toContain('Team only');
    expect(screen.queryByTestId('thread-5')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show resolved \(1\)/ }));
    expect(screen.getByTestId('thread-5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Hide resolved/ }));
    expect(screen.queryByTestId('thread-5')).toBeNull();
  });

  it('the “Team only” control exists only for someone who may write a team-only note', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    expect(screen.getByLabelText('Team only')).toBeTruthy();
    cleanup();
    // The server gives no visibility toggle to someone who cannot write a team-only note.
    payload = { ...payload, me: { canComment: true, canPostInternal: false }, comments: payload.comments.map((x) => ({ ...x, can: { ...x.can, changeVisibility: false } })) };
    renderPanel();
    await screen.findByTestId('org-comments');
    expect(screen.queryByLabelText('Team only')).toBeNull();
    expect(screen.queryByRole('button', { name: /Make team only/ })).toBeNull();
  });

  it('Edit / Delete / visibility show exactly where the server said the caller may — an admin gets them on someone else’s comment, an author who lost the right does not', async () => {
    payload = {
      ...payload,
      comments: [
        c('1', { mine: false, can: { edit: false, delete: true, changeVisibility: true } }), // moderation
        c('2', { mine: true, can: { edit: false, delete: true, changeVisibility: false } }), // mine, no longer allowed to edit
      ],
    };
    renderPanel();
    await screen.findByTestId('org-comments');
    const one = screen.getByTestId('thread-1');
    expect(within(one).getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(within(one).getByRole('button', { name: 'Make team only' })).toBeTruthy();
    expect(within(one).queryByRole('button', { name: 'Edit' })).toBeNull();
    const two = screen.getByTestId('thread-2');
    expect(within(two).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(two).queryByRole('button', { name: /Make/ })).toBeNull();
    expect(within(two).getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('asks for the picker’s list only when a parent wants it, and drops a slower answer for a recording already left', async () => {
    const onRecordings = vi.fn();
    const slow: { resolve: (r: Response) => void } = { resolve: () => {} };
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes(`trackId=${S1}`)) return new Promise<Response>((resolve) => { slow.resolve = resolve; });
      return Promise.resolve(new Response(JSON.stringify({ ...payload, comments: [c('9', { body: 'On the current mix' })] }), { status: 200 }));
    });
    const view = render(<OrgComments orgId={ORG} projectId={P} trackId={S1} pollMs={0} onRecordings={onRecordings} />);
    expect(String(fetchMock.mock.calls[0][0])).toContain('recordings=1');
    view.rerender(<OrgComments orgId={ORG} projectId={P} trackId={V3} pollMs={0} onRecordings={onRecordings} />);
    expect(await screen.findByText('On the current mix')).toBeTruthy();
    // The first recording's answer finally arrives: it must not replace what is on screen.
    slow.resolve(new Response(JSON.stringify({ ...payload, comments: [c('8', { body: 'From the recording I left' })] }), { status: 200 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('On the current mix')).toBeTruthy();
    expect(screen.queryByText('From the recording I left')).toBeNull();
  });

  it('a reader without comment rights gets no composer and no reply / resolve controls', async () => {
    payload = { ...payload, me: { canComment: false, canPostInternal: false } };
    renderPanel();
    await screen.findByTestId('org-comments');
    expect(screen.queryByTestId('org-comment-composer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.getByText(/can read comments but not add them/)).toBeTruthy();
  });

  it('posting sends the words, the recording, and team-only when ticked', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'Lift the hook' } });
    fireEvent.click(screen.getByLabelText('Team only'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')!;
    expect(String(post[0])).toBe(`/api/org/${ORG}/projects/${P}/comments`);
    expect(JSON.parse(post[1].body)).toEqual({ body: 'Lift the hook', track_id: V3, visibility: 'internal' });
  });

  it('an artist-visible post sends no visibility at all (the server default)', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'Nice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')![1].body)).toEqual({ body: 'Nice', track_id: V3 });
  });

  it('a pin follows the playhead and is offered only while THIS recording is the one playing', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    expect(screen.queryByLabelText(/^At /)).toBeNull();
    cleanup();
    usePlayer.setState({ currentTrack: { id: V3 } as never, progress: 0.25 }); // 50 s into a 200 s recording
    renderPanel();
    await screen.findByTestId('org-comments');
    const pin = screen.getByLabelText('At 0:50');
    fireEvent.click(pin);
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'Here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')![1].body)).toMatchObject({ region_start: 50, region_end: 55 });
  });

  it('a timecode seeks the player only when its own recording is the one loaded', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    // The pinned comment is carried from S1; V3 is loaded, so it is plain text.
    expect(screen.queryByRole('button', { name: 'Play from 0:12' })).toBeNull();
    expect(screen.getByText('at 0:12')).toBeTruthy();
    cleanup();
    usePlayer.setState({ currentTrack: { id: S1 } as never });
    renderPanel();
    await screen.findByTestId('org-comments');
    fireEvent.click(screen.getByRole('button', { name: 'Play from 0:12' }));
    expect(usePlayer.getState().seekTarget).toBeCloseTo(12.5 / 200);
  });

  it('resolve and reopen call PATCH on the thread root', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    fireEvent.click(within(screen.getByTestId('thread-4')).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH')!;
    expect(String(patch[0])).toBe(`/api/org/${ORG}/projects/${P}/comments/4`);
    expect(JSON.parse(patch[1].body)).toEqual({ resolved: true });
  });

  it('opens a reply box in place and sends it under the thread root; no dialog is ever used', async () => {
    renderPanel();
    await screen.findByTestId('org-comments');
    fireEvent.click(within(screen.getByTestId('thread-1')).getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Will fix' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')![1].body)).toEqual({ body: 'Will fix', parent_id: '1' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so on a server that has not applied the migration, and when the list cannot load', async () => {
    payload = { schemaReady: false, comments: [], me: { canComment: false, canPostInternal: false } };
    renderPanel();
    expect(await screen.findByText(/not available on this server yet/)).toBeTruthy();
    cleanup();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }));
    renderPanel();
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
  });

  it('whole-project mode asks for the plain list and posts without a recording', async () => {
    renderPanel({ trackId: null });
    await screen.findByTestId('org-comments');
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/org/${ORG}/projects/${P}/comments`);
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'About the whole EP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')![1].body)).toEqual({ body: 'About the whole EP', track_id: null });
  });
});
