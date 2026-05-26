'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, Loader2, CheckCircle2 } from 'lucide-react';

export default function AccountRequestPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailValid) { setError('Enter a valid email.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/store/account/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
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
          Access your purchases
        </h1>
        <p className="mt-3 text-[13px] text-[#a08a6a] leading-relaxed">
          Enter the email you used at checkout. We'll send you a secure link to view every license and bundle you've bought — no password required.
        </p>

        {sent ? (
          <div className="mt-8 rounded-2xl border border-[#6DC6A4]/25 bg-[#0e1f17]/40 px-5 py-6 text-center">
            <CheckCircle2 size={26} className="text-[#6DC6A4] mx-auto mb-3" />
            <p className="text-[14px] font-medium text-[#E8DCC8] mb-1">Check your inbox</p>
            <p className="text-[11px] text-[#a08a6a] leading-relaxed">
              If we have any record of your purchases at <span className="text-[#E8DCC8]">{email.trim()}</span>, the link is on its way. Expires in 24 hours.
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
              {submitting ? 'Sending…' : 'Email me the link'}
            </button>
            <p className="text-[10px] text-[#5a5142] leading-relaxed pt-1">
              The link expires after 24 hours. Anyone with the link can see those purchases — keep it private.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
