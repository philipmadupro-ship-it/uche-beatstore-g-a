// @vitest-environment jsdom

/**
 * The rule this guards: an auto-derived credit (source: 'filename') must be
 * visibly distinct from one the producer typed (source: 'manual') — see
 * migration 115 and lib/upload/collaborators.ts's REPLACE-only-'filename'
 * rule. If the UI can't tell them apart, a producer has no way to know which
 * credits survive a re-parse of the upload's filename.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TrackCollaboratorStrip } from './TrackCollaboratorStrip';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetchSequence(responses: Array<{ ok: boolean; json: unknown }>) {
  let call = 0;
  const fn = vi.fn((..._args: Parameters<typeof fetch>) => {
    void _args;
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({
      ok: r.ok,
      json: () => Promise.resolve(r.json),
    } as Response);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('TrackCollaboratorStrip', () => {
  it('marks a filename-derived credit distinctly from a manual one', async () => {
    mockFetchSequence([
      {
        ok: true,
        json: [
          { id: 'c-1', track_id: 't-1', name: 'Metro', role: 'producer', source: 'filename', created_at: 'now' },
          { id: 'c-2', track_id: 't-1', name: 'Ada', role: 'feature', source: 'manual', created_at: 'now' },
        ],
      },
    ]);
    render(<TrackCollaboratorStrip trackId="t-1" />);

    const metroPill = await screen.findByTitle('Read from the uploaded filename');
    expect(metroPill.textContent).toContain('Metro');
    const adaPill = screen.getByTitle('Added by hand');
    expect(adaPill.textContent).toContain('Ada');
    // Only the filename-derived pill carries the sparkle marker.
    expect(metroPill.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('adds a credit with source implied server-side, not sent by the client', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: [] },
      { ok: true, json: { id: 'c-3', track_id: 't-1', name: 'Zed', role: 'collaborator', source: 'manual', created_at: 'now' } },
    ]);
    render(<TrackCollaboratorStrip trackId="t-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add a track credit' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Zed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add credit' }));

    await waitFor(() => expect(screen.getByTitle('Added by hand').textContent).toContain('Zed'));

    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toEqual({ name: 'Zed', role: 'collaborator' });
  });

  it('removes a credit on click, scoped to its own id', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: [{ id: 'c-1', track_id: 't-1', name: 'Metro', role: 'producer', source: 'filename', created_at: 'now' }] },
      { ok: true, json: { success: true } },
    ]);
    render(<TrackCollaboratorStrip trackId="t-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove credit for Metro' }));

    await waitFor(() => expect(screen.queryByTitle('Read from the uploaded filename')).toBeNull());

    const deleteCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
    expect(deleteCall).toBeTruthy();
    const body = JSON.parse((deleteCall![1] as RequestInit).body as string);
    expect(body).toEqual({ id: 'c-1' });
  });

  it('renders no credit pills when the list is empty', async () => {
    mockFetchSequence([{ ok: true, json: [] }]);
    render(<TrackCollaboratorStrip trackId="t-1" />);
    await screen.findByRole('button', { name: 'Add a track credit' });
    expect(screen.queryByTitle('Read from the uploaded filename')).toBeNull();
    expect(screen.queryByTitle('Added by hand')).toBeNull();
  });
});
