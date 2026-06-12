'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Mail, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function AccountSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const disabled = submitting || googleLoading;

  // Already signed in → go straight to account
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/store/account/me');
    });
  }, [router]);

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/store/account/me`,
      },
    });
    if (oauthErr) {
      setGoogleLoading(false);
      setError(oauthErr.message);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid) { setError('Enter a valid email.'); return; }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/store/account/me`,
      },
    });
    setSubmitting(false);
    if (otpErr) {
      setError(otpErr.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090907] p-4 text-[#F7EBDD]">
      <div className="w-full max-w-sm">
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] hover:text-[#F7EBDD] transition-colors mb-8"
        >
          <ArrowLeft size={12} />
          Back to store
        </Link>

        <div className="bg-[#1A1813] rounded-lg border border-[#2B2821] p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight uppercase text-white">U2C Beatstore</h1>
            <p className="mt-2 text-sm text-[#D0C3AF]">
              {sent ? 'Check your inbox' : 'Sign in to your account'}
            </p>
          </div>

          {sent ? (
            <div className="rounded-xl border border-[#6DC6A4]/25 bg-[#0e1f17]/40 px-5 py-6 text-center">
              <CheckCircle2 size={26} className="text-[#6DC6A4] mx-auto mb-3" />
              <p className="text-[13px] font-medium text-[#F7EBDD] mb-1">Email sent to {email.trim()}</p>
              <p className="text-[11px] text-[#D0C3AF] leading-relaxed">
                Tap the button in the email to sign in. Works on any device — no password needed.
              </p>
              <button
                onClick={() => { setSent(false); setEmail(''); }}
                className="mt-5 text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#F7EBDD] transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              {/* Google OAuth */}
              <button
                type="button"
                onClick={handleGoogle}
                disabled={disabled}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded bg-white text-black hover:bg-[#F7EBDD] active:scale-[0.98] disabled:opacity-50 transition-all text-sm font-medium"
              >
                <GoogleGlyph />
                {googleLoading ? 'Redirecting…' : 'Continue with Google'}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#2B2821]" />
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#837B6D]">or</span>
                <div className="flex-1 h-px bg-[#2B2821]" />
              </div>

              {/* Email OTP */}
              <form onSubmit={handleEmail} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="buyer-email" className="block text-xs font-medium uppercase text-[#837B6D] mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#837B6D] pointer-events-none" />
                    <input
                      id="buyer-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      disabled={disabled}
                      className="w-full bg-[#090907] border border-[#2B2821] rounded pl-9 pr-3 py-2.5 text-[13px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#E7D7BE] disabled:opacity-50 transition-colors"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 rounded border bg-[#2e1a1a]/20 border-[#5c2e2e]/30 text-[#e08585] text-sm">
                    <AlertCircle size={14} className="shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={disabled || !emailValid}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded border border-[#C9BCA8] text-sm font-medium uppercase tracking-widest bg-[#E7D7BE] hover:bg-[#C9BCA8] text-black disabled:opacity-40 transition-all"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                  {submitting ? 'Sending…' : 'Continue with Email'}
                </button>

                <p className="text-[10px] text-[#9B9282] text-center leading-relaxed">
                  No password. First-time emails create your account automatically.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
