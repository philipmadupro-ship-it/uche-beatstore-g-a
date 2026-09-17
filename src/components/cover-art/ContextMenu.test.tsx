// @vitest-environment jsdom

/**
 * `role="menu"` is a promise: it tells a screen reader the thing is
 * arrow-navigable. This menu declared it and implemented nothing but Escape,
 * and never took focus, so a keyboard user could not reach it at all.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

afterEach(cleanup);

function renderMenu(items: ContextMenuItem[], onClose = vi.fn()) {
  render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />);
  return onClose;
}

const action = (label: string, over: Partial<Extract<ContextMenuItem, { kind: 'action' }>> = {}): ContextMenuItem =>
  ({ kind: 'action', label, onSelect: vi.fn(), ...over });

describe('ContextMenu', () => {
  it('hands focus back to what was focused before it opened', () => {
    // It used to take focus and never return it, so every close left focus on
    // <body>. The studio's window-level shortcuts hid that; a screen reader
    // lost its place on every use.
    const layer = document.createElement('div');
    layer.tabIndex = -1;
    document.body.appendChild(layer);
    layer.focus();

    const { unmount } = render(<ContextMenu x={10} y={10} items={[action('Hide')]} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('menu'));
    unmount();
    expect(document.activeElement).toBe(layer);
    layer.remove();
  });

  it('does not steal focus back from a field that claimed it while closing', () => {
    const layer = document.createElement('div');
    layer.tabIndex = -1;
    const field = document.createElement('input');
    document.body.append(layer, field);
    layer.focus();

    const { unmount } = render(<ContextMenu x={10} y={10} items={[action('Hide')]} onClose={vi.fn()} />);
    field.focus();
    unmount();
    expect(document.activeElement).toBe(field);
    layer.remove();
    field.remove();
  });

  it('does not throw or refocus when the previous element is gone', () => {
    const layer = document.createElement('div');
    layer.tabIndex = -1;
    document.body.appendChild(layer);
    layer.focus();

    const { unmount } = render(<ContextMenu x={10} y={10} items={[action('Delete')]} onClose={vi.fn()} />);
    // Delete removes the very layer the menu was opened on.
    layer.remove();
    expect(() => unmount()).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it('takes focus on mount so the keyboard can reach it', () => {
    renderMenu([action('Duplicate')]);
    expect(document.activeElement).toBe(screen.getByRole('menu'));
  });

  it('arrows to an item and fires it on Enter', () => {
    const first = vi.fn();
    const second = vi.fn();
    renderMenu([action('Duplicate', { onSelect: first }), action('Delete', { onSelect: second })]);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('does not let a separator take a keyboard slot', () => {
    const first = vi.fn();
    const second = vi.fn();
    renderMenu([
      action('Duplicate', { onSelect: first }),
      { kind: 'separator' },
      action('Delete', { onSelect: second }),
    ]);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Duplicate
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // Delete, not the separator
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('skips a disabled row', () => {
    const skipped = vi.fn();
    const reached = vi.fn();
    renderMenu([
      action('Top'),
      action('Disabled', { disabled: true, onSelect: skipped }),
      action('Bottom', { onSelect: reached }),
    ]);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(reached).toHaveBeenCalledTimes(1);
    expect(skipped).not.toHaveBeenCalled();
  });

  it('wraps from the last item back to the first', () => {
    const first = vi.fn();
    renderMenu([action('One', { onSelect: first }), action('Two')]);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'End' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('closes after invoking, and on Escape without invoking', () => {
    const onSelect = vi.fn();
    const onClose = renderMenu([action('Duplicate', { onSelect })]);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
