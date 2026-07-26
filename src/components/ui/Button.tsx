'use client';

import { Loader2 } from 'lucide-react';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  trailingIcon?: ReactNode;
  leadingIcon?: ReactNode;
  iconOnly?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'relative overflow-hidden bg-white/15 text-white border border-white/25 hover:bg-white/25 hover:border-white/40 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),_0_4px_12px_rgba(0,0,0,0.2)]',
  accent:
    'relative overflow-hidden bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:border-white/35 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),_0_4px_12px_rgba(0,0,0,0.15)]',
  secondary:
    'relative overflow-hidden bg-white/[0.04] text-white border border-white/10 hover:border-white/20 hover:bg-white/[0.08] backdrop-blur-lg shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]',
  ghost:
    'bg-transparent text-white/70 border-transparent hover:bg-white/[0.06] hover:text-white',
  danger:
    'bg-[#2a1111] text-[#ffb7a8] border-[#5a241c] hover:bg-[#381612] hover:border-[#7a3428]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 py-2 text-[10px]',
  md: 'min-h-11 px-4 py-2.5 text-[11px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    children,
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled,
    trailingIcon,
    leadingIcon,
    iconOnly = false,
    type = 'button',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'tap group inline-flex shrink-0 items-center justify-center gap-2 rounded-full border font-mono font-bold uppercase tracking-[0.18em]',
        'transition-[transform,background-color,border-color,color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-spring)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-page)]',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        sizeClasses[size],
        iconOnly && 'aspect-square px-0',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      ) : (
        leadingIcon
      )}
      {children}
      {trailingIcon && !loading && (
        <span
          className={cn(
            'grid size-7 place-items-center rounded-full transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] group-hover:translate-x-0.5',
            variant === 'primary' || variant === 'accent'
              ? 'bg-black/[0.08]'
              : 'bg-white/[0.06]',
          )}
          aria-hidden="true"
        >
          {trailingIcon}
        </span>
      )}
    </button>
  );
});
