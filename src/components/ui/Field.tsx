'use client';

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '@/lib/utils';

type SharedProps = {
  label: string;
  helperText?: string;
  error?: string;
  icon?: ReactNode;
  className?: string;
  inputClassName?: string;
};

type InputProps = SharedProps &
  InputHTMLAttributes<HTMLInputElement> & {
    multiline?: false;
  };

type TextareaProps = SharedProps &
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    multiline: true;
  };

export type FieldProps = InputProps | TextareaProps;

export const Field = forwardRef<HTMLInputElement | HTMLTextAreaElement, FieldProps>(function Field(
  {
    label,
    helperText,
    error,
    icon,
    className,
    inputClassName,
    id,
    multiline,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const helperId = helperText ? `${fieldId}-helper` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(' ') || undefined;
  const inputClasses = cn(
    'w-full rounded-xl border border-[var(--border)] bg-[var(--bg-page)] text-xs text-[var(--text-primary)]',
    'placeholder:text-[#9B9282] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-spring)]',
    'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/25',
    'disabled:cursor-not-allowed disabled:opacity-50',
    icon ? 'pl-10 pr-4' : 'px-4',
    multiline ? 'min-h-28 py-3 resize-y' : 'min-h-11 py-3',
    error && 'border-[#8d3a2f] focus:border-[#ff8b73] focus:ring-[#ff8b73]/20',
    inputClassName,
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={fieldId}
        className="ml-1 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-readable)]"
      >
        {label}
      </label>
      <div className="relative">
        {icon && (
          <span
            className={cn(
              'pointer-events-none absolute left-3 text-[#9B9282]',
              multiline ? 'top-3.5' : 'top-1/2 -translate-y-1/2',
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        {multiline ? (
          <textarea
            ref={ref as Ref<HTMLTextAreaElement>}
            id={fieldId}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={describedBy}
            className={inputClasses}
            {...(props as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input
            ref={ref as Ref<HTMLInputElement>}
            id={fieldId}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={describedBy}
            className={inputClasses}
            {...(props as InputHTMLAttributes<HTMLInputElement>)}
          />
        )}
      </div>
      {helperText && <p id={helperId} className="ml-1 text-[11px] leading-5 text-[var(--text-readable)]">{helperText}</p>}
      {error && <p id={errorId} className="ml-1 text-[11px] leading-5 text-[#ffb7a8]">{error}</p>}
    </div>
  );
});
