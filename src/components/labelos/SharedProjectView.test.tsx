// @vitest-environment jsdom

/**
 * The external member's project page (LABEL-21): what a role sees is exactly
 * what `view.me.can` allows — a viewer has no upload or download control, a
 * contributor adds a VERSION of a song through the uploads tray (never a new
 * song, never another kind), and recordings play through usePlayer from the
 * per-object audio route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePlayer } from '@/hooks/usePlayer';
import { toSharedProjectView, type SharedProjectView as View } from '@/lib/labelos/shared-project';
import type { ExternalProjectRole } from '@/lib/labelos/capabilities';

const enqueue = vi.fn();
vi.mock('@/lib/upload/manager', () => ({ useUploadManager: (sel: (s: { enqueue: typeof enqueue }) => unknown) => sel({ enqueue }) }));

import { SharedProjectView } from './SharedProjectView';

const ORG = '10000000-0000-4000-8000-000000000001';
const SONG = '50000000-0000-4000-8000-000000000001';

function view(role: ExternalProjectRole, allowDownloads = false): View {
  return toSharedProjectView({
    project: { id: 'p1', name: 'Uche × Producer X', orgId: ORG, orgName: 'Night Shift' },
    artistNames: ['Nova'],
    membership: { projectId: 'p1', role, allowDownloads },
    tracks: [
      { id: SONG, title: 'Midnight', type: 'song', song_stage: 'in_review', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 200, created_by: 'u1' },
      { id: 'v1', title: 'Midnight v2', type: 'song', song_stage: null, duration_seconds: 201, created_by: 'u2' },
    ],
    names: new Map([['u2', 'Producer X']]),
  });
}

beforeEach(() => {
  enqueue.mockClear();
  usePlayer.setState({ currentTrack: null, queue: [], isPlaying: false, progress: 0, seekTarget: null });
});
afterEach(() => cleanup());

describe('SharedProjectView', () => {
  it('shows the project, its artist’s name, the role and what the role may do', () => {
    render(<SharedProjectView view={view('viewer')} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Uche × Producer X' })).toBeTruthy();
    expect(screen.getByText('Shared by Night Shift')).toBeTruthy();
    expect(screen.getByText('Nova')).toBeTruthy();
    expect(screen.getByTestId('shared-role').textContent).toBe('Viewer');
    expect(screen.getByText('Listens; no downloads')).toBeTruthy();
    // No link into the org, its artists or its other screens: the artist is a name, not a link.
    expect(document.querySelectorAll('a').length).toBe(0);
  });

  it('credits who added a recording (D3)', () => {
    render(<SharedProjectView view={view('viewer')} />);
    expect(screen.getByTestId('shared-rec-v1').textContent).toContain('added by Producer X');
    expect(screen.getByTestId(`shared-rec-${SONG}`).textContent).not.toContain('added by');
  });

  it('plays a recording through usePlayer from the per-object audio route', () => {
    render(<SharedProjectView view={view('viewer')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Midnight' }));
    const track = usePlayer.getState().currentTrack!;
    expect(track.id).toBe(SONG);
    expect(track.audio_url).toBe(`/api/org/${ORG}/audio/${SONG}`);
    // No stored reference or producer-route URL reaches the player.
    expect(track.preview_url).toBeNull();
    expect(track.peaks_url).toBeNull();
  });

  it('a viewer has no download link and no upload control', () => {
    render(<SharedProjectView view={view('viewer')} />);
    expect(screen.queryByLabelText('Download Midnight')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Add a version' })).toBeNull();
    expect(screen.queryByTestId('shared-upload-input')).toBeNull();
  });

  it('a viewer WITH allow_downloads gets a download link, still no upload', () => {
    render(<SharedProjectView view={view('viewer', true)} />);
    expect(screen.getByLabelText('Download Midnight').getAttribute('href')).toBe(`/api/org/${ORG}/audio/${SONG}?variant=full&download=1`);
    expect(screen.queryByTestId('shared-upload-input')).toBeNull();
  });

  it('a contributor sees the upload control and downloads; a commenter neither', () => {
    render(<SharedProjectView view={view('commenter')} />);
    expect(screen.queryByTestId('shared-upload-input')).toBeNull();
    expect(screen.queryByLabelText('Download Midnight')).toBeNull();
    cleanup();
    render(<SharedProjectView view={view('contributor')} />);
    expect(screen.getByTestId('shared-upload-input')).toBeTruthy();
    expect(screen.getByLabelText('Download Midnight')).toBeTruthy();
  });

  it('upload: only a SONG with a stage is a target, and files are queued as a VERSION of it in this org', () => {
    render(<SharedProjectView view={view('editor')} />);
    // One target → preselected; the version (no stage) is not offered.
    const input = screen.getByTestId('shared-upload-input') as HTMLInputElement;
    const file = new File(['x'], 'v3.wav', { type: 'audio/wav' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(file, { org: { orgId: ORG, as: { kind: 'link', songId: SONG, relation: 'version' } }, type: 'song' });
    expect(screen.getByText('1 file added to the uploads tray.')).toBeTruthy();
  });

  it('does not promise what is not built: comments and detail edits are said to come later', () => {
    render(<SharedProjectView view={view('viewer')} />);
    expect(screen.queryByTestId('shared-soon')).toBeNull();
    cleanup();
    render(<SharedProjectView view={view('commenter')} />);
    expect(screen.getByTestId('shared-soon').textContent).toContain('comments on this project open here in a later update');
    cleanup();
    render(<SharedProjectView view={view('editor')} />);
    expect(screen.getByTestId('shared-soon').textContent).toContain('comments and editing details');
  });

  it('says so when nothing is in the project yet', () => {
    const v = view('viewer');
    render(<SharedProjectView view={{ ...v, recordings: [], uploadTargets: [] }} />);
    expect(screen.getByText('Nothing has been added to this project yet.')).toBeTruthy();
  });
});
