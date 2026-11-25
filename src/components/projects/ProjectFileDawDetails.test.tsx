// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectFileDawDetails, useDawMetas } from './ProjectFileDawDetails';
import { dawRowInfo } from '@/lib/projects/daw';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FILES = [
  { id: 'a1', file_name: 'Night Shift.flp' },
  { id: 'a2', file_name: 'hook.wav' },
  { id: 'a3', file_name: 'Glass Rain.zip' },
];

/** The row's own use of the hook: kind label, icon flag and details line from `dawRowInfo`. */
function Rows({ enabled = true }: { enabled?: boolean }) {
  const metas = useDawMetas('p1', FILES, enabled);
  return (
    <ul>
      {FILES.map((f) => {
        const info = dawRowInfo(f.file_name, metas[f.id]);
        return (
          <li key={f.id} data-testid={`row-${f.id}`} data-daw={info.isDaw ? 'true' : 'false'}>
            {info.kindLabel ?? 'Other'}
            <ProjectFileDawDetails assetId={f.id} text={info.detail} />
          </li>
        );
      })}
    </ul>
  );
}

describe('useDawMetas + dawRowInfo', () => {
  it('asks only for sessions and zips, once each, through the owner-gated meta route', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/a1/') ? { app: 'FL Studio', appVersion: '21.2.3.3586', bpm: 140 } : { app: 'FL Studio', appVersion: null, bpm: null }),
    }));
    render(<Rows />);
    await waitFor(() => expect(screen.getByTestId('project-file-daw-a1').textContent).toContain('v21.2.3.3586 · 140 BPM'));
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(new Set(urls)).toEqual(new Set(['/api/projects/p1/assets/a1/meta', '/api/projects/p1/assets/a3/meta']));
  });

  it('a zip that holds a session becomes "Bundled FL Studio project" instead of Other', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/a3/') ? { app: 'FL Studio', appVersion: null, bpm: null } : { app: 'FL Studio', appVersion: '21.0', bpm: 100 }),
    }));
    render(<Rows />);
    await waitFor(() => expect(screen.getByTestId('row-a3').textContent).toContain('Bundled FL Studio project'));
    expect(screen.getByTestId('row-a3').textContent).not.toContain('Other');
    expect(screen.getByTestId('row-a3').dataset.daw).toBe('true');
    // an ordinary file is untouched
    expect(screen.getByTestId('row-a2').textContent).toContain('Other');
    expect(screen.getByTestId('row-a2').dataset.daw).toBe('false');
  });

  it('a plain zip (the meta route answers 404) stays an ordinary file', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<Rows />);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByTestId('row-a3').dataset.daw).toBe('false');
    expect(screen.getByTestId('row-a3').textContent).toContain('Other');
    // a session still says what it is by name even when its details are unreadable
    expect(screen.getByTestId('row-a1').textContent).toContain('FL Studio project');
    expect(screen.queryByTestId('project-file-daw-a1')).toBeNull();
  });

  it('does nothing when disabled (org projects)', () => {
    render(<Rows enabled={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
