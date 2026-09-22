// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { useSessionContext } from '@/hooks/useSessionContext';
import { SessionContextControl } from './SessionContextControl';

const reset = () =>
  useSessionContext.setState({
    bpm: null,
    key: null,
    scale: null,
    matchTolerance: 2,
    previewInSession: false,
  });

/** Open the popover and return its trigger. */
function open() {
  const trigger = screen.getByRole('button', { name: /session/i });
  fireEvent.click(trigger);
  return trigger;
}

describe('SessionContextControl', () => {
  beforeEach(reset);

  it('reads "Session" until one is set, then states it', () => {
    const { rerender } = render(<SessionContextControl />);
    expect(screen.getByRole('button', { name: /session/i }).textContent).toContain('Session');

    useSessionContext.setState({ bpm: 140, key: 'F', scale: 'minor' });
    rerender(<SessionContextControl />);
    expect(screen.getByRole('button', { name: /session/i }).textContent).toContain('140 BPM · F minor');
  });

  it('announces itself as a dialog trigger', () => {
    render(<SessionContextControl />);
    const trigger = screen.getByRole('button', { name: /session/i });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('commits a typed tempo once it is plausible, not on every keystroke', () => {
    render(<SessionContextControl />);
    open();
    const field = screen.getByLabelText('Session tempo in BPM');

    // The "1" of "140" is not a tempo, and committing it would re-mark every
    // row on the way to the real answer.
    fireEvent.change(field, { target: { value: '1' } });
    expect(useSessionContext.getState().bpm).toBe(null);

    fireEvent.change(field, { target: { value: '140' } });
    expect(useSessionContext.getState().bpm).toBe(140);
  });

  it('clears the tempo when the field is emptied and left', () => {
    useSessionContext.setState({ bpm: 140 });
    render(<SessionContextControl />);
    open();
    const field = screen.getByLabelText('Session tempo in BPM');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field, { target: { value: '' } });
    expect(useSessionContext.getState().bpm).toBe(null);
  });

  it('finds a tempo by tapping', () => {
    render(<SessionContextControl />);
    open();
    const tapButton = screen.getByLabelText('Tap tempo');
    // Two taps half a second apart is 120 BPM.
    const base = performance.now();
    Object.defineProperty(performance, 'now', { value: () => base, configurable: true });
    fireEvent.click(tapButton);
    Object.defineProperty(performance, 'now', { value: () => base + 500, configurable: true });
    fireEvent.click(tapButton);
    expect(useSessionContext.getState().bpm).toBe(120);
  });

  it('clicking the selected key clears it, so the key stays optional', () => {
    useSessionContext.setState({ key: 'F' });
    render(<SessionContextControl />);
    open();
    fireEvent.click(screen.getByLabelText('Key of F'));
    expect(useSessionContext.getState().key).toBe(null);
  });

  it('offers "Make relative" only once both a tonic and a mode are chosen', () => {
    useSessionContext.setState({ key: 'F', scale: null });
    render(<SessionContextControl />);
    open();
    expect(screen.queryByText('Make relative')).toBe(null);

    fireEvent.click(screen.getByRole('button', { name: 'minor' }));
    expect(screen.getByText('Make relative')).toBeTruthy();
    fireEvent.click(screen.getByText('Make relative'));
    expect(useSessionContext.getState()).toMatchObject({ key: 'G#', scale: 'major' });
  });

  it('will not offer to stretch previews before there is a tempo to stretch to', () => {
    render(<SessionContextControl />);
    open();
    const toggle = screen.getByRole('button', { name: /Preview at session tempo/i });
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(toggle.textContent).toContain('Set a tempo first');
  });

  it('says downloads are unaffected, because the preview is not the file', () => {
    useSessionContext.setState({ bpm: 140 });
    render(<SessionContextControl />);
    open();
    expect(
      screen.getByRole('button', { name: /Preview at session tempo/i }).textContent,
    ).toContain('Downloads are unchanged');
  });

  it('offers Clear only when there is something to clear', () => {
    render(<SessionContextControl />);
    open();
    expect(screen.queryByText('Clear')).toBe(null);

    useSessionContext.setState({ bpm: 140 });
    fireEvent.click(screen.getByLabelText('Key of C'));
    expect(screen.getByText('Clear')).toBeTruthy();
  });
});
