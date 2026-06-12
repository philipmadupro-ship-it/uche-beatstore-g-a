import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  doubleBezel?: boolean;
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, children, doubleBezel = false, interactive = false, ...props },
  ref,
) {
  const core = (
    <div
      ref={doubleBezel ? undefined : ref}
      className={cn(
        'rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)]',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        interactive &&
          'transition-[transform,border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:border-[var(--border-hover)] hover:bg-[var(--bg-hover)]',
        doubleBezel ? 'h-full' : className,
      )}
      {...props}
    >
      {children}
    </div>
  );

  if (!doubleBezel) return core;

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[1.25rem] border border-white/[0.04] bg-white/[0.025] p-1 shadow-[0_18px_60px_rgba(0,0,0,0.22)]',
        className,
      )}
    >
      {core}
    </div>
  );
});
