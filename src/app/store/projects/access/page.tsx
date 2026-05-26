'use client';

/**
 * /store/projects/access?session_id=cs_xxx
 *
 * Post-checkout landing for project bundle purchases. Polls for the
 * project_access_links row the Stripe webhook creates, then redirects
 * to /store/projects/access/[token] (the Spotify-style listening
 * page).
 *
 * Stripe's return_url fires the moment the buyer's card is approved,
 * which can outrun the webhook by a second or two. We poll up to ~30s
 * and surface a clear "still preparing" message if it takes longer
 * (rare; means the webhook is delayed or failed). The token URL is
 * also in the buyer's confirmation email so the worst case is them
 * opening the email instead of waiting.
 */

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Layers, AlertCircle, Mail, RefreshCw } from 'lucide-react';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30000;

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const [phase, setPhase] = useState<'polling' | 'timeout' | 'error'>('polling');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!sessionId) { setPhase('error'); return; }

    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(
          `/api/store/projects/access/by-session?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            stop = true;
            router.replace(`/store/projects/access/${data.token}`);
            return;
          }
        }
      } catch {
        // network blip — keep polling
      }
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= POLL_TIMEOUT_MS) {
        setPhase('timeout');
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
    return () => { stop = true; };
  }, [sessionId, router]);

  if (!sessionId || phase === 'error') {
    return (
      <Centered>
        <AlertCircle size={28} className="text-red-400 mb-3" />
        <p className="text-[14px] text-[#E8DCC8] font-medium mb-1">
          Missing session
        </p>
        <p className="text-[11px] text-[#a08a6a] max-w-sm">
          We couldn't find your purchase from this URL. Check your email for the secure link.
        </p>
      </Centered>
    );
  }

  if (phase === 'timeout') {
    return (
      <Centered>
        <AlertCircle size={28} className="text-amber-400 mb-3" />
        <p className="text-[14px] text-[#E8DCC8] font-medium mb-1">
          Still preparing your bundle…
        </p>
        <p className="text-[11px] text-[#a08a6a] max-w-sm mb-5">
          Your payment went through, but we haven't received the confirmation from Stripe yet. The bundle link is also in the confirmation email — you can open it now, or refresh in a few seconds.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-white/[0.06] border border-white/[0.12] text-[#E8DCC8] text-[10px] font-mono uppercase tracking-wider hover:bg-white/[0.10] transition-colors"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
          <Link
            href="/store/account"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-[#2d2620] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#3a3328] text-[10px] font-mono uppercase tracking-wider transition-colors"
          >
            <Mail size={11} />
            My account
          </Link>
        </div>
      </Centered>
    );
  }

  // polling state
  return (
    <Centered>
      <div className="relative w-12 h-12 mb-4">
        <Loader2 size={48} className="absolute inset-0 animate-spin text-[#D4BFA0]" />
        <Layers size={20} className="absolute inset-0 m-auto text-[#D4BFA0]" />
      </div>
      <p className="text-[14px] text-[#E8DCC8] font-medium mb-1">
        Preparing your bundle…
      </p>
      <p className="text-[11px] text-[#a08a6a] max-w-sm">
        Finalising your purchase — this usually takes a couple of seconds.
      </p>
      <p className="mt-4 text-[10px] font-mono text-[#3a3328] tabular-nums">
        {Math.floor(elapsed / 1000)}s elapsed
      </p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0907] flex flex-col items-center justify-center text-center px-6">
      {children}
    </div>
  );
}

export default function ProjectAccessGate() {
  return (
    <Suspense fallback={<Centered><Loader2 size={20} className="animate-spin text-[#5a5142]" /></Centered>}>
      <Inner />
    </Suspense>
  );
}
