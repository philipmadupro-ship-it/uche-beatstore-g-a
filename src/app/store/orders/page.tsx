'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, AlertCircle, CheckCircle2, Loader2, LockKeyhole, Mail,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function OrdersPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email.trim());

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/store/account/me');
      else setCheckingSession(false);
    });
  }, [router]);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid) {
      setError('Enter the email you used at checkout.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { error: otpError } = await createClient().auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/store/account/me`,
        },
      });
      if (otpError) throw otpError;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send account link');
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090907]">
        <Loader2 size={20} className="animate-spin text-white/40" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090907] text-white">
      <div className="mx-auto max-w-lg px-4 py-14 md:py-20">
        <Link
          href="/store"
          className="mb-10 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 transition-colors hover:text-white"
        >
          <ArrowLeft size={12} />
          Back to store
        </Link>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
          <div className="mb-7">
            <span className="mb-4 grid size-11 place-items-center rounded-full border border-white/20 bg-white/10 text-white">
              <LockKeyhole size={17} />
            </span>
            <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.28em] text-white/80">
              Secure order access
            </p>
            <h1 className="text-[28px] font-bold leading-tight text-white">
              Re-downloads live inside your buyer account.
            </h1>
              <p className="mt-3 text-[13px] leading-relaxed text-white/60">
              Enter the checkout email and we will send a private sign-in link. Email alone never reveals purchases.
            </p>
          </div>

          {sent ? (
            <div className="rounded-xl border border-[#6DC6A4]/25 bg-[#6DC6A4]/10 px-5 py-6 text-center">
              <CheckCircle2 size={26} className="mx-auto mb-3 text-[#6DC6A4]" />
              <p className="text-[13px] font-medium text-white">Secure link sent</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/60">
                Check {email.trim()} for your buyer account sign-in link.
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setEmail(''); }}
                className="mt-5 text-[10px] font-mono uppercase tracking-wider text-white/60 transition-colors hover:text-white"
              >
                Use another email
              </button>
            </div>
          ) : (
            <form onSubmit={requestLink} className="space-y-4" noValidate>
              <div>
                <label htmlFor="order-email" className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">
                  Checkout email
                </label>
                <div className="relative">
                  <Mail size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    id="order-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full rounded-xl border border-white/10 bg-[#090907] py-3 pl-9 pr-3 text-[13px] text-white outline-none transition-colors placeholder:text-white/40 focus:border-white/20"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-[12px] text-red-300">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!emailValid || submitting}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-[11px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                {submitting ? 'Sending...' : 'Send secure link'}
              </button>
            </form>
          )}

          <div className="mt-6 border-t border-white/10 pt-5">
            <Link
              href="/store/account"
              className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white"
            >
              Prefer a persistent account? Sign in here.
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
