// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { useSessionContext } from '@/hooks/useSessionContext';
import { SessionFitMarkers } from './SessionFitMarkers';

const setSession = (bpm: number | null, key: 'F' | 'G#' | 'C' | null, scale: 'major' | 'minor' | null) =>
  useSessionContext.setState({ bpm, key, scale, matchTolerance: 2, previewInSession: false });

describe('SessionFitMarkers', () => {
  beforeEach(() => setSession(null, null, null));

  it('renders nothing when no session is set', () => {
    // The row must be untouched for anyone not using the feature.
    const { container } = render(<SessionFitMarkers track={{ bpm: 140, key: 'F', scale: 'minor' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a track that does not fit', () => {
    setSession(140, 'F', 'minor');
    const { container } = render(<SessionFitMarkers track={{ bpm: 90, key: 'B', scale: 'major' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('marks the same key and the same tempo', () => {
    setSession(140, 'F', 'minor');
    render(<SessionFitMarkers track={{ bpm: 140, key: 'F', scale: 'minor' }} />);
    expect(screen.getByLabelText('Same key as your session')).toBeTruthy();
    expect(screen.getByLabelText('Same tempo as your session')).toBeTruthy();
  });

  it('matches a key stored in the other enharmonic spelling', () => {
    setSession(null, 'G#', 'major');
    render(<SessionFitMarkers track={{ bpm: null, key: 'Ab', scale: 'major' }} />);
    expect(screen.getByLabelText('Same key as your session')).toBeTruthy();
  });

  it('marks the relative major', () => {
    setSession(null, 'F', 'minor');
    render(<SessionFitMarkers track={{ bpm: null, key: 'G#', scale: 'major' }} />);
    expect(screen.getByLabelText('Relative major/minor of your session key')).toBeTruthy();
  });

  it('marks half-time and double-time with a word, not just a colour', () => {
    setSession(140, null, null);
    const half = render(<SessionFitMarkers track={{ bpm: 70 }} />);
    expect(screen.getByLabelText('Half-time of your session tempo').textContent).toContain('½×');
    half.unmount();

    render(<SessionFitMarkers track={{ bpm: 280 }} />);
    expect(screen.getByLabelText('Double-time of your session tempo').textContent).toContain('2×');
  });

  it('honours a widened tempo tolerance', () => {
    setSession(140, null, null);
    const tight = render(<SessionFitMarkers track={{ bpm: 145 }} />);
    expect(tight.container.innerHTML).toBe('');
    tight.unmount();

    useSessionContext.setState({ matchTolerance: 6 });
    render(<SessionFitMarkers track={{ bpm: 145 }} />);
    expect(screen.getByLabelText('Same tempo as your session')).toBeTruthy();
  });

  it('marks tempo alone when the session names no key', () => {
    setSession(140, null, null);
    render(<SessionFitMarkers track={{ bpm: 140, key: 'B', scale: 'major' }} />);
    expect(screen.getByLabelText('Same tempo as your session')).toBeTruthy();
    expect(screen.queryByLabelText(/key/i)).toBe(null);
  });

  it('gives every marker a label, so none depends on colour alone', () => {
    setSession(140, 'F', 'minor');
    const { container } = render(<SessionFitMarkers track={{ bpm: 70, key: 'G#', scale: 'major' }} />);
    const marked = container.querySelectorAll('[aria-label]');
    expect(marked.length).toBe(2);
    for (const el of marked) expect(el.getAttribute('aria-label')).toBeTruthy();
  });
});
