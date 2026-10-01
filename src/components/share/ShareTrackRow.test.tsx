// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShareTrackRow } from './ShareTrackRow';

afterEach(cleanup);

const track = { id: 't1', title: 'Night Shift', type: 'beat', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 125 };

describe('ShareTrackRow', () => {
  it('shows the library-style meta line', () => {
    render(<ShareTrackRow track={track} active={false} isPlaying={false} onPlay={() => {}} />);
    expect(screen.getByText('Night Shift')).toBeTruthy();
    expect(screen.getByText('Fm')).toBeTruthy();
    expect(screen.getByText('beat')).toBeTruthy();
    // The Time column, and the same length repeated for phones.
    expect(screen.getAllByText('2:05').length).toBeGreaterThan(0);
  });

  it('plays on the row and downloads on its own button, without nesting buttons', () => {
    const onPlay = vi.fn();
    const onDownload = vi.fn();
    const { container } = render(
      <ShareTrackRow
        track={track}
       
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

  it('splits cover (plays) from title (details) when a details handler is given', () => {
    const onPlay = vi.fn();
    const onOpenDetails = vi.fn();
    render(<ShareTrackRow track={track} active={false} isPlaying={false} onPlay={onPlay} onOpenDetails={onOpenDetails} />);
    fireEvent.click(screen.getByTestId('share-track-play'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onOpenDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Night Shift'));
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('renders the trailing slot and title badge', () => {
    render(<ShareTrackRow track={track} active={false} isPlaying={false} onPlay={() => {}} trailing={<b>$30</b>} titleBadge={<i>In cart</i>} />);
    expect(screen.getByText('$30')).toBeTruthy();
    expect(screen.getByText('In cart')).toBeTruthy();
  });

  it('has no download control when downloads are off', () => {
    render(
      <ShareTrackRow
        track={track}
       
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
