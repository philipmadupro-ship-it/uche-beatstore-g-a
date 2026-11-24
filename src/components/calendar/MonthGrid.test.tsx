// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MonthGrid, type MonthGridDay, type MonthGridEvent } from './MonthGrid';

function monthDays(year: number, month: number): MonthGridDay[] {
  const first = new Date(year, month, 1).getDay();
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - first + i);
    return { date: d.getDate(), isCurrentMonth: d.getMonth() === month, fullDate: d };
  });
}
const at = (day: number, h: number) => new Date(2026, 10, day, h).toISOString();
const EVENTS: MonthGridEvent[] = [
  { id: 'solo', title: 'Solo day', date: at(3, 9), type: 'release' },
  ...Array.from({ length: 15 }, (_, i) => ({ id: `b${String(i).padStart(2, '0')}`, title: `Busy ${i}`, date: at(21, 8 + (i % 10)), type: 'studio' })),
  { id: 'camp', title: 'Studio camp', date: at(9, 9), end_date: at(11, 9), type: 'studio' },
];

function setPhone(phone: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: phone && q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
function mount() {
  return render(<MonthGrid days={monthDays(2026, 10)} events={EVENTS} selectedDay={new Date(2026, 10, 24)} onSelectDay={vi.fn()} onAddEvent={vi.fn()} />);
}

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);

describe('MonthGrid busy day (desktop)', () => {
  beforeEach(() => setPhone(false));

  it('shows two events and a "+13 more" pill instead of 15 pills', () => {
    mount();
    expect(screen.getAllByRole('button', { name: /^Busy \d+, Nov 21$/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /13 more events on November 21/ })).toBeTruthy();
  });

  it('opens a labelled dialog with every event of the day, moves focus in, closes on Escape', () => {
    mount();
    const pill = screen.getByRole('button', { name: /13 more events/ });
    fireEvent.click(pill);
    const dialog = screen.getByRole('dialog', { name: /Events on .*November 21/ });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(15);
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a visible event opens the same list with that event focused; the full title is on the pill', () => {
    mount();
    const pill = screen.getAllByRole('button', { name: /^Busy \d+, Nov 21$/ })[1];
    const title = pill.getAttribute('title')!;
    expect(title).toMatch(/^Busy \d+$/);
    fireEvent.click(pill);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement?.textContent).toContain(title);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('draws a multi-day event once as a bar, not once per day', () => {
    mount();
    expect(screen.getAllByRole('button', { name: /^Studio camp, Nov 9 – Nov 11$/ })).toHaveLength(1);
  });
});

describe('MonthGrid busy day (phone)', () => {
  beforeEach(() => setPhone(true));

  it('keeps a lone event as its pill and gives a busy day only "+K"', () => {
    mount();
    expect(screen.getByRole('button', { name: /^Solo day/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Busy \d+, / })).toBeNull();
    const pill = screen.getByRole('button', { name: /15 more events on November 21/ });
    expect(pill.textContent).toBe('+15');
  });

  it('opens the bottom drawer with the whole day', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /15 more events/ }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getAllByRole('listitem')).toHaveLength(15);
  });
});
