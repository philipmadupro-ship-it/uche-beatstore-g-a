// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { useListKeyboardNavigation } from './useListKeyboardNavigation';

type Row = { id: string; title: string };
const rows: Row[] = [
  { id: 'a', title: 'Night Shift' },
  { id: 'b', title: 'Cold Front' },
  { id: 'c', title: 'Drift' },
];

function List({
  items = rows,
  onMove,
  onActivate,
  onNeighbours,
}: {
  items?: Row[];
  onMove?: (r: Row) => void;
  onActivate: (r: Row) => void;
  onNeighbours?: (n: Row[]) => void;
}) {
  const nav = useListKeyboardNavigation({ items, onMove, onActivate, onNeighbours });
  return (
    <div>
      <button type="button" data-testid="outside">outside</button>
      <div role="group" aria-label="Tracks" tabIndex={0} onKeyDown={nav.onKeyDown} data-testid="list">
        {items.map((r, i) => (
          <div key={r.id} data-row-index={i} aria-current={nav.activeIndex === i ? 'true' : undefined}>
            <button type="button">{r.title}</button>
            <input aria-label={`rename ${r.title}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Stands in for `usePlayerKeyboardShortcuts`: a WINDOW listener that uses ↑/↓
 * for volume and — as that hook now does — stands down when a closer handler
 * already claimed the key.
 */
let volumeChanges = 0;
const playerHandler = (e: KeyboardEvent) => {
  if (e.defaultPrevented) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') volumeChanges += 1;
};

beforeEach(() => {
  volumeChanges = 0;
  window.addEventListener('keydown', playerHandler);
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => window.removeEventListener('keydown', playerHandler));

describe('useListKeyboardNavigation', () => {
  it('moves through the list and auditions each row', () => {
    const onMove = vi.fn();
    render(<List onMove={onMove} onActivate={vi.fn()} />);
    const list = screen.getByTestId('list');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });

    expect(onMove.mock.calls.map(([r]) => r.id)).toEqual(['a', 'b']);
  });

  it('claims ↑/↓ inside the list, so the player does NOT also change the volume', () => {
    // The whole arbitration. Without it one ↓ would move the row AND drop the
    // volume — both handlers acting on the same key.
    render(<List onActivate={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowUp' });
    expect(volumeChanges).toBe(0);
  });

  it('leaves ↑/↓ to the volume everywhere OUTSIDE the list', () => {
    render(<List onActivate={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('outside'), { key: 'ArrowDown' });
    expect(volumeChanges).toBe(1);
  });

  it('works while a row\'s own button has focus — which is what focused while browsing', () => {
    const onMove = vi.fn();
    render(<List onMove={onMove} onActivate={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Night Shift' }), { key: 'ArrowDown' });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(volumeChanges).toBe(0);
  });

  it('keeps its hands off a text field inside a row', () => {
    // The arrows move the caret there; the rename field must not skip rows.
    const onMove = vi.fn();
    render(<List onMove={onMove} onActivate={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText('rename Night Shift'), { key: 'ArrowDown' });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('leaves Enter to a focused button, but plays the row from plain content', () => {
    const onActivate = vi.fn();
    render(<List onActivate={onActivate} />);
    const list = screen.getByTestId('list');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    // Enter on a button belongs to that button (e.g. the ⋯ menu trigger).
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cold Front' }), { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();

    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onActivate.mock.calls.map(([r]) => r.id)).toEqual(['a']);
  });

  it('marks the cursor row with aria-current', () => {
    render(<List onActivate={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown' });
    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('data-row-index')).toBe('1');
  });

  it('follows the ROW through a re-sort, not the position', () => {
    const { rerender } = render(<List onActivate={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown' }); // on "a"

    rerender(<List items={[rows[2], rows[1], rows[0]]} onActivate={vi.fn()} />);
    // "a" is now last. The highlight went with it.
    expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-row-index')).toBe('2');
  });

  it('drops the cursor when a filter removes that row', () => {
    const { rerender } = render(<List onActivate={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown' }); // on "a"
    rerender(<List items={[rows[1], rows[2]]} onActivate={vi.fn()} />);
    expect(document.querySelector('[aria-current="true"]')).toBe(null);
  });

  it('warms the rows either side of the cursor', () => {
    const onNeighbours = vi.fn();
    render(<List onActivate={vi.fn()} onNeighbours={onNeighbours} />);
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown' }); // on "b"
    expect(onNeighbours.mock.calls[1][0].map((r: Row) => r.id)).toEqual(['c', 'a']);
  });

  it('ignores a modified arrow, so Shift-selection and shortcuts still work', () => {
    const onMove = vi.fn();
    render(<List onMove={onMove} onActivate={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(screen.getByTestId('list'), { key: 'ArrowDown', metaKey: true });
    expect(onMove).not.toHaveBeenCalled();
  });
});
