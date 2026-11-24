/**
 * Month-view layout for the calendar, kept pure so the rules are testable
 * (the page used to size cells by content, so a busy day stretched its row
 * and the whole card).
 *
 * Model: a week is 7 columns. Every event that touches the week gets ONE lane
 * (a row of bars) for the whole week, assigned greedily in a stable order
 * (earliest start, then longest, then id), so a multi-day bar sits at the same
 * height on every day it covers. A cell shows at most `maxLanes` rows; when a
 * day has events it cannot show, its last row becomes a "+K more" pill and the
 * lanes from that row down are hidden on that day only. A hidden event counts
 * once per day it covers, which is what each cell's pill says.
 */

export interface LayoutEvent {
  id: string;
  title: string;
  date: string;
  end_date?: string | null;
}

/** Events shown per day cell, including the row the "+K more" pill takes. */
export const DESKTOP_LANES = 3;
export const PHONE_LANES = 1;

export function laneCap(isPhone: boolean): number {
  return isPhone ? PHONE_LANES : DESKTOP_LANES;
}

/** Local calendar day as `YYYY-MM-DD` (sorts and compares as text). */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** First and last local day an event covers. An end before the start is ignored. */
export function eventDayRange(ev: LayoutEvent): { startKey: string; endKey: string } {
  const startKey = dayKey(new Date(ev.date));
  const end = ev.end_date ? dayKey(new Date(ev.end_date)) : startKey;
  return { startKey, endKey: end < startKey ? startKey : end };
}

export interface WeekBar<T extends LayoutEvent = LayoutEvent> {
  event: T;
  lane: number;
  /** 0–6, inclusive. */
  startCol: number;
  endCol: number;
  /** The event runs on before this segment starts (earlier week, or a hidden day). */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface WeekLayout<T extends LayoutEvent = LayoutEvent> {
  bars: WeekBar<T>[];
  /** Per column: events covering the day. */
  counts: number[];
  /** Per column: the number behind that day's "+K more" pill (0 = no pill). */
  overflow: number[];
  /** Per column: lanes that may draw (maxLanes, or one fewer when a pill takes the last row). */
  visibleLanes: number[];
}

function compareEvents(a: LayoutEvent, b: LayoutEvent): number {
  const ra = eventDayRange(a);
  const rb = eventDayRange(b);
  if (ra.startKey !== rb.startKey) return ra.startKey < rb.startKey ? -1 : 1;
  if (ra.endKey !== rb.endKey) return ra.endKey > rb.endKey ? -1 : 1; // longer first
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function layoutWeek<T extends LayoutEvent>(week: Date[], events: T[], maxLanes: number): WeekLayout<T> {
  const cap = Math.max(1, Math.floor(maxLanes));
  const keys = week.map(dayKey);
  const cols = keys.length;

  type Placed = { event: T; lane: number; first: number; last: number };
  const placed: Placed[] = [];
  const used: boolean[][] = []; // used[lane][col]

  for (const event of [...events].sort(compareEvents)) {
    const { startKey, endKey } = eventDayRange(event);
    let first = -1;
    let last = -1;
    for (let c = 0; c < cols; c++) {
      if (keys[c] >= startKey && keys[c] <= endKey) {
        if (first < 0) first = c;
        last = c;
      }
    }
    if (first < 0) continue;
    let lane = 0;
    for (;; lane++) {
      const row = (used[lane] ??= new Array<boolean>(cols).fill(false));
      let free = true;
      for (let c = first; c <= last; c++) if (row[c]) { free = false; break; }
      if (free) { for (let c = first; c <= last; c++) row[c] = true; break; }
    }
    placed.push({ event, lane, first, last });
  }

  const counts: number[] = new Array(cols).fill(0);
  const overflow: number[] = new Array(cols).fill(0);
  const visibleLanes: number[] = new Array(cols).fill(cap);
  for (let c = 0; c < cols; c++) {
    const covering = placed.filter((p) => p.first <= c && c <= p.last);
    counts[c] = covering.length;
    if (covering.some((p) => p.lane >= cap)) {
      visibleLanes[c] = cap - 1;
      overflow[c] = covering.filter((p) => p.lane >= cap - 1).length;
    }
  }

  const weekStart = keys[0];
  const weekEnd = keys[cols - 1];
  const bars: WeekBar<T>[] = [];
  for (const p of placed) {
    const { startKey, endKey } = eventDayRange(p.event);
    let c = p.first;
    while (c <= p.last) {
      if (p.lane >= visibleLanes[c]) { c++; continue; }
      let end = c;
      while (end + 1 <= p.last && p.lane < visibleLanes[end + 1]) end++;
      bars.push({
        event: p.event,
        lane: p.lane,
        startCol: c,
        endCol: end,
        continuesBefore: c > p.first || startKey < weekStart,
        continuesAfter: end < p.last || endKey > weekEnd,
      });
      c = end + 1;
    }
  }

  return { bars, counts, overflow, visibleLanes };
}

/** Split a flat list of days (a multiple of 7) into week layouts. */
export function layoutMonth<T extends LayoutEvent>(days: Date[], events: T[], maxLanes: number): WeekLayout<T>[] {
  const weeks: WeekLayout<T>[] = [];
  for (let i = 0; i + 7 <= days.length; i += 7) weeks.push(layoutWeek(days.slice(i, i + 7), events, maxLanes));
  return weeks;
}

/** Every event covering a day, for the day list: earliest start first, then title. */
export function eventsOnDay<T extends LayoutEvent>(events: T[], day: Date): T[] {
  const key = dayKey(day);
  return events
    .filter((e) => { const r = eventDayRange(e); return r.startKey <= key && key <= r.endKey; })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title) || a.id.localeCompare(b.id)));
}
