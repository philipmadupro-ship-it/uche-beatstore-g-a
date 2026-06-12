'use client';

import { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  ChevronLeft, ChevronRight, Plus, Loader2, Music, Mic, Users, Bell,
  Upload, History, MessageSquare, Send as SendIcon, Star, ArrowRight, Activity as ActivityIcon,
} from 'lucide-react';
import { AddEventModal } from '@/components/events/AddEventModal';
import Link from 'next/link';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: 'release' | 'studio' | 'meeting' | 'other';
  color?: string;
  notes?: string;
}

interface ActivityItem {
  id: string;
  kind: 'upload' | 'version' | 'comment' | 'send' | 'rating';
  at: string;
  title: string;
  subject_id?: string | null;
  subject_kind?: 'track' | 'project' | 'contact' | null;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  // The day the user clicked. Default to today on mount. The activity
  // panel hydrates whenever this changes — we treat it as the selection
  // axis for both the activity log and the "+" add-event flow.
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/events');
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.events || [];
      setEvents(list);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  // Re-fetch activity whenever the selected day changes. Range = [00:00, 24:00)
  // in local time so the recipient sees "what I did on this calendar day."
  // We convert to ISO for the API; the route validates + clamps.
  const fetchActivityForDay = useCallback(async (day: Date) => {
    setActivityLoading(true);
    try {
      const start = new Date(day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(day);
      end.setHours(23, 59, 59, 999);
      const url = `/api/activity?from=${start.toISOString()}&to=${end.toISOString()}`;
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok && Array.isArray(data.activity)) {
        setActivity(data.activity);
      } else {
        setActivity([]);
      }
    } catch {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivityForDay(selectedDay);
  }, [selectedDay, fetchActivityForDay]);

  const nextMonth = () => {
    const n = new Date(currentDate);
    n.setMonth(n.getMonth() + 1);
    setCurrentDate(n);
  };
  const prevMonth = () => {
    const p = new Date(currentDate);
    p.setMonth(p.getMonth() - 1);
    setCurrentDate(p);
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: { date: number; isCurrentMonth: boolean; fullDate: Date }[] = [];
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) days.push({ date: prevMonthDays - i, isCurrentMonth: false, fullDate: new Date(year, month - 1, prevMonthDays - i) });
    for (let i = 1; i <= daysInMonth; i++) days.push({ date: i, isCurrentMonth: true, fullDate: new Date(year, month, i) });
    const needed = 42 - days.length;
    for (let i = 1; i <= needed; i++) days.push({ date: i, isCurrentMonth: false, fullDate: new Date(year, month + 1, i) });
    return days;
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const calendarDays = getDaysInMonth(currentDate);

  const eventIcon = (type: string) => {
    switch (type) {
      case 'release': return <Music size={9} />;
      case 'studio': return <Mic size={9} />;
      case 'meeting': return <Users size={9} />;
      default: return <Bell size={9} />;
    }
  };

  return (
    <DashboardLayout>
      <PageContainer className="flex min-h-[calc(100vh-80px)] flex-col">
        <PageHeader
          eyebrow="Schedule"
          title="Calendar"
          description="Releases, sessions, sends. Tap any day to see what you did."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* Month nav — glass pill with the month-year label between
                  two chevrons. Backdrop-blur so it lifts off the page. */}
              <div className="inline-flex min-h-11 items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg-card)]">
                <button onClick={prevMonth} className="tap px-3 py-2 text-[var(--text-readable)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-primary)]" aria-label="Previous month">
                  <ChevronLeft size={13} aria-hidden="true" />
                </button>
                <span className="min-w-[150px] px-3 text-center text-[12px] font-medium tabular-nums text-[var(--text-primary)]">
                  {monthName}
                </span>
                <button onClick={nextMonth} className="tap px-3 py-2 text-[var(--text-readable)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-primary)]" aria-label="Next month">
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              </div>
              <Button
                onClick={() => { setSelectedDay(new Date()); setCurrentDate(new Date()); }}
                variant="secondary"
                size="sm"
                title="Jump to today"
              >
                Today
              </Button>
              <Button
                onClick={() => setShowAddModal(true)}
                variant="primary"
                leadingIcon={<Plus size={14} aria-hidden="true" />}
              >
                Add event
              </Button>
            </div>
          }
        />

