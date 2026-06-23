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
import { Loader2, Layers, AlertCircle, Mail, RefreshCw, ShieldCheck } from 'lucide-react';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30000;

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const [phase, setPhase] = useState<'polling' | 'timeout' | 'error'>('polling');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!sessionId) return;

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
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-[20px] border border-red-400/20 bg-red-400/8">
          <AlertCircle size={28} className="text-red-400" />
        </div>
        <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#6E685B]">Project delivery</p>
        <p className="mb-1 text-[22px] font-bold leading-tight text-[#F7EBDD]">
          Missing session
        </p>
        <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-[#D0C3AF]">
          We could not find your purchase from this URL. Check your email for the secure link.
        </p>
      </Centered>
    );
  }

  if (phase === 'timeout') {
    return (
      <Centered>
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-[20px] border border-amber-400/20 bg-amber-400/8">
          <AlertCircle size={28} className="text-amber-400" />
        </div>
        <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#6E685B]">Project delivery</p>
        <p className="mb-2 text-[22px] font-bold leading-tight text-[#F7EBDD]">
          Still preparing your bundle
        </p>
        <p className="mx-auto mb-5 max-w-sm text-[12px] leading-relaxed text-[#D0C3AF]">
          Your payment went through, but we have not received the confirmation from Stripe yet. The bundle link is also in the confirmation email, or you can refresh in a few seconds.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-[#E7D7BE] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition-all hover:bg-[#F3E6D1] active:scale-[0.98]"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
          <Link
            href="/store/account"
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-[#3B372F] px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[#D0C3AF] transition-colors hover:border-[#6E685B] hover:text-[#F7EBDD]"
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
      <div className="relative mx-auto mb-5 size-16">
        <Loader2 size={64} className="absolute inset-0 animate-spin text-[#E7D7BE]" />
        <Layers size={20} className="absolute inset-0 m-auto text-[#E7D7BE]" />
      </div>
      <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-[#6E685B]">Project delivery</p>
      <p className="mb-2 text-[24px] font-bold leading-tight text-[#F7EBDD]">
        Preparing your bundle
      </p>
      <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-[#D0C3AF]">
        Finalising your purchase. This usually takes a couple of seconds.
      </p>
      <div className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[10px] font-mono text-[#6E685B]">
        <ShieldCheck size={11} />
        <span className="tabular-nums">{Math.floor(elapsed / 1000)}s elapsed</span>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#090907] px-6 py-10 text-center text-[#F7EBDD]">
      <div className="mx-auto flex min-h-[78vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-[28px] border border-[#211F1A] bg-[#11100d] px-6 py-10 shadow-[0_30px_90px_rgba(0,0,0,0.38)]">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function ProjectAccessGate() {
  return (
    <Suspense fallback={<Centered><Loader2 size={20} className="animate-spin text-[#9B9282]" /></Centered>}>
      <Inner />
    </Suspense>
  );
}
