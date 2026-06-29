'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Loader2, MailCheck, AlertCircle, ArrowLeft, ShieldCheck } from 'lucide-react';

/**
 * /store/orders — re-download entry point.
 *
 * Downloads are account-gated: typing an email never reveals another buyer's
 * files. Submitting emails a secure magic link (HMAC-signed, 24h) that proves
 * inbox ownership; the link lands on /store/account/[token], which lists the
 * buyer's purchases + download links. The response is the same whether or not
 * the email has purchases, so it can't be used to probe who has bought.
 */
export default function OrdersPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(false);
    setLoading(true);
    try {
      const res = await fetch('/api/store/account/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send the link');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#090907] text-[#F7EBDD]">
      <div className="max-w-2xl mx-auto px-4 py-16 md:py-24">
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#9B9282] hover:text-[#D0C3AF] transition-colors mb-10"
        >
          <ArrowLeft size={11} />
          Back to store
        </Link>

        <div className="mb-10">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#9B9282] mb-3">
            Your downloads
          </p>
          <h1 className="text-[28px] md:text-[36px] font-bold leading-tight mb-3">
            Find your purchases
          </h1>
          <p className="text-[14px] text-[#B4AA99] leading-relaxed">
            Enter the email you used at checkout — we&apos;ll email you a secure link to your
            downloads. Your files are only ever shown to your verified inbox, never to anyone who
            just types your address.
          </p>
        </div>

        <form onSubmit={requestLink} className="mb-8">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#837B6D]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full bg-[#171511] border border-[#2B2821] focus:border-[#E7D7BE]/40 rounded-xl pl-9 pr-4 py-3 text-[14px] text-[#F7EBDD] placeholder-[#6E685B] outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="shrink-0 flex items-center gap-2 px-5 py-3 rounded-xl font-mono text-[11px] uppercase tracking-wider text-[#090907] bg-[#E7D7BE] hover:bg-[#F7EBDD] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : 'Email me a link'}
            </button>
          </div>
        </form>

        {sent && (
          <div className="flex items-start gap-2 text-[#6DC6A4] text-[13px] mb-6 p-4 rounded-lg bg-[#6DC6A4]/10 border border-[#6DC6A4]/20">
            <MailCheck size={16} className="shrink-0 mt-0.5" />
            <span>
              If <strong className="text-[#F7EBDD]">{email}</strong> has any purchases, a secure link
              to your downloads is on its way. Check your inbox (and spam) — the link expires in
              24&nbsp;hours.
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-[13px] mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        <p className="flex items-center gap-2 text-[12px] text-[#6E685B] mt-10">
          <ShieldCheck size={13} className="shrink-0 text-[#837B6D]" />
          Prefer a password-free account?{' '}
          <Link href="/store/account" className="text-[#E7D7BE] hover:text-[#F7EBDD] transition-colors">
            Sign in to your account
          </Link>
        </p>
      </div>
    </div>
  );
}
