'use client';

/**
 * "Next drop" countdown strip on /store. Shows the nearest scheduled
 * track with a live HH:MM:SS countdown and a "Notify me" email form.
 *
 * Hides itself when there are no upcoming drops (the empty state is
 * worse than nothing).
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Bell, Check, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/useToast';

interface Drop {
  id: string;
  title: string;
  cover_url: string | null;
  type: string;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  scheduled_publish_at: string;
}

function fmtCountdown(targetMs: number): string {
  const diff = Math.max(0, targetMs - Date.now());
  const totalSecs = Math.floor(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

export function DropCountdown({ accentColor }: { accentColor: string }) {
  const { data } = useQuery({
    queryKey: ['drops'],
    queryFn: async () => {
      const res = await fetch('/api/store/drops');
      if (!res.ok) return [] as Drop[];
      const json = await res.json();
      return (json.drops ?? []) as Drop[];
    },
    refetchInterval: 60_000,
  });

  const next = data?.[0];

  // Tick the countdown once per second. State is just `now` so the
  // re-render fires; we read fmtCountdown synchronously from it.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!next) return;
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [next]);

  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const subscribe = useMutation({
    mutationFn: async () => {
      if (!next) throw new Error('no drop selected');
      const res = await fetch('/api/store/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: next.id, email: email.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    },
    onSuccess: () => {
      setSubscribed(true);
      toast.success("You'll get an email when it drops");
    },
    onError: (err: Error) => toast.error('Could not subscribe', err.message),
  });

  if (!next) return null;
  const targetMs = new Date(next.scheduled_publish_at).getTime();

  return (
    <div className="max-w-[1600px] mx-auto px-4 md:px-8 pt-6">
      <div
        className="relative rounded-2xl border border-white/[0.08] bg-[#14110d]/70 backdrop-blur-xl overflow-hidden p-4 md:p-5"
        style={{ boxShadow: `0 0 0 1px ${accentColor}1a` }}
      >
        {next.cover_url && (
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-cover bg-center opacity-15 blur-2xl scale-110"
            style={{ backgroundImage: `url(${next.cover_url})` }}
          />
        )}

        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-14 h-14 rounded-lg overflow-hidden bg-[#0a0907] border border-white/[0.08] shrink-0">
              {next.cover_url
                ? <img src={next.cover_url} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-[#2A2418] to-[#0a0907]" />}
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-mono uppercase tracking-[0.3em]" style={{ color: accentColor }}>
                Next drop in
              </p>
              <p
                className="text-[24px] md:text-[28px] font-bold text-white leading-none tabular-nums mt-0.5"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmtCountdown(targetMs)}
              </p>
              <p className="text-[12px] text-white/65 truncate mt-1">
                <span className="font-medium text-white">{next.title}</span>
                {next.bpm ? <span className="text-white/40"> · {next.bpm} BPM</span> : null}
                {next.key ? <span className="text-white/40"> · {next.key}{next.scale === 'minor' ? 'm' : ''}</span> : null}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {subscribed ? (
              <span
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-mono uppercase tracking-wider"
                style={{ backgroundColor: `${accentColor}26`, color: accentColor }}
              >
                <Check size={12} />
                Subscribed
              </span>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="bg-[#0a0907] border border-[#1f1a13] rounded-full px-3 py-2 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] min-w-0 w-44 md:w-56"
                />
                <button
                  type="button"
                  onClick={() => subscribe.mutate()}
                  disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || subscribe.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-black text-[11px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-40 hover:opacity-90"
                  style={{ backgroundColor: accentColor }}
                >
                  {subscribe.isPending ? <Loader2 size={11} className="animate-spin" /> : <Bell size={11} />}
                  Notify me
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