        {/* Calendar grid + activity side panel. Stacks vertically below
            the lg breakpoint so the month grid stays large on tablets
            (the side panel slides under it instead of squeezing both). */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 mb-32 min-h-0">
          <Card className="relative flex flex-col overflow-hidden bg-gradient-to-br from-[#171511] to-[#090907]">
            {/* Day headers — slightly larger and warmer than before. */}
            <div className="grid grid-cols-7 border-b border-[#2B2821] bg-[#090907]/60 backdrop-blur-sm">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="py-3 text-center text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99]">{d}</div>
              ))}
            </div>

            <div className="flex-1 grid grid-cols-7 grid-rows-6">
              {calendarDays.map((day, i) => {
                const dayEvents = events.filter((e) => {
                  const ed = new Date(e.date);
                  return ed.getDate() === day.date && ed.getMonth() === day.fullDate.getMonth() && ed.getFullYear() === day.fullDate.getFullYear();
                });
                const isToday = new Date().toDateString() === day.fullDate.toDateString();
                const isSelected = selectedDay.toDateString() === day.fullDate.toDateString();

                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDay(day.fullDate)}
                    className={`border-r border-b border-[#2B2821] p-2 transition-all relative group min-h-[90px] cursor-pointer ${
                      !day.isCurrentMonth ? 'bg-[#08070a]' : ''
                    } ${
                      isSelected
                        ? 'bg-gradient-to-br from-[#342F27]/80 to-[#211F1A]/40 ring-1 ring-[#C9BCA8]/60 ring-inset z-10'
                        : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    {/* Date number — today gets a circular amber chip,
                        regular days are flat numerals. Pulls the user's
                        eye to "now" without shouting. */}
                    <div className="flex items-center gap-1.5">
                      {isToday ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#E7D7BE] text-black text-[10px] font-bold tabular-nums">
                          {day.date}
                        </span>
                      ) : (
                        <span className={`text-[11px] font-mono tabular-nums ${
                          day.isCurrentMonth ? 'text-[#D0C3AF]' : 'text-[#6E685B]'
                        }`}>
                          {day.date}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 space-y-0.5">
                      {dayEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors cursor-pointer border border-white/[0.04] truncate"
                          style={{ color: ev.color || '#F3E6D1' }}
                          title={ev.notes || ev.title}
                        >
                          {eventIcon(ev.type)}
                          <span className="truncate">{ev.title}</span>
                        </div>
                      ))}
                    </div>

                    {/* Quick-add affordance — only visible on hover so
                        empty cells don't carry pixel noise. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowAddModal(true); }}
                      className="tap absolute bottom-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.04] text-[#B4AA99] opacity-0 transition-opacity hover:border-[#C9BCA8]/40 hover:text-[#F3E6D1] group-hover:opacity-100"
                      aria-label={`Add event on ${day.fullDate.toLocaleDateString()}`}
                    >
                      <Plus size={10} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>

            {loading && (
              <div className="absolute inset-0 bg-[#090907]/70 backdrop-blur-sm flex items-center justify-center z-20">
                <Loader2 size={18} className="animate-spin text-[#6E685B]" />
              </div>
            )}
          </Card>

        {/* Activity side panel — the actions you actually took on the
            selected day, pulled from /api/activity. Closes the loop the
            user asked for: "see what I did today." */}
        <ActivityPanel
          day={selectedDay}
          items={activity}
          loading={activityLoading}
        />
        </div>
      </PageContainer>

      {showAddModal && <AddEventModal onClose={() => setShowAddModal(false)} onSuccess={fetchEvents} />}
    </DashboardLayout>
  );
}

// ─── Activity side panel ────────────────────────────────────────────────────
// Lives next to the month grid; renders the user's actions for the
// selected day. Each row has an icon (kind), a short human-readable
// label, a timecode, and (when possible) a deep link to the subject.
//
// Empty state is intentional: an empty day is the most common case for
// most days of the year, and we'd rather not put fake "nothing here"
// loading skeletons in front of it.

const KIND_ICON: Record<ActivityItem['kind'], typeof Upload> = {
  upload: Upload,
  version: History,
  comment: MessageSquare,
  send: SendIcon,
  rating: Star,
};

const KIND_COLOR: Record<ActivityItem['kind'], string> = {
  upload: 'text-[#F3E6D1]',
  version: 'text-[#D0C3AF]',
  comment: 'text-[#8ecf9f]',
  send: 'text-[#D6BE7A]',
  rating: 'text-[#eca9a9]',
};

function subjectHref(item: ActivityItem): string | null {
  if (!item.subject_id || !item.subject_kind) return null;
  switch (item.subject_kind) {
    case 'track':   return `/library/${item.subject_id}`;
    case 'project': return `/projects/${item.subject_id}`;
    case 'contact': return '/contacts';
    default:        return null;
  }
}

function ActivityPanel({
  day, items, loading,
}: {
  day: Date;
  items: ActivityItem[];
  loading: boolean;
}) {
  const isToday = new Date().toDateString() === day.toDateString();
  const heading = isToday
    ? 'Today'
    : day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <Card className="relative flex flex-col overflow-hidden bg-gradient-to-b from-[#161410]/85 via-[#0e0d0a]/85 to-[#090907]/95">
      {/* Warm radial wash — same lit-from-corner pattern the drawer
          header + share modal use. Pinned in the top-left. */}
      <div
        className="absolute -top-12 -left-12 w-32 h-32 rounded-full pointer-events-none opacity-25"
        style={{ background: 'radial-gradient(circle, #E7D7BE 0%, transparent 70%)' }}
      />
      <header className="relative z-10 px-5 py-4 border-b border-white/[0.04]">
        <div className="flex items-center gap-2 mb-1.5">
          <ActivityIcon size={11} className="text-[#F3E6D1]" />
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#D0C3AF]">Activity</p>
        </div>
        <h3 className="text-[15px] font-medium text-white tracking-tight">{heading}</h3>
        <p className="text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] mt-1">
          {items.length} action{items.length === 1 ? '' : 's'} on this day
        </p>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={14} className="animate-spin text-[#6E685B]" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-[11px] leading-relaxed text-[var(--text-readable)]">
            No tracked actions on this day. Uploads, comments, sends, and ratings will land here.
          </p>
        ) : (
          <ul className="py-2 px-2 space-y-0.5">
            {items.map((it) => {
              const Icon = KIND_ICON[it.kind];
              const color = KIND_COLOR[it.kind];
              const time = new Date(it.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
              const href = subjectHref(it);
              const body = (
                <>
                  <div className={`shrink-0 w-7 h-7 rounded-full bg-white/[0.03] border border-white/[0.05] flex items-center justify-center ${color}`}>
                    <Icon size={12} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-[#F7EBDD] leading-snug">{it.title}</p>
                    <p className="text-[9px] font-mono text-[#B4AA99] uppercase tracking-wider mt-0.5">
                      {time}
                      {it.subject_kind && ` · ${it.subject_kind}`}
                    </p>
                  </div>
                  {href && <ArrowRight size={10} className="text-[#6E685B] shrink-0" />}
                </>
              );
              return (
                <li key={it.id}>
                  {href ? (
                    <Link href={href} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-3 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 10px; }
      `}</style>
    </Card>
  );
}
