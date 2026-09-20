// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { useSessionContext } from '@/hooks/useSessionContext';
import { SessionTempoBadge } from './SessionTempoBadge';

const setSession = (bpm: number | null, previewInSession: boolean) =>
  useSessionContext.setState({ bpm, key: null, scale: null, matchTolerance: 2, previewInSession });

describe('SessionTempoBadge', () => {
  beforeEach(() => setSession(null, false));

  it('stays out of the way when previews are not being stretched', () => {
    setSession(140, false);
    const { container } = render(<SessionTempoBadge bpm={92} />);
    expect(container.innerHTML).toBe('');
  });

  it('stays out of the way when the track is already at the session tempo', () => {
    setSession(140, true);
    const { container } = render(<SessionTempoBadge bpm={140} />);
    expect(container.innerHTML).toBe('');
  });

  it('says what tempo you are actually hearing', () => {
    // Without this a 92 BPM beat auditioned in a 140 BPM session reads as a
    // 140 BPM beat, and the catalogue you think you have is not the one you have.
    setSession(140, true);
    render(<SessionTempoBadge bpm={130} />);
    expect(screen.getByText('140 BPM')).toBeTruthy();
  });

  it('names both tempos for a screen reader, not just the new one', () => {
    setSession(140, true);
    const { container } = render(<SessionTempoBadge bpm={130} />);
    expect(container.textContent).toContain('originally 130 BPM');
  });

  it('marks a half-time fold as such', () => {
    setSession(140, true);
    render(<SessionTempoBadge bpm={72} />);
    expect(screen.getByText(/½×/)).toBeTruthy();
  });

  it('promises the file itself is unchanged', () => {
    setSession(140, true);
    const { container } = render(<SessionTempoBadge bpm={130} />);
    expect(container.querySelector('[title]')?.getAttribute('title')).toContain(
      'file itself is unchanged',
    );
  });

  it('renders nothing for a track with no known tempo', () => {
    setSession(140, true);
    const { container } = render(<SessionTempoBadge bpm={null} />);
    expect(container.innerHTML).toBe('');
  });
});
