// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useVolumeState } from './useVolumeState';
import { VolumeControl } from '@/components/player/VolumeControl';

afterEach(cleanup);

describe('useVolumeState (share-page volume)', () => {
  it('follows the persistent player rules: mute keeps the level', () => {
    const { result } = renderHook(() => useVolumeState());
    act(() => result.current.setVolume(0.4));
    act(() => result.current.toggleMute());
    expect(result.current).toMatchObject({ volume: 0.4, muted: true, output: 0, silent: true });
    act(() => result.current.toggleMute());
    expect(result.current).toMatchObject({ volume: 0.4, muted: false, output: 0.4, silent: false });
  });

  it('dragging to zero while muted keeps it muted; raising the level unmutes', () => {
    const { result } = renderHook(() => useVolumeState());
    act(() => result.current.toggleMute());
    act(() => result.current.setVolume(0));
    expect(result.current).toMatchObject({ volume: 0, muted: true, output: 0 });
    act(() => result.current.setVolume(0.3));
    expect(result.current).toMatchObject({ volume: 0.3, muted: false, output: 0.3 });
  });

  it('unmuting a level of zero comes back audible', () => {
    const { result } = renderHook(() => useVolumeState({ volume: 0, muted: true }));
    act(() => result.current.toggleMute());
    expect(result.current.output).toBe(0.8);
  });
});

function Harness() {
  const v = useVolumeState();
  return (
    <>
      <VolumeControl volume={v.volume} muted={v.muted} silent={v.silent}
        onVolumeChange={v.setVolume} onToggleMute={v.toggleMute} />
      <output data-testid="out">{v.output}</output>
    </>
  );
}

describe('VolumeControl', () => {
  it('mute button and slider drive the same state', () => {
    render(<Harness />);
    const slider = screen.getByLabelText('Volume') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(screen.getByTestId('out').textContent).toBe('0.5');

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(screen.getByTestId('out').textContent).toBe('0');
    expect(slider.value).toBe('0');
    expect(slider.getAttribute('aria-valuetext')).toBe('Muted');

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(screen.getByTestId('out').textContent).toBe('0.5');
    expect(slider.value).toBe('0.5');
    expect(slider.getAttribute('aria-valuetext')).toBe('50 percent');
  });
});
