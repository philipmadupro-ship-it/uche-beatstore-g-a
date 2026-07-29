'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });

    setIsLoading(false);

    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({
        type: 'success',
        text: 'Check your email for a password reset link.',
      });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090907] p-4 text-white">
      <div className="w-full max-w-sm space-y-6 bg-[#0D0D0A] p-8 rounded-lg border border-white/10">
        <div>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to login
          </Link>

          <h1 className="text-xl font-bold tracking-tight uppercase">Reset Password</h1>
          <p className="mt-2 text-sm text-white/80">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-email" className="block text-xs font-medium uppercase text-white/40 mb-1">
              Email Address
            </label>
            <div className="relative">
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                disabled={isLoading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#090907] border border-white/10 px-3 py-2 pl-10 text-white placeholder-white/30 focus:outline-none focus:border-white/30 rounded disabled:opacity-50 transition-colors"
                placeholder="you@example.com"
              />
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            </div>
          </div>

          {message && (
            <div className={`flex items-start gap-2 p-3 rounded text-sm border ${
              message.type === 'success'
                ? 'bg-[#1a2e1a]/20 border-[#2e5c2e]/30 text-[#85e085]'
                : 'bg-[#2e1a1a]/20 border-[#5c2e2e]/30 text-[#e08585]'
            }`}>
              {message.type === 'success'
                ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
              <p>{message.text}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !email.trim()}
            className="w-full flex justify-center py-3 px-4 border border-white/50 rounded text-sm font-medium text-black bg-white font-semibold shadow-md hover:bg-white/90 hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 transition-all uppercase tracking-widest"
          >
            {isLoading ? 'Sending…' : 'Send Reset Link'}
          </button>
        </form>
      </div>
    </div>
  );
}
