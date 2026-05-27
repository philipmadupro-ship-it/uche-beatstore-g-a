'use client';

/**
 * /store/account — buyer sign-in entry.
 *
 * Uses Supabase magic-link OTP (`signInWithOtp`). First-time emails get
 * an auth.users row created automatically, so a buyer who lands here
 * gets a persistent cross-device account on their first click — no
 * password, no separate sign-up form. The link delivers them back via
 * /auth/callback with `?next=/store/account/me`, where their library
 * (history, favorites, playlists) is rendered against the auth session.
 *
 * The legacy 24-hour token route (/store/account/[token]) is kept for
 * old emails already in the wild — both surfaces co-exist.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function AccountSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // If a session already exists, jump straight to the library view.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/store/account/me');
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid) { setError('Enter a valid email.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // shouldCreateUser defaults to true — first-time emails get an
          // auth.users row, repeat sign-ins reuse it.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/store/account/me`,
        },
      });
      if (otpErr) throw new Error(otpErr.message);
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Could not send the link. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors mb-8"
        >
          <ArrowLeft size={12} />
          Back to store
        </Link>

        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-2">My account</p>
        <h1 className="text-[28px] font-bold text-white leading-tight tracking-tight font-heading">
          Sign in or create account
        </h1>
        <p className="mt-3 text-[13px] text-[#a08a6a] leading-relaxed">
          Enter your email — we'll send a one-tap sign-in link. Your purchases, favorites and playlists follow you across devices.
        </p>

        {sent ? (
          <div className="mt-8 rounded-2xl border border-[#6DC6A4]/25 bg-[#0e1f17]/40 px-5 py-6 text-center">
            <CheckCircle2 size={26} className="text-[#6DC6A4] mx-auto mb-3" />
            <p className="text-[14px] font-medium text-[#E8DCC8] mb-1">Check your inbox</p>
            <p className="text-[11px] text-[#a08a6a] leading-relaxed">
              We sent a sign-in link to <span className="text-[#E8DCC8]">{email.trim()}</span>. Click it on any device to land back in your account.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(''); }}
              className="mt-5 text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-3" noValidate>
            <div className="relative">
              <Mail
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338] pointer-events-none"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                className="w-full bg-[#14110d] border border-[#1f1a13] rounded-lg pl-10 pr-3 py-3 text-[13px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] transition-colors"
              />
            </div>
            {error && (
              <p className="text-[11px] text-red-400 bg-red-400/5 border border-red-400/20 rounded px-3 py-2">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !emailValid}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#D4BFA0] hover:bg-[#E8D8B8] disabled:opacity-40 text-black text-[12px] font-bold uppercase tracking-wider transition-all"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {submitting ? 'Sending…' : 'Continue with email'}
            </button>
            <p className="text-[10px] text-[#5a5142] leading-relaxed pt-1">
              No password. First-time emails create your account automatically. Sign in again any time from any device.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
