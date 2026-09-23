// @vitest-environment jsdom

/**
 * `initialFocus` exists because a popover can be opened by something other than
 * its own trigger. The project page's ⋯ menu has "Edit tags", which opens the
 * tag popover. Focus stayed with the menu, the menu gave it back to its own
 * trigger, and the panel the keyboard user had asked for sat portaled at the
 * end of the document where Tab would take a long time to reach it.
 */

import { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { Popover } from './Popover';

afterEach(cleanup);

function Harness({ initialFocus, label }: { initialFocus?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Stands in for the ⋯ menu item: opens the popover from outside it. */}
      <button type="button" onClick={() => setOpen(true)}>External opener</button>
      <input aria-label="Elsewhere" />
      <Popover
        open={open}
        onOpenChange={setOpen}
        initialFocus={initialFocus}
        label={label}
        trigger={({ toggle, ref }) => (
          <button type="button" ref={ref as (el: HTMLButtonElement | null) => void} onClick={toggle}>
            Tags
          </button>
        )}
      >
        <button type="button">Trap</button>
        <button type="button">Drill</button>
      </Popover>
    </>
  );
}

const openExternally = () => {
  const opener = screen.getByRole('button', { name: 'External opener' });
  opener.focus();
  fireEvent.click(opener);
};

describe('Popover initialFocus', () => {
  it('moves focus into the panel when opened from outside', () => {
    render(<Harness initialFocus />);
    openExternally();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trap' }));
  });

  it('leaves focus alone when not asked to — the existing popovers are unchanged', () => {
    render(<Harness />);
    openExternally();
    expect(screen.getByRole('button', { name: 'Trap' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'External opener' }));
  });

  it('returns focus to its trigger when Escape closes it from inside', () => {
    render(<Harness initialFocus />);
    openExternally();
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('button', { name: 'Trap' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tags' }));
  });

  it('does not steal focus from a field the user moved to', () => {
    render(<Harness initialFocus />);
    openExternally();
    const elsewhere = screen.getByRole('textbox', { name: 'Elsewhere' });
    elsewhere.focus();
    act(() => { fireEvent.mouseDown(elsewhere); });
    expect(screen.queryByRole('button', { name: 'Trap' })).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('names the panel as a dialog when given a label', () => {
    render(<Harness initialFocus label="Project tags" />);
    openExternally();
    expect(screen.getByRole('dialog', { name: 'Project tags' })).toBeTruthy();
  });

  it('adds no dialog role without a label', () => {
    render(<Harness initialFocus />);
    openExternally();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
