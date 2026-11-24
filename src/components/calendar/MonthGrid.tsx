'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bell, Mic, Music, Plus, Users } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { Drawer } from '@/components/ui/Drawer';
import { dayKey, eventsOnDay, isMultiDay, laneCap, layoutMonth, type LayoutEvent, type WeekBar } from '@/lib/calendar/layout';

export interface MonthGridEvent extends LayoutEvent {
  type?: string | null;
  color?: string | null;
  notes?: string | null;
}

export interface MonthGridDay {
  date: number;
  isCurrentMonth: boolean;
  fullDate: Date;
}

// Fixed geometry: a day cell is DATE_ROW + lanes * LANE_H tall whatever it holds.
const DATE_ROW = 32;
const LANE_H = 20;
const LANE_GAP = 2;
const PAD_BOTTOM = 6;

export function rowHeight(lanes: number): number {
  return DATE_ROW + lanes * (LANE_H + LANE_GAP) + PAD_BOTTOM;
}

/** Below Tailwind's `sm`. Server and first client render read false, then it corrects. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return phone;
}

function EventIcon({ type, size = 9 }: { type?: string | null; size?: number }) {
  switch (type) {
    case 'release': return <Music size={size} aria-hidden="true" />;
    case 'studio': return <Mic size={size} aria-hidden="true" />;
    case 'meeting': return <Users size={size} aria-hidden="true" />;
    default: return <Bell size={size} aria-hidden="true" />;
  }
}

function spanLabel(ev: MonthGridEvent): string {
  const fmt = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (ev.end_date && dayKey(new Date(ev.end_date)) > dayKey(new Date(ev.date))) return `${fmt(ev.date)} – ${fmt(ev.end_date)}`;
  return fmt(ev.date);
}

/** Every event of one day. Event rows are focusable so a pill can land focus on its own entry. */
function DayList({ events, focusId }: { events: MonthGridEvent[]; focusId: string | null }) {
  return (
    <ul className="max-h-[min(60vh,360px)] space-y-0.5 overflow-y-auto px-1 py-1" aria-label="Events this day">
      {events.map((ev) => (
        <li
          key={ev.id}
          ref={(el) => { if (el && ev.id === focusId) el.focus(); }}
          tabIndex={0}
          title={ev.notes || ev.title}
          className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-white/[0.08] focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-white/30"
        >
          <span className="mt-0.5 shrink-0" style={{ color: ev.color || '#FFFFFF' }}><EventIcon type={ev.type} size={11} /></span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-[12px] leading-snug text-white/80">{ev.title}</span>
            <span className="mt-0.5 block text-[10px] font-mono uppercase tracking-wider text-white/40">
              {ev.type || 'event'} · {spanLabel(ev)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Open { day: Date; anchor: string; focusId: string | null }

export function MonthGrid({
  days, events, selectedDay, onSelectDay, onAddEvent,
}: {
  days: MonthGridDay[];
  events: MonthGridEvent[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
  onAddEvent: (d: Date) => void;
}) {
  const isPhone = useIsPhone();
  const lanes = laneCap(isPhone);
  // Phone: multi-day bars keep their single lane; every day with events gets ONE count chip in a row of its own
  // (the total for the day, not "+N more"). Single-day events are not drawn at all there.
  const rows = isPhone ? lanes + 1 : lanes;
  const height = rowHeight(rows);
  const dayDates = useMemo(() => days.map((d) => d.fullDate), [days]);
  const weeks = useMemo(
    () => layoutMonth(dayDates, isPhone ? events.filter(isMultiDay) : events, lanes),
    [dayDates, events, lanes, isPhone],
  );
  const totals = useMemo(
    () => (isPhone ? layoutMonth(dayDates, events, lanes).flatMap((w) => w.counts) : []),
    [dayDates, events, lanes, isPhone],
  );
  const [open, setOpen] = useState<Open | null>(null);
  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(selectedDay);

  const toggle = (next: Open) => {
    onSelectDay(next.day);
    setOpen((cur) => (cur?.anchor === next.anchor ? null : next));
  };
  const close = () => setOpen(null);
  const openEvents = open ? eventsOnDay(events, open.day) : [];

  /** One trigger. Desktop anchors the day popover to it; a phone opens the drawer instead. */
  const trigger = (anchor: string, day: Date, focusId: string | null, props: { className: string; style?: CSSProperties; label: string; children: React.ReactNode; title?: string }) => {
    const button = (ref?: (el: HTMLElement | null) => void) => (
      <button
        ref={ref}
        type="button"
        onClick={() => toggle({ day, anchor, focusId })}
        className={props.className}
        style={props.style}
        title={props.title}
        aria-label={props.label}
        aria-haspopup="dialog"
        aria-expanded={open?.anchor === anchor}
      >
        {props.children}
      </button>
    );
    if (isPhone) return button();
    return (
      <Popover
        key={anchor}
        open={open?.anchor === anchor}
        onOpenChange={(v) => { if (!v) close(); }}
        width={288}
        initialFocus
        label={`Events on ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
        trigger={({ ref }) => button(ref)}
      >
        <DayList events={openEvents} focusId={open?.focusId ?? null} />
      </Popover>
    );
  };

  const barNode = (bar: WeekBar<MonthGridEvent>, week: number) => {
    const ev = bar.event;
    const day = days[week * 7 + bar.startCol].fullDate;
    const anchor = `bar:${ev.id}:${week}:${bar.startCol}`;
    const radius = `${bar.continuesBefore ? 'rounded-l-none' : 'rounded-l-full'} ${bar.continuesAfter ? 'rounded-r-none' : 'rounded-r-full'}`;
    return (
      <div key={anchor} className="pointer-events-none flex min-w-0" style={{
        gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.lane + 1,
        marginLeft: bar.continuesBefore ? 0 : 4, marginRight: bar.continuesAfter ? 0 : 4,
      }}>
        {trigger(anchor, day, ev.id, {
          label: `${ev.title}, ${spanLabel(ev)}`,
          title: ev.notes ? `${ev.title} — ${ev.notes}` : ev.title,
          className: `pointer-events-auto flex h-5 min-w-0 flex-1 items-center gap-1 border border-white/[0.04] bg-white/[0.04] px-1.5 text-left text-[9px] font-medium outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-white/40 ${radius}`,
          style: { color: ev.color || '#FFFFFF' },
          children: (<><EventIcon type={ev.type} /><span className="truncate">{ev.title}</span></>),
        })}
      </div>
    );
  };

  return (
    <div className="flex-1">
      {weeks.map((wk, w) => (
        <div key={w} className="relative border-b border-white/10 last:border-b-0" style={{ height }}>
          <div className="absolute inset-0 grid grid-cols-7">
            {days.slice(w * 7, w * 7 + 7).map((day, c) => {
              const key = dayKey(day.fullDate);
              const isToday = key === todayKey;
              const isSelected = key === selectedKey;
              return (
                <div
                  key={c}
                  onClick={() => onSelectDay(day.fullDate)}
                  className={`group relative cursor-pointer border-r border-white/10 p-2 transition-all last:border-r-0 ${
                    !day.isCurrentMonth ? 'bg-[#08070a]' : ''
                  } ${isSelected ? 'z-10 bg-gradient-to-br from-white/10 to-[#161616]/40 ring-1 ring-inset ring-white/30' : 'hover:bg-white/[0.02]'}`}
                >
                  {isToday ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20 text-[10px] font-bold tabular-nums text-white/70">{day.date}</span>
                  ) : (
                    <span className={`text-[11px] font-mono tabular-nums ${day.isCurrentMonth ? 'text-white/80' : 'text-white/30'}`}>{day.date}</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onAddEvent(day.fullDate); }}
                    className="tap absolute right-1.5 top-1 flex size-5 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.04] text-white/60 opacity-0 transition-opacity hover:border-white/20 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`Add event on ${day.fullDate.toLocaleDateString()}`}
                  >
                    <Plus size={10} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>

          <div
            className="pointer-events-none absolute inset-x-0 z-20 grid grid-cols-7 gap-y-0.5"
            style={{ top: DATE_ROW, gridTemplateRows: `repeat(${rows}, ${LANE_H}px)` }}
          >
            {wk.bars.map((bar) => barNode(bar, w))}
            {!isPhone && wk.overflow.map((k, c) => k > 0 && (
              <div key={`more-${c}`} className="pointer-events-none flex min-w-0 px-1" style={{ gridColumn: c + 1, gridRow: lanes }}>
                {trigger(`more:${dayKey(days[w * 7 + c].fullDate)}`, days[w * 7 + c].fullDate, null, {
                  label: `${k} more event${k === 1 ? '' : 's'} on ${days[w * 7 + c].fullDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`,
                  className: 'pointer-events-auto h-5 min-w-0 flex-1 truncate rounded-full border border-white/10 bg-white/[0.06] px-1.5 text-center text-[9px] font-medium text-white/60 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white/80 focus-visible:ring-1 focus-visible:ring-white/40',
                  children: `+${k} more`,
                })}
              </div>
            ))}
            {isPhone && wk.counts.map((_, c) => {
              const total = totals[w * 7 + c] ?? 0;
              if (total === 0) return null;
              const date = days[w * 7 + c].fullDate;
              const first = eventsOnDay(events, date)[0];
              return (
                <div key={`count-${c}`} className="pointer-events-none flex min-w-0 justify-center px-1" style={{ gridColumn: c + 1, gridRow: rows }}>
                  {trigger(`count:${dayKey(date)}`, date, null, {
                    label: `${total} event${total === 1 ? '' : 's'} on ${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}, open list`,
                    className: 'pointer-events-auto inline-flex h-5 min-w-[28px] items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-1.5 text-[9px] font-medium tabular-nums text-white/70 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.10] focus-visible:ring-1 focus-visible:ring-white/40',
                    children: (<><span aria-hidden="true" className="size-1 rounded-full" style={{ background: first?.color || '#FFFFFF' }} />{total}</>),
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {isPhone && open && (
        <Drawer
          side="bottom"
          onClose={close}
          title={open.day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          description={`${openEvents.length} event${openEvents.length === 1 ? '' : 's'}`}
          closeLabel="Close day"
        >
          <DayList events={openEvents} focusId={open.focusId} />
        </Drawer>
      )}
    </div>
  );
}
