// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListRow } from './ListRow';

/**
 * The rule these cover: a clickable row must not WRAP its slots in the
 * clickable element.
 *
 * It used to render the whole row as a `<button>`, so every control inside it
 * — the trailing "open in new tab" anchor, and later an inline rename field
 * and a ⋯ menu — was a button or an anchor nested inside a button. That is
 * invalid HTML: React reports a hydration error and what the inner control
 * actually does is left to the browser. It was only caught by reading the dev
 * server's log, because the row still looked and behaved fine in the layout
 * that happened to be on screen.
 */
describe('ListRow', () => {
  it('does not nest interactive slot content inside the row activator', () => {
    render(
      <ListRow
        label="Open Night Drive"
        onClick={() => {}}
        title="Night Drive"
        trailing={<a href="/x">Open</a>}
        leading={<button type="button">Select</button>}
      />,
    );

    const activator = screen.getByRole('button', { name: 'Open Night Drive' });
    expect(activator.querySelector('a')).toBeNull();
    expect(activator.querySelector('button')).toBeNull();
    // …and the controls are still on the page, just not inside it.
    expect(screen.getByRole('link', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
  });

  it('gives the activator an accessible name of its own', () => {
    // The activator is a stretched overlay with no text, so without a label it
    // would be an unnamed control to a screen reader.
    render(<ListRow label="Open Night Drive" onClick={() => {}} title="Night Drive" />);
    expect(screen.getByRole('button', { name: 'Open Night Drive' })).toBeTruthy();
  });

  it('still activates the row', () => {
    const onClick = vi.fn();
    render(<ListRow label="Open row" onClick={onClick} title="Night Drive" />);
    screen.getByRole('button', { name: 'Open row' }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders a link row as a link, not a button', () => {
    render(<ListRow label="Open contact" href="/contacts/1" title="Ada" />);
    expect(screen.getByRole('link', { name: 'Open contact' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders no activator at all when the row is not clickable', () => {
    render(<ListRow title="Night Drive" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('lets the title take its own clicks only when it owns a control', () => {
    const { rerender, container } = render(
      <ListRow label="Open" onClick={() => {}} title="Night Drive" />,
    );
    const titleBlock = () => container.querySelector('.min-w-0.flex-1')!;
    // Plain text: clicks fall through to the row activator underneath.
    expect(titleBlock().className).not.toContain('pointer-events-auto');

    rerender(
      <ListRow label="Open" onClick={() => {}} titleInteractive title={<button type="button">Edit</button>} />,
    );
    expect(titleBlock().className).toContain('pointer-events-auto');
  });
});
