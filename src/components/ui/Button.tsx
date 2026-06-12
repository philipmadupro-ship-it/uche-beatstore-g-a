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
    'bg-[var(--text-primary)] text-[#090907] border-transparent hover:bg-white shadow-[0_12px_36px_rgba(232,220,200,0.12)]',
  accent:
    'bg-[var(--accent)] text-[#090907] border-transparent hover:bg-[var(--accent-light)] shadow-[0_12px_36px_rgba(231,215,190,0.16)]',
  secondary:
    'bg-[var(--bg-card)] text-[var(--text-primary)] border-[var(--border)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-hover)]',
  ghost:
    'bg-transparent text-[var(--text-readable)] border-transparent hover:bg-white/[0.04] hover:text-[var(--text-primary)]',
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
