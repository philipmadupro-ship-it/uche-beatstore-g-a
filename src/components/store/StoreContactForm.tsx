'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, Send, User } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import type { CreatorProfile } from './types';

interface Props {
  creator: CreatorProfile | null;
  accentColor: string;
}

export function StoreContactForm({ creator, accentColor }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));
  const nameErr = touched.name && !name.trim() ? 'Name is required' : null;
  const emailErr = touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Valid email required' : null;
  const msgErr = touched.message && !message.trim() ? 'Message is required' : null;
  const canSubmit = !sending && name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && message.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, email: true, message: true });
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !message.trim()) {
      setError('Please fill in all required fields correctly.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/store/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setSent(true);
      setName(''); setEmail(''); setSubject(''); setMessage('');
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-white/10">
      <div className="max-w-xl mx-auto px-4 md:px-10 py-16">
        <div className="text-center mb-8">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/40 mb-2">Get in touch</p>
          <h2 className="text-xl font-medium text-white">
            Work with {creator?.display_name || 'the producer'}
          </h2>
          <p className="mt-2 text-[12px] text-white/40">
            Licensing inquiries, custom beats, features — drop a message.
          </p>
        </div>

        {sent ? (
          <div className="text-center py-10 px-6 rounded-2xl bg-white/[0.04] border border-white/10">
            <CheckCircle2 size={28} className="text-[#6DC6A4] mx-auto mb-3" />
            <p className="text-[14px] font-medium text-white mb-1">Message sent!</p>
            <p className="text-[12px] text-white/40">You&apos;ll hear back soon.</p>
            <button onClick={() => setSent(false)} className="mt-4 text-[10px] font-mono uppercase tracking-wider text-white/60 hover:text-white transition-colors">
              Send another
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="store-contact-name" className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                  Your name <span className="text-white/40">*</span>
                </label>
                <input
                  id="store-contact-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => touch('name')}
                  aria-invalid={nameErr ? 'true' : 'false'}
                  aria-describedby={nameErr ? 'store-contact-name-error' : undefined}
                  placeholder="Artist or real name"
                  className={`w-full bg-white/[0.04] border rounded-lg px-3 py-2.5 text-[12px] text-white placeholder:text-white/40 focus:outline-none transition-colors ${nameErr ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/10 focus:border-white/20'}`}
                />
                {nameErr && <p id="store-contact-name-error" role="alert" className="mt-1 text-[10px] text-red-400">{nameErr}</p>}
              </div>
              <div>
                <label htmlFor="store-contact-email" className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                  Email <span className="text-white/40">*</span>
                </label>
                <input
                  id="store-contact-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => touch('email')}
                  aria-invalid={emailErr ? 'true' : 'false'}
                  aria-describedby={emailErr ? 'store-contact-email-error' : undefined}
                  placeholder="your@email.com"
                  className={`w-full bg-white/[0.04] border rounded-lg px-3 py-2.5 text-[12px] text-white placeholder:text-white/40 focus:outline-none transition-colors ${emailErr ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/10 focus:border-white/20'}`}
                />
                {emailErr && <p id="store-contact-email-error" role="alert" className="mt-1 text-[10px] text-red-400">{emailErr}</p>}
              </div>
            </div>
            <div>
              <label htmlFor="store-contact-subject" className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">Subject</label>
              <input
                id="store-contact-subject"
                type="text"
                autoComplete="off"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Beat licensing, custom request, feature…"
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="store-contact-message" className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">
                Message <span className="text-white/40">*</span>
              </label>
              <textarea
                id="store-contact-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onBlur={() => touch('message')}
                aria-invalid={msgErr ? 'true' : 'false'}
                aria-describedby={msgErr ? 'store-contact-message-error' : undefined}
                rows={5}
                maxLength={2000}
                placeholder="Tell me about your project or what you're looking for…"
                className={`w-full bg-white/[0.04] border rounded-lg px-3 py-2.5 text-[12px] text-white placeholder:text-white/40 focus:outline-none transition-colors resize-none leading-relaxed ${msgErr ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/10 focus:border-white/20'}`}
              />
              <div className="flex items-center justify-between mt-1">
                {msgErr
                  ? <p id="store-contact-message-error" role="alert" className="text-[10px] text-red-400">{msgErr}</p>
                  : <span />}
                <p className="text-right text-[9px] font-mono text-white/40">{message.length}/2000</p>
              </div>
            </div>
            {error && (
              <p className="text-[11px] text-red-400 bg-red-400/5 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-black font-bold text-[12px] uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-40"
              style={{ backgroundColor: accentColor }}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        )}

        <div className="mt-10 pt-6 border-t border-white/10 text-center">
          <Link
            href="/store/account"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 hover:text-white/80 transition-colors"
          >
            <User size={11} />
            Already purchased? View my account
          </Link>
        </div>
      </div>
    </div>
  );
}
