// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShareRowWaveform } from './ShareRowWaveform';
import { ShareTransportProvider } from './ShareTransport';

afterEach(cleanup);

const track = { id: 't1', title: 'Night Shift', peaks_url: null, duration_seconds: 100 };

describe('ShareRowWaveform', () => {
  it('an idle row starts playback on click and is not a seek slider', () => {
    const onPlay = vi.fn();
    render(<ShareRowWaveform track={track} active={false} onPlay={onPlay} />);
    expect(screen.queryByRole('slider')).toBeNull();
    const box = screen.getByTestId('share-row-waveform');
    fireEvent.click(box.firstElementChild as Element);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('the playing row paints the page transport and seeks through it', () => {
    const seekToFraction = vi.fn();
    render(
      <ShareTransportProvider value={{ currentTime: 25, duration: 100, seekToFraction }}>
        <ShareRowWaveform track={track} active onPlay={() => {}} />
      </ShareTransportProvider>,
    );
    const slider = screen.getByRole('slider', { name: 'Seek Night Shift' });
    expect(slider.getAttribute('aria-valuenow')).toBe('25');
    slider.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, right: 200, bottom: 36, height: 36, x: 0, y: 0, toJSON() {} });
    fireEvent.click(slider, { clientX: 50 });
    expect(seekToFraction).toHaveBeenCalledWith(0.25);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(seekToFraction).toHaveBeenLastCalledWith(1);
  });
});
