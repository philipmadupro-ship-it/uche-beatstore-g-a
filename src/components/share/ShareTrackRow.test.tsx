// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShareTrackRow } from './ShareTrackRow';

afterEach(cleanup);

const track = { id: 't1', title: 'Night Shift', type: 'beat', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 125 };

describe('ShareTrackRow', () => {
  it('shows the library-style meta line', () => {
    render(<ShareTrackRow track={track} index={0} active={false} isPlaying={false} onPlay={() => {}} />);
    expect(screen.getByText('beat · 140 bpm · Fm · 2:05')).toBeTruthy();
  });

  it('plays on the row and downloads on its own button, without nesting buttons', () => {
    const onPlay = vi.fn();
    const onDownload = vi.fn();
    const { container } = render(
      <ShareTrackRow
        track={track}
        index={0}
        active={false}
        isPlaying={false}
        onPlay={onPlay}
        download={{ allowed: true, onDownload }}
      />,
    );
    fireEvent.click(screen.getByTestId('share-track-play'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onDownload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Download Night Shift' }));
    expect(onDownload).toHaveBeenCalledWith({ id: 't1', title: 'Night Shift' });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button button')).toBeNull();
  });

  it('has no download control when downloads are off', () => {
    render(
      <ShareTrackRow
        track={track}
        index={0}
        active={false}
        isPlaying={false}
        onPlay={() => {}}
        download={{ allowed: false, onDownload: () => {} }}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Download / })).toBeNull();
  });

  it('marks the playing row pressed and disables Download while it is in flight', () => {
    render(
      <ShareTrackRow
        track={track}
        index={0}
        active
        isPlaying
        onPlay={() => {}}
        download={{ allowed: true, onDownload: () => {}, downloadingId: 't1' }}
      />,
    );
    expect(screen.getByTestId('share-track-play').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Download Night Shift' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
