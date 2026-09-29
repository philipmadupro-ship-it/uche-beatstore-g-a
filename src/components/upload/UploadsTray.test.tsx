// @vitest-environment jsdom

/**
 * The tray is the only place a freshly-created track id is on screen, and the
 * only moment the producer still knows what the file is. These pin the two
 * things that can go wrong with editing there: offering an editor for a track
 * that does not exist (which would PATCH `/api/tracks/undefined`), and a row
 * whose controls disagree with its status.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { UploadItem, UploadStatus } from '@/lib/upload/manager';

const noop = () => {};
let items: Record<string, UploadItem> = {};
let order: string[] = [];

vi.mock('@/lib/upload/manager', () => ({
  useUploadManager: (selector: (s: Record<string, unknown>) => unknown) => selector({
    order, uploads: items,
    hydrate: noop, clearFinished: noop, pause: noop, retry: noop,
    abort: noop, remove: noop, resume: noop, _patch: noop,
  }),
  formatBytes: () => '1.0 MB',
  formatSpeed: () => '1 MB/s',
  formatEta: () => '3s',
}));

vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ tags: ['Trap'], toggleTag: { mutate: noop }, isLoading: false }),
}));

const { UploadsTray } = await import('./UploadsTray');

function item(over: Partial<UploadItem> = {}): UploadItem {
  return {
    id: 'u1', fileName: 'beat_final_v3_140.wav', fileSize: 1024,
    bytesUploaded: 1024, status: 'success' as UploadStatus,
    totalParts: 1, completedPartNumbers: new Set<number>(),
    speedBps: 0, etaSec: 0, error: null, analysis: null,
    track: { id: 'track-1', title: 'Midnight' },
    ...over,
  } as UploadItem;
}

function renderTray(u: UploadItem) {
  items = { [u.id]: u };
  order = [u.id];
  render(<UploadsTray />);
}

afterEach(() => { cleanup(); items = {}; order = []; });

describe('UploadsTray', () => {
  it('lets a finished upload be renamed where it lands', () => {
    renderTray(item());
    expect(screen.getByRole('button', { name: 'Edit Title of Midnight' })).toBeTruthy();
  });

  it('offers tags on a finished upload', () => {
    renderTray(item());
    expect(screen.getByRole('button', { name: 'Edit track tags' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag Trap' })).toBeTruthy();
  });

  it('falls back to the filename when /complete returned no track', () => {
    renderTray(item({ track: null }));
    expect(screen.queryByRole('button', { name: /Edit Title/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit track tags' })).toBeNull();
    expect(screen.getByTitle('beat_final_v3_140.wav')).toBeTruthy();
  });

  it('does not offer an editor while the upload is still running', () => {
    renderTray(item({ status: 'uploading', bytesUploaded: 512 }));
    expect(screen.queryByRole('button', { name: /Edit Title/ })).toBeNull();
  });

  it('shows pause and cancel while running, and neither once done', () => {
    renderTray(item({ status: 'uploading', bytesUploaded: 512 }));
    expect(screen.getByRole('button', { name: /^Pause upload/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Cancel upload/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Dismiss upload/ })).toBeNull();
  });

  it('shows dismiss — not cancel — on a finished row', () => {
    renderTray(item());
    expect(screen.getByRole('button', { name: /^Dismiss upload/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Cancel upload/ })).toBeNull();
  });

  it('offers re-pick on an interrupted row', () => {
    renderTray(item({ status: 'interrupted', bytesUploaded: 400 }));
    expect(screen.getByRole('button', { name: /Choose original file to resume/ })).toBeTruthy();
  });

  it('says what it read from the filename on a finished upload', () => {
    renderTray(item({ fileName: 'Night Shift 140 Fm.wav' }));
    expect(screen.getByText('140 BPM · F minor from the filename')).toBeTruthy();
  });

  it('says nothing when the filename carries no BPM or key', () => {
    renderTray(item({ fileName: 'plain beat.wav' }));
    expect(screen.queryByText(/from the filename/)).toBeNull();
  });

  it('does not claim metadata before the upload finishes', () => {
    renderTray(item({ fileName: 'Night Shift 140 Fm.wav', status: 'uploading' as UploadStatus, track: undefined }));
    expect(screen.queryByText(/from the filename/)).toBeNull();
  });

  it('offers each candidate of an ambiguous name and marks the one analysis backs', () => {
    renderTray(item({ fileName: 'beat 90 140.wav', analysis: { bpm: 140.2 } }));
    expect(screen.getByText('Filename gives BPM 90 or 140 — not applied; analysis heard 140')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set BPM to 90' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set BPM to 140' }).textContent).toContain('analysis agrees');
    // Nothing is claimed as read from the name.
    expect(screen.queryByText(/ from the filename$/)).toBeNull();
  });

  it('surfaces a disagreement with the analyser and offers its value', () => {
    renderTray(item({ fileName: 'Night Shift 140 Fm.wav', analysis: { bpm: 97, bpmConfidence: 3.9 } }));
    expect(screen.getByText('Filename says 140 BPM, analysis heard 97 (confident) — kept 140')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set BPM to 97, as analysed' })).toBeTruthy();
  });

  it('one click sets the value on the track and confirms it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    renderTray(item({ fileName: 'beat 90 140.wav', analysis: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Set BPM to 140' }));
    await waitFor(() => expect(screen.getByText('BPM set to 140')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/tracks/track-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ bpm: 140 }),
    }));
    vi.unstubAllGlobals();
  });

  it('shows the question but no buttons when there is no track to edit', () => {
    renderTray(item({ fileName: 'beat 90 140.wav', track: null }));
    expect(screen.getByText(/Filename gives BPM 90 or 140/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Set BPM/ })).toBeNull();
  });

  it('raises nothing for a clear filename the analyser agrees with', () => {
    renderTray(item({ fileName: 'Night Shift 140 Fm.wav', analysis: { bpm: 70, key: 'F', scale: 'minor' } }));
    expect(screen.queryByLabelText('Filename and analysis checks')).toBeNull();
  });
});
