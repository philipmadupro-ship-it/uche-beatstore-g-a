// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { isOwnedByAnotherControl, listKeyAction, neighbourIndices } from './list-navigation';

describe('listKeyAction', () => {
  it('moves down and up one row', () => {
    expect(listKeyAction('ArrowDown', 2, 10)).toEqual({ type: 'move', index: 3 });
    expect(listKeyAction('ArrowUp', 2, 10)).toEqual({ type: 'move', index: 1 });
  });

  it('CLAMPS at the ends rather than wrapping', () => {
    // Holding ↓ past the last row must not throw the producer back to the
    // first one mid-audition — the reason this is not nextEnabledIndex.
    expect(listKeyAction('ArrowDown', 9, 10)).toEqual({ type: 'move', index: 9 });
    expect(listKeyAction('ArrowUp', 0, 10)).toEqual({ type: 'move', index: 0 });
  });

  it('lands on the first row from nothing selected, in either direction', () => {
    // ↑ must not jump to the bottom of a list nobody has started browsing.
    expect(listKeyAction('ArrowDown', -1, 10)).toEqual({ type: 'move', index: 0 });
    expect(listKeyAction('ArrowUp', -1, 10)).toEqual({ type: 'move', index: 0 });
  });

  it('jumps to the ends', () => {
    expect(listKeyAction('Home', 5, 10)).toEqual({ type: 'move', index: 0 });
    expect(listKeyAction('End', 5, 10)).toEqual({ type: 'move', index: 9 });
  });

  it('plays the selected row on Enter', () => {
    expect(listKeyAction('Enter', 4, 10)).toEqual({ type: 'activate', index: 4 });
  });

  it('does nothing on Enter with no row selected', () => {
    expect(listKeyAction('Enter', -1, 10)).toBe(null);
  });

  it('recovers when the list shrank under the cursor', () => {
    // A filter change can leave the index past the new end.
    expect(listKeyAction('ArrowUp', 40, 10)).toEqual({ type: 'move', index: 8 });
    expect(listKeyAction('Enter', 40, 10)).toEqual({ type: 'activate', index: 9 });
  });

  it('leaves keys it does not own alone, so volume keeps them elsewhere', () => {
    expect(listKeyAction('ArrowLeft', 2, 10)).toBe(null);
    expect(listKeyAction(' ', 2, 10)).toBe(null);
    expect(listKeyAction('a', 2, 10)).toBe(null);
  });

  it('does nothing on an empty list', () => {
    expect(listKeyAction('ArrowDown', -1, 0)).toBe(null);
  });
});

describe('neighbourIndices', () => {
  it('returns the rows either side', () => {
    expect(neighbourIndices(5, 10)).toEqual([6, 4]);
  });

  it('never returns an index off either end', () => {
    expect(neighbourIndices(0, 10)).toEqual([1]);
    expect(neighbourIndices(9, 10)).toEqual([8]);
    expect(neighbourIndices(0, 1)).toEqual([]);
  });
});

describe('isOwnedByAnotherControl', () => {
  const inside = (html: string, selector: string) => {
    document.body.innerHTML = html;
    return document.querySelector(selector);
  };

  it('leaves every key to a text field', () => {
    const input = inside('<input />', 'input');
    expect(isOwnedByAnotherControl(input, 'ArrowDown')).toBe(true);
    expect(isOwnedByAnotherControl(input, 'Enter')).toBe(true);
  });

  it('leaves every key to a menu, which runs its own arrow navigation', () => {
    const item = inside('<div role="menu"><button>Rename</button></div>', 'button');
    expect(isOwnedByAnotherControl(item, 'ArrowDown')).toBe(true);
  });

  it('leaves every key to a slider, whose arrows move its value', () => {
    const slider = inside('<div role="slider" tabindex="0"></div>', '[role="slider"]');
    expect(isOwnedByAnotherControl(slider, 'ArrowUp')).toBe(true);
  });

  it('lets a button keep Enter', () => {
    // Enter on the ⋯ trigger opens the menu; it must not play the row.
    const button = inside('<button>⋯</button>', 'button');
    expect(isOwnedByAnotherControl(button, 'Enter')).toBe(true);
  });

  it('does NOT let a button keep the arrows', () => {
    // A row's play button is exactly what has focus while browsing. Refusing
    // arrows there would make the feature dead in the one place it is used.
    const button = inside('<button>Play</button>', 'button');
    expect(isOwnedByAnotherControl(button, 'ArrowDown')).toBe(false);
  });

  it('claims keys pressed on plain row content', () => {
    const row = inside('<div data-row><span>Night Shift</span></div>', 'span');
    expect(isOwnedByAnotherControl(row, 'ArrowDown')).toBe(false);
    expect(isOwnedByAnotherControl(row, 'Enter')).toBe(false);
  });

  it('tolerates a target that is not an element', () => {
    expect(isOwnedByAnotherControl(null, 'ArrowDown')).toBe(false);
  });
});
