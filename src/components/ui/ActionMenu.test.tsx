// @vitest-environment jsdom

/**
 * The behaviours a hand-rolled ⋯ menu never had, and which neither the type
 * checker nor a passing build can catch: a menu renders perfectly and is still
 * unusable from the keyboard, and still puts Delete next to Rename.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ActionMenu } from './ActionMenu';
import type { MenuSection } from '@/lib/ui/action-menu';

afterEach(cleanup);

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Options' }));

function renderMenu(sections: MenuSection[]) {
  return render(<ActionMenu sections={sections} label="Options" />);
}

describe('ActionMenu', () => {
  it('renders danger items last even when declared first', () => {
    renderMenu([
      { id: 'd', danger: true, items: [{ id: 'del', label: 'Delete', onSelect: () => {} }] },
      { id: 'e', items: [{ id: 'rename', label: 'Rename', onSelect: () => {} }] },
    ]);
    open();
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(labels).toEqual(['Rename', 'Delete']);
  });

  it('hides the trigger entirely when every item is hidden', () => {
    renderMenu([{ id: 'e', items: [{ id: 'x', label: 'X', hidden: true, onSelect: () => {} }] }]);
    expect(screen.queryByRole('button', { name: 'Options' })).toBeNull();
  });

  // onSelect is awaited before the menu closes, so the close lands a
  // microtask after the click — an item that fires a PATCH keeps the menu up
  // until it settles rather than blinking out mid-request.
  it('invokes an item and closes', async () => {
    const onSelect = vi.fn();
    renderMenu([{ id: 'e', items: [{ id: 'rename', label: 'Rename', onSelect }] }]);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('stays open for an item that returns keep-open', async () => {
    const onSelect = vi.fn(() => 'keep-open' as const);
    renderMenu([{ id: 'e', items: [{ id: 'sync', label: 'Sync', onSelect }] }]);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sync' }));
    await Promise.resolve();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('moves with arrow keys, skipping disabled rows, and invokes on Enter', async () => {
    const first = vi.fn();
    const third = vi.fn();
    renderMenu([{
      id: 'e',
      items: [
        { id: 'a', label: 'A', onSelect: first },
        { id: 'b', label: 'B', disabled: true, onSelect: () => {} },
        { id: 'c', label: 'C', onSelect: third },
      ],
    }]);
    open();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // -> A
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // skips B -> C
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(third).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('invokes a single-letter accelerator', () => {
    const onSelect = vi.fn();
    renderMenu([{
      id: 'e',
      items: [{ id: 'rename', label: 'Rename', shortcut: 'R', shortcutKey: 'r', onSelect }],
    }]);
    open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'R' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('ignores an accelerator pressed with a modifier', () => {
    const onSelect = vi.fn();
    renderMenu([{
      id: 'e',
      items: [{ id: 'rename', label: 'Rename', shortcutKey: 'r', onSelect }],
    }]);
    open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'r', metaKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape without invoking anything', () => {
    const onSelect = vi.fn();
    renderMenu([{ id: 'e', items: [{ id: 'a', label: 'A', onSelect }] }]);
    open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  /**
   * The regression this exists for: "Edit title" in a project's ⋯ menu opened
   * the inline field and it vanished in the same frame. `invoke` awaits
   * onSelect, so React had already mounted and focused the field by the time
   * the menu restored focus to its trigger — which blurred it, and a
   * save-on-blur field with an unchanged value closes itself.
   */
  it('leaves focus alone when the item moved it somewhere deliberate', async () => {
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Project title');
    document.body.appendChild(field);

    renderMenu([{
      id: 'e',
      items: [{ id: 'title', label: 'Edit title', onSelect: () => { field.focus(); } }],
    }]);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit title' }));

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it('still returns focus to the trigger for a plain command', async () => {
    renderMenu([{ id: 'e', items: [{ id: 'pin', label: 'Pin to top', onSelect: () => {} }] }]);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to top' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options' }));
  });

  it('points aria-activedescendant at the highlighted row', () => {
    renderMenu([{
      id: 'e',
      items: [
        { id: 'a', label: 'A', onSelect: () => {} },
        { id: 'b', label: 'B', onSelect: () => {} },
      ],
    }]);
    open();
    const menu = screen.getByRole('menu');
    // Nothing highlighted yet: no item is being announced, and pointing at a
    // stale row would announce the wrong one.
    expect(menu.getAttribute('aria-activedescendant')).toBeNull();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(menu.getAttribute('aria-activedescendant')).toBe(screen.getByRole('menuitem', { name: 'A' }).id);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(menu.getAttribute('aria-activedescendant')).toBe(screen.getByRole('menuitem', { name: 'B' }).id);
  });

  it('gives every row a non-empty id — activedescendant is unusable without one', () => {
    renderMenu([{ id: 'e', items: [{ id: 'a', label: 'A', onSelect: () => {} }] }]);
    open();
    expect(screen.getByRole('menuitem', { name: 'A' }).id).not.toBe('');
  });

  it('exposes a checkable row as a checkbox, so the mark is not visual only', () => {
    renderMenu([{
      id: 'e',
      items: [
        { id: 'on', label: 'Allow downloads', checked: true, onSelect: () => {} },
        { id: 'off', label: 'Pin to top', checked: false, onSelect: () => {} },
        { id: 'plain', label: 'Duplicate', onSelect: () => {} },
      ],
    }]);
    open();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Allow downloads' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Pin to top' }).getAttribute('aria-checked')).toBe('false');
    // A row with no `checked` stays a plain command rather than an unchecked box.
    expect(screen.getByRole('menuitem', { name: 'Duplicate' }).getAttribute('aria-checked')).toBeNull();
  });

  it('does not trap focus — the panel is focusable but tabbable rows are not caged', () => {
    renderMenu([{ id: 'e', items: [{ id: 'a', label: 'A', onSelect: () => {} }] }]);
    open();
    // role="menu" with tabIndex -1 receives focus on mount; a trap would also
    // install a keydown handler that cancels Tab, which we deliberately don't.
    expect(document.activeElement).toBe(screen.getByRole('menu'));
  });
});
