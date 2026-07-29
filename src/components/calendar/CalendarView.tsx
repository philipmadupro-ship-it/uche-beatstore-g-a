'use client';

import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type?: string | null;
}

export function CalendarView() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    fetch('/api/calendar')
      .then(res => res.json())
      .then((data: unknown) => setEvents(Array.isArray(data) ? data as CalendarEvent[] : []))
      .catch(console.error);
  }, []);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  return (
    <div className="bg-[#0D0D0A] border border-white/10 rounded-3xl overflow-hidden shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
      {/* Header */}
      <div className="p-8 border-b border-white/10 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight text-white">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40 mt-1">Release Schedule & Milestones</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-[#090907] border border-white/10 rounded-xl p-1">
            <button onClick={prevMonth} className="p-2 hover:bg-white/[0.05] rounded-lg transition-colors text-white/40 hover:text-white">
              <ChevronLeft size={18} />
            </button>
            <button onClick={nextMonth} className="p-2 hover:bg-white/[0.05] rounded-lg transition-colors text-white/40 hover:text-white">
              <ChevronRight size={18} />
            </button>
          </div>
          <LiquidGlassButton>
            <Plus size={14} />
            New Event
          </LiquidGlassButton>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 border-b border-white/10">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="p-4 text-center text-[9px] font-black uppercase tracking-[0.4em] text-white/40 border-r border-white/10 last:border-r-0">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 min-h-[600px]">
        {days.map((day, i) => {
          const dayEvents = events.filter(e => isSameDay(new Date(e.date), day));
          return (
            <div 
              key={day.toString()} 
              className={`
                p-4 border-r border-b border-white/10 transition-colors
                ${!isSameMonth(day, currentMonth) ? 'bg-[#090907]/50 opacity-20' : 'hover:bg-white/[0.05]/50'}
                ${(i + 1) % 7 === 0 ? 'border-r-0' : ''}
              `}
            >
              <span className={`text-[10px] font-black tracking-widest ${isSameDay(day, new Date()) ? 'text-white' : 'text-white/40'}`}>
                {format(day, 'd')}
              </span>
              <div className="mt-4 space-y-2">
                {dayEvents.map(event => (
                  <div 
                    key={event.id}
                    className="p-2 rounded-lg bg-white/[0.05] border-l-4 border-l-[#FFFFFF] shadow-sm group cursor-pointer hover:bg-white/20 transition-all"
                  >
                    <p className="text-[10px] font-black uppercase tracking-wider text-white line-clamp-1">{event.title}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <div className="w-1 h-1 rounded-full bg-white" />
                      <span className="text-[8px] font-bold uppercase tracking-widest text-white/40">{event.type || 'Event'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
