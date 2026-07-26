'use client';

import Image from 'next/image';
import { useState } from 'react';
import { X, CheckCircle2, Loader2 } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import type { StoreTrack } from './types';

interface Props {
  track: StoreTrack;
  onClose: () => void;
  accentColor: string;
}

export function FreeDownloadModal({ track, onClose, accentColor }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required.'); return; }
    if (!emailValid) { setError('Enter a valid email address.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/store/free-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, track_id: track.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const a = document.createElement('a');
      a.href = data.download_url;
      a.download = track.title || 'beat';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setSuccess(true);
      setTimeout(() => onClose(), 2000);
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Download failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative bg-white/[0.04] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-white/40 hover:text-white/80 transition-colors">
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          {track.cover_url && (
            <Image
              src={track.cover_url}
              alt=""
              width={48}
              height={48}
              className="w-12 h-12 rounded-lg object-cover shrink-0"
              unoptimized
            />
          )}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-1">Free download</p>
            <p className="text-[14px] font-semibold text-white truncate max-w-[200px]">{track.title}</p>
          </div>
        </div>

        {success ? (
          <div className="py-8 text-center">
            <CheckCircle2 size={32} className="text-[#6DC6A4] mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-white mb-1">Download started!</p>
            <p className="text-[11px] text-white/40">Check your downloads folder.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-white/60 mb-4 leading-relaxed">
              Enter your email to get the download. We&apos;ll occasionally send new releases — no spam.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name (optional)"
                className="w-full bg-white/[0.02] border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20 transition-colors"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com *"
                required
                className="w-full bg-white/[0.02] border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20 transition-colors"
              />
              {error && (
                <p className="text-[11px] text-red-400 bg-red-400/5 border border-red-400/20 rounded px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-black font-bold text-[12px] uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: accentColor }}
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                {submitting ? 'Preparing…' : 'Download Free'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
