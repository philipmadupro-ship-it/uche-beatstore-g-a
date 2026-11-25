// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: { isCached: false, isStale: false, downloading: false, progress: 0, error: null as string | null, announcement: null, download: vi.fn(), remove: vi.fn() } }));
vi.mock('@/hooks/useOfflineCache', () => ({ useOfflineTrack: () => state.value }));

import { ProjectFileOffline } from './ProjectFileOffline';
import type { ProjectAssetView } from '@/lib/projects/asset-view';

const file = (over: Partial<ProjectAssetView> = {}): ProjectAssetView => ({
  id: 'a1', project_id: 'p1', kind: 'audio', label: 'Vocal ref', file_name: 'v.wav', mime: 'audio/wav', size_bytes: 10, position: 0,
  in_portal: false, portal_at: null, created_at: 'x', downloadUrl: '/api/projects/p1/assets/a1/download', ...over,
});
afterEach(cleanup);

describe('ProjectFileOffline', () => {
  it('offers Save for an audio file and downloads through its own route', () => {
    state.value = { ...state.value, isCached: false, isStale: false };
    render(<ProjectFileOffline file={file()} />);
    const b = screen.getByTestId('project-file-offline-a1');
    expect(b.dataset.state).toBe('none');
    b.click();
    expect(state.value.download).toHaveBeenCalledWith('/api/projects/p1/assets/a1/download', 'Vocal ref');
  });
  it('shows the shared wording for saved and out-of-date', () => {
    state.value = { ...state.value, isCached: true, isStale: false };
    const { rerender } = render(<ProjectFileOffline file={file()} />);
    expect(screen.getByTestId('project-file-offline-a1').textContent).toContain('Available offline');
    state.value = { ...state.value, isCached: true, isStale: true };
    rerender(<ProjectFileOffline file={file()} />);
    expect(screen.getByTestId('project-file-offline-a1').textContent).toContain('Offline copy out of date');
  });
  it('renders nothing for a document', () => {
    const { container } = render(<ProjectFileOffline file={file({ kind: 'document', mime: 'application/pdf' })} />);
    expect(container.firstChild).toBeNull();
  });
});
