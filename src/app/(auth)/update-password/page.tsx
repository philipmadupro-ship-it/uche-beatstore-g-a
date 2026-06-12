'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Eye, EyeOff, CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: "Passwords don't match." });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.updateUser({ password });

    setIsLoading(false);

    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: 'Password updated! Redirecting…' });
      setTimeout(() => {
        router.push('/library');
        router.refresh();
      }, 1500);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090907] p-4 text-[#F7EBDD]">
      <div className="w-full max-w-sm space-y-6 bg-[#1A1813] p-8 rounded-lg border border-[#2B2821]">
        <div className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-[#E7D7BE]/10 border border-[#E7D7BE]/20 flex items-center justify-center">
            <Lock className="w-5 h-5 text-[#E7D7BE]" />
          </div>
          <h1 className="text-xl font-bold tracking-tight uppercase">Set New Password</h1>
          <p className="mt-2 text-sm text-[#D0C3AF]">
            Enter your new password below.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-xs font-medium uppercase text-[#837B6D] mb-1">
              New Password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                disabled={isLoading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#090907] border border-[#2B2821] px-3 py-2 pr-10 text-[#F7EBDD] placeholder-[#837B6D] focus:outline-none focus:border-[#E7D7BE] rounded disabled:opacity-50 transition-colors"
                placeholder="••••••••"
              />
              <button
                type="button"
                tabIndex={-1}
                disabled={isLoading}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#837B6D] hover:text-[#D0C3AF] disabled:opacity-50 focus:outline-none"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {password.length > 0 && password.length < 6 && (
              <p className="mt-1 text-xs text-[#D0C3AF]">Must be at least 6 characters</p>
            )}
          </div>

          <div>
            <label htmlFor="confirm-new-password" className="block text-xs font-medium uppercase text-[#837B6D] mb-1">
              Confirm Password
            </label>
            <input
              id="confirm-new-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              disabled={isLoading}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full bg-[#090907] border ${
                confirmPassword && confirmPassword !== password ? 'border-red-500/50' : 'border-[#2B2821]'
              } px-3 py-2 text-[#F7EBDD] placeholder-[#837B6D] focus:outline-none focus:border-[#E7D7BE] rounded disabled:opacity-50 transition-colors`}
              placeholder="••••••••"
            />
            {confirmPassword && confirmPassword !== password && (
              <p className="mt-1 text-xs text-red-500/90">Passwords don&apos;t match</p>
            )}
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
            disabled={isLoading || password.length < 6 || password !== confirmPassword}
            className="w-full flex justify-center py-3 px-4 border border-[#C9BCA8] rounded text-sm font-medium text-white bg-[#E7D7BE] hover:bg-[#C9BCA8] focus:outline-none focus:ring-2 focus:ring-[#E7D7BE] focus:ring-offset-2 focus:ring-offset-[#1A1813] disabled:opacity-50 transition-all uppercase tracking-widest"
          >
            {isLoading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
