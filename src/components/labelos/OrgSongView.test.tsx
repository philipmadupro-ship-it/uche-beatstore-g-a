// @vitest-environment jsdom

/**
 * Song detail (LABEL-17): recordings play through usePlayer from the org
 * audio route, A/B swaps between two takes at the same moment without a
 * restart, and what a role may not hear reads "restricted" (D4, 07 §3.4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePlayer } from '@/hooks/usePlayer';
import type { OrgSongDetail } from '@/lib/labelos/org-workspace-store';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/components/ui/ArtworkFallback', () => ({ ArtworkFallback: ({ children }: { children?: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/projects/ProjectFilesSection', () => ({ ProjectFilesSection: () => null }));
vi.mock('@/components/labelos/OrgUploadPanel', () => ({ OrgUploadPanel: () => null }));

import { OrgSongView } from './OrgSongView';

const ORG = 'o1';

function detail(overrides: Partial<OrgSongDetail> = {}): OrgSongDetail {
  return {
    song: { id: 's1', title: 'Midnight', stage: 'selected', cover_url: null, bpm: 140, key: 'F minor', duration_seconds: 200 },
    artists: [{ id: 'c1', name: 'Nova' }],
    projects: [{ id: 'p1', name: 'Nova EP' }],
    recordings: [
      { trackId: 's1', title: 'Midnight', label: 'Mix', kind: 'mix', recordingClass: 'finished', current: true, durationSeconds: 200 },
      { trackId: 'm1', title: 'Midnight (master)', label: 'Master', kind: 'master', recordingClass: 'finished', current: false, durationSeconds: 200 },
      { trackId: 'd1', title: 'Midnight (demo)', label: 'Demo', kind: 'demo', recordingClass: 'working', current: false, durationSeconds: 100 },
    ],
    restrictedRecordings: 0,
    releases: [{ id: 'r1', title: 'Midnight EP', state: 'draft' }],
    ...overrides,
  };
}

function open(d = detail()) {
  render(<OrgSongView orgId={ORG} orgSlug="night-shift" detail={d} />);
}

beforeEach(() => {
  usePlayer.setState({ currentTrack: null, queue: [], isPlaying: false, progress: 0, seekTarget: null });
});
afterEach(() => cleanup());

describe('OrgSongView', () => {
  it('shows the song, its artist, stage and where it lives', () => {
    open();
    expect(screen.getByRole('heading', { level: 1, name: 'Midnight' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nova' }).getAttribute('href')).toBe('/o/night-shift/artists/c1');
    expect(screen.getByTestId('org-song-stage').textContent).toBe('Selected');
    expect(screen.getByRole('link', { name: 'Nova EP' }).getAttribute('href')).toBe('/o/night-shift/projects/p1');
    expect(screen.getByText('Midnight EP')).toBeTruthy();
  });

  it('plays a recording through usePlayer from the org audio route', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Play Master' }));
    const t = usePlayer.getState().currentTrack!;
    expect(t.id).toBe('m1');
    expect(t.audio_url).toBe('/api/org/o1/audio/m1');
    expect(usePlayer.getState().isPlaying).toBe(true);
    // The same button now pauses, without reloading the track.
    fireEvent.click(screen.getByRole('button', { name: 'Pause Master' }));
    expect(usePlayer.getState().isPlaying).toBe(false);
    expect(usePlayer.getState().currentTrack?.id).toBe('m1');
  });

  it('A/B switches between the two takes at the same moment', () => {
    open();
    const ab = screen.getByTestId('org-song-ab');
    fireEvent.click(ab); // nothing loaded: plays A (the mix) from the top
    expect(usePlayer.getState().currentTrack?.id).toBe('s1');
    expect(usePlayer.getState().seekTarget).toBeNull();
    act(() => { usePlayer.setState({ progress: 0.4 }); });
    fireEvent.click(ab); // → B (the master), same second
    expect(usePlayer.getState().currentTrack?.id).toBe('m1');
    expect(usePlayer.getState().isPlaying).toBe(true);
    expect(usePlayer.getState().seekTarget).toBeCloseTo(0.4);
    expect(ab.textContent).toBe('A/B · B');
    act(() => { usePlayer.setState({ progress: 0.5, seekTarget: null }); });
    fireEvent.click(ab); // ← back to A
    expect(usePlayer.getState().currentTrack?.id).toBe('s1');
    expect(usePlayer.getState().seekTarget).toBeCloseTo(0.5);
  });

  it('A and B can be re-picked; the same second is kept across takes of different length', () => {
    open();
    fireEvent.click(screen.getAllByRole('button', { name: 'B' })[2]); // B = demo (100 s)
    fireEvent.click(screen.getByTestId('org-song-ab'));
    act(() => { usePlayer.setState({ progress: 0.25 }); }); // 50 s into the 200 s mix
    fireEvent.click(screen.getByTestId('org-song-ab'));
    expect(usePlayer.getState().currentTrack?.id).toBe('d1');
    expect(usePlayer.getState().seekTarget).toBeCloseTo(0.5); // 50 s into the 100 s demo
  });

  it('with an unknown length, the seek waits for the new take to start playing', () => {
    const d = detail();
    d.recordings[1] = { ...d.recordings[1], durationSeconds: null };
    open(d);
    fireEvent.click(screen.getByTestId('org-song-ab'));
    act(() => { usePlayer.setState({ progress: 0.3 }); });
    fireEvent.click(screen.getByTestId('org-song-ab'));
    expect(usePlayer.getState().currentTrack?.id).toBe('m1');
    expect(usePlayer.getState().seekTarget).toBeNull();
    act(() => { usePlayer.setState({ progress: 0.01 }); }); // first tick of the new element
    expect(usePlayer.getState().seekTarget).toBeCloseTo(0.3);
  });

  it('marketing: hidden recordings read "restricted" (D4, 07 §3.4)', () => {
    open(detail({ recordings: detail().recordings.slice(0, 2), restrictedRecordings: 2 }));
    expect(screen.getByTestId('org-song-restricted').textContent).toMatch(/2 more recordings .* restricted/);
    expect(screen.queryByText(/Midnight \(demo\)/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play Demo' })).toBeNull();
  });

  it('A/B is disabled with fewer than two recordings', () => {
    open(detail({ recordings: detail().recordings.slice(0, 1) }));
    expect((screen.getByTestId('org-song-ab') as HTMLButtonElement).disabled).toBe(true);
  });
});
