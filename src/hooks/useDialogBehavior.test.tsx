// @vitest-environment jsdom

/**
 * These assert the three things ~29 hand-rolled overlays in this codebase were
 * missing. None of them is catchable by type checking or a passing build — a
 * dialog with no focus trap renders perfectly and is simply unusable by
 * keyboard.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useDialogBehavior } from './useDialogBehavior';

function Dialog({ onClose, trapFocus = true }: { onClose: () => void; trapFocus?: boolean }) {
  const ref = useDialogBehavior<HTMLDivElement>({ open: true, onClose, trapFocus });
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Test" tabIndex={-1}>
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    </div>
  );
}

afterEach(cleanup);

describe('useDialogBehavior', () => {
  it('closes on Escape', () => {
    // Without this a keyboard user who opens a dialog by accident has no exit
    // that does not involve tabbing to a close button they cannot see.
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog on open', () => {
    const { getByText } = render(<Dialog onClose={vi.fn()} />);
    expect(document.activeElement).toBe(getByText('first'));
  });

  it('wraps Tab from the last control back to the first', () => {
    // Without the trap, Tab walks into the page behind — which is still
    // rendered — so the user edits a form they cannot see.
    const { getByText } = render(<Dialog onClose={vi.fn()} />);
    const last = getByText('last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getByText('first'));
  });

  it('wraps Shift+Tab from the first control back to the last', () => {
    const { getByText } = render(<Dialog onClose={vi.fn()} />);
    getByText('first').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByText('last'));
  });

  it('does not intercept Tab in the middle of the dialog', () => {
    // Only the edges wrap; everything between must tab normally or the dialog
    // becomes impossible to move through.
    const { getByText } = render(<Dialog onClose={vi.fn()} />);
    getByText('middle').focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not trap when trapFocus is false', () => {
    // Dropdowns and context menus are role="menu": they should close on Escape
    // but trapping strands the user inside a popup they expected to tab out of.
    const { getByText } = render(<Dialog onClose={vi.fn()} trapFocus={false} />);
    getByText('last').focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('restores focus to the opener on close', () => {
    // Otherwise focus falls back to <body> and the next Tab restarts from the
    // top of the page rather than where the user was.
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<Dialog onClose={vi.fn()} />);
    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('still closes on Escape when the dialog holds nothing focusable', () => {
    const onClose = vi.fn();
    function Empty() {
      const ref = useDialogBehavior<HTMLDivElement>({ open: true, onClose });
      return <div ref={ref} role="dialog" tabIndex={-1}>no controls</div>;
    }
    expect(() => render(<Empty />)).not.toThrow();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does nothing while closed', () => {
    const onClose = vi.fn();
    function Closed() {
      const ref = useDialogBehavior<HTMLDivElement>({ open: false, onClose });
      return <div ref={ref}><button type="button">x</button></div>;
    }
    render(<Closed />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
