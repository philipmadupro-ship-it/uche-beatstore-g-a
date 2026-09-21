'use client';

/**
 * Small shared controls for the studio panels.
 *
 * Hand-rolled rather than pulled from a UI library, matching the rest of the
 * project (no Radix / Headless UI by choice — see AGENTS.md). They exist so the
 * inspector and the tool panels do not each re-invent a labelled number field.
 */

import { cn } from '@/lib/utils';

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{children}</span>
  );
}

export function PanelSection({ title, children, action }: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border-t border-white/10 px-4 py-4 first:border-t-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <FieldLabel>{title}</FieldLabel>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function NumberField({
  label, value, min, max, step = 1, suffix, onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <span className="relative">
        <input
          type="number"
          value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isNaN(next)) return;
            onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
          }}
          className="h-9 w-full border border-white/10 bg-[#090907] px-2 text-sm tabular-nums text-white/90 outline-none focus:border-white/40"
        />
        {suffix ? (
          <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-white/40">{suffix}</span>
        ) : null}
      </span>
    </label>
  );
}

export function SliderField({
  label, value, min, max, step = 0.01, format, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        <span className="font-mono text-[10px] tabular-nums text-white/60">
          {format ? format(value) : Math.round(value * 100) / 100}
        </span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none bg-white/10 accent-white"
      />
    </label>
  );
}

export function ColorField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <span className="flex items-center gap-2 border border-white/10 bg-[#090907] p-1">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} hex value`}
          className="w-full bg-transparent font-mono text-xs uppercase text-white/90 outline-none"
        />
      </span>
    </label>
  );
}

export function SegmentedField<T extends string>({
  label, options, value, onChange, columns = 2,
}: {
  label?: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  columns?: number;
}) {
  return (
    <div className="grid gap-1.5">
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 truncate border px-1.5 text-[11px] capitalize transition-colors',
              option.value === value
                ? 'border-white/40 bg-white/[0.12] text-white/90'
                : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white/90',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StudioButton({
  children, onClick, variant = 'ghost', disabled, title, type = 'button', className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'ghost' | 'accent';
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-9 items-center justify-center gap-2 px-3 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'accent'
          ? 'border border-white/25 bg-white/[0.10] text-white/90 hover:border-white/40 hover:bg-white/[0.18]'
          : 'border border-white/10 text-white/60 hover:border-white/20 hover:text-white/90',
        className,
      )}
    >
      {children}
    </button>
  );
}
