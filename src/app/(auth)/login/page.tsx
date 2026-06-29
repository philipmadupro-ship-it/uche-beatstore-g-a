'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';

const baseSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = baseSchema.extend({
  confirmPassword: z.string().optional(),
});

const signUpSchema = baseSchema.extend({
  confirmPassword: z.string().min(6, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type FormData = {
  email: string;
  password: string;
  confirmPassword?: string;
};

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const supabase = createClient();

  // Where to land after auth. Read from ?next (set by the proxy when it bounces
  // a protected page), but only accept a safe same-origin path — never another
  // /login (that's the redirect loop) or a protocol-relative //evil.com.
  const resolveNext = (): string => {
    if (typeof window === 'undefined') return '/library';
    const raw = new URLSearchParams(window.location.search).get('next') || '/library';
    const safe = /^\/(?!\/)/.test(raw) && !raw.startsWith('/login');
    return safe ? raw : '/library';
  };

  const { register, handleSubmit, formState: { errors }, reset, clearErrors } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(isSignUp ? signUpSchema : loginSchema) as any,
    mode: 'onSubmit' // Only validate on submit to avoid premature errors
  });

  const toggleAuthMode = () => {
    setIsSignUp(!isSignUp);
    setMessage(null);
    clearErrors();
    reset(); // Clear form when switching modes
  };

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    setMessage(null);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      setIsLoading(false);

      if (error) {
        setMessage({ type: 'error', text: error.message });
      } else {
        setMessage({ type: 'success', text: 'Check your email to confirm your account!' });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      setIsLoading(false);

      if (error) {
        setMessage({ type: 'error', text: error.message });
      } else {
        // Hard navigation (not router.push) so the server/proxy re-reads the
        // freshly-set session cookie in a new request. A client-side push can
        // race the cookie write — the proxy then sees no user and bounces back
        // to /login, which is the reported redirect loop.
        window.location.assign(resolveNext());
      }
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Carry `next` through the OAuth round-trip so the callback lands the
        // user where they were headed (it defaulted to /library and dropped it).
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(resolveNext())}`,
      },
    });
    if (error) {
      setGoogleLoading(false);
      setMessage({ type: 'error', text: error.message });
    }
  };

  const formDisabled = isLoading || googleLoading;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090907] p-4 text-[#F7EBDD]">
      <div className="w-full max-w-sm space-y-8 bg-[#1A1813] p-8 rounded-lg border border-[#2B2821]">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight uppercase">U2C Beatstore</h1>
          <p className="mt-2 text-sm text-[#D0C3AF]">
            {isSignUp ? 'Create an account' : 'Sign in to continue'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={formDisabled}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded bg-white text-black hover:bg-[#F7EBDD] active:scale-[0.98] disabled:opacity-50 transition-all text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#E7D7BE] focus:ring-offset-2 focus:ring-offset-[#1A1813]"
        >
          <GoogleGlyph />
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[#2B2821]" />
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#837B6D]">or</span>
          <div className="flex-1 h-px bg-[#2B2821]" />
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div>
            <label htmlFor="email" className="block text-xs font-medium uppercase text-[#837B6D] mb-1">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              disabled={formDisabled}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
              className={`w-full bg-[#090907] border ${errors.email ? 'border-red-500/50' : 'border-[#2B2821]'} px-3 py-2 text-[#F7EBDD] placeholder-[#837B6D] focus:outline-none focus:border-[#E7D7BE] rounded disabled:opacity-50 transition-colors`}
              placeholder="you@example.com"
              {...register('email')}
            />
            {errors.email && (
              <p id="email-error" className="mt-1 text-xs text-red-500/90">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium uppercase text-[#837B6D] mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                disabled={formDisabled}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? "password-error" : undefined}
                className={`w-full bg-[#090907] border ${errors.password ? 'border-red-500/50' : 'border-[#2B2821]'} px-3 py-2 pr-10 text-[#F7EBDD] placeholder-[#837B6D] focus:outline-none focus:border-[#E7D7BE] rounded disabled:opacity-50 transition-colors`}
                placeholder="••••••••"
                {...register('password')}
              />
              <button
                type="button"
                tabIndex={-1}
                disabled={formDisabled}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#837B6D] hover:text-[#D0C3AF] disabled:opacity-50 focus:outline-none"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <p id="password-error" className="mt-1 text-xs text-red-500/90">{errors.password.message}</p>
            )}
            {!isSignUp && (
              <div className="mt-1.5 text-right">
                <a
                  href="/reset-password"
                  className="text-xs text-[#D0C3AF] hover:text-[#E7D7BE] transition-colors"
                >
                  Forgot password?
                </a>
              </div>
            )}
          </div>

          {isSignUp && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label htmlFor="confirmPassword" className="block text-xs font-medium uppercase text-[#837B6D] mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  disabled={formDisabled}
                  aria-invalid={!!errors.confirmPassword}
                  aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
                  className={`w-full bg-[#090907] border ${errors.confirmPassword ? 'border-red-500/50' : 'border-[#2B2821]'} px-3 py-2 text-[#F7EBDD] placeholder-[#837B6D] focus:outline-none focus:border-[#E7D7BE] rounded disabled:opacity-50 transition-colors`}
                  placeholder="••••••••"
                  {...register('confirmPassword')}
                />
              </div>
              {errors.confirmPassword && (
                <p id="confirmPassword-error" className="mt-1 text-xs text-red-500/90">{errors.confirmPassword.message}</p>
              )}
            </div>
          )}

          {message && (
            <div className={`mt-4 flex items-center gap-2 p-3 rounded text-sm border ${
              message.type === 'success' 
                ? 'bg-[#1a2e1a]/20 border-[#2e5c2e]/30 text-[#85e085]' 
                : 'bg-[#2e1a1a]/20 border-[#5c2e2e]/30 text-[#e08585]'
            }`}>
              {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <p>{message.text}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={formDisabled}
            className="w-full flex justify-center py-3 px-4 mt-6 border border-[#C9BCA8] rounded text-sm font-medium text-white bg-[#E7D7BE] hover:bg-[#C9BCA8] focus:outline-none focus:ring-2 focus:ring-[#E7D7BE] focus:ring-offset-2 focus:ring-offset-[#1A1813] disabled:opacity-50 transition-all uppercase tracking-widest"
          >
            {isLoading ? 'Processing…' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>

          <div className="mt-6 text-center text-sm text-[#D0C3AF]">
            <span className="mr-2">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}
            </span>
            <button
              type="button"
              onClick={toggleAuthMode}
              disabled={formDisabled}
              className="text-[#E7D7BE] hover:text-white transition-colors focus:outline-none focus:underline disabled:opacity-50"
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
