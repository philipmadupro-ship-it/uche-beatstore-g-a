// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectFileDawDetails } from './ProjectFileDawDetails';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const ok = (body: unknown) => fetchMock.mockResolvedValue({ ok: true, json: async () => body });

describe('ProjectFileDawDetails', () => {
  it('shows version and tempo of a session after one owner-gated request', async () => {
    ok({ app: 'FL Studio', appVersion: '21.2.3.3586', bpm: 140 });
    render(<ProjectFileDawDetails projectId="p1" assetId="a1" fileName="Night Shift.flp" />);
    await waitFor(() => expect(screen.getByTestId('project-file-daw-a1').textContent).toContain('v21.2.3.3586 · 140 BPM'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/assets/a1/meta');
  });
  it('shows nothing when the file cannot be read', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { container } = render(<ProjectFileDawDetails projectId="p1" assetId="a1" fileName="x.flp" />);
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).toBe('');
  });
  it('asks nothing for an ordinary file', () => {
    render(<ProjectFileDawDetails projectId="p1" assetId="a1" fileName="ref.wav" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a zip asks, and says it is a bundled session', async () => {
    ok({ app: 'Ableton Live', appVersion: null, bpm: null });
    render(<ProjectFileDawDetails projectId="p1" assetId="z1" fileName="Set.zip" />);
    await waitFor(() => expect(screen.getByTestId('project-file-daw-z1').textContent).toContain('Bundled Ableton Live project'));
  });
});
