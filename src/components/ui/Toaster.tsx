'use client';

import { useEffect, useState } from 'react';
import { useToastStore, type Toast } from '@/hooks/useToast';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

const ICONS = {
  info:    Info,
  success: CheckCircle2,
  error:   AlertCircle,
  warning: AlertTriangle,
} as const;

const ACCENTS = {
  info:    'border-white/10 text-white',
  success: 'border-emerald-900/40 text-emerald-400',
  error:   'border-red-900/40 text-red-400',
  warning: 'border-amber-900/40 text-amber-400',
} as const;

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      // Centring lives here, on the container, so the card's transform stays
      // free for the entrance keyframe. `inset-x-0` + `items-center` rather
      // than `left-1/2 -translate-x-1/2` for exactly that reason.
      className="fixed top-0 inset-x-0 flex flex-col items-center gap-2 px-4 pointer-events-none"
      style={{
        zIndex: 'var(--z-toast)',
        // Clears the Dynamic Island / notch. Without the inset the banner
        // tucks under the status bar on a notched iPhone, which is the
        // opposite of the effect.
        paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
      }}
      aria-live="polite"
      // NOT aria-atomic. With `true` the entire region is re-announced on any
      // change, so adding a third toast makes a screen reader read all three
      // again from the top. Each card is its own status/alert; the region only
      // needs to announce what was added.
      aria-relevant="additions"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICONS[toast.kind];
  const accent = ACCENTS[toast.kind];
  const [paused, setPaused] = useState(false);

  // Hold the card while the pointer or keyboard focus is on it. A 3.5s toast
  // carrying a description is easy to lose halfway through reading, and a
  // toast with action buttons could previously vanish while being tabbed to.
  useEffect(() => {
    if (!paused) return;
    const store = useToastStore.getState();
    store.hold(toast.id);
    return () => useToastStore.getState().release(toast.id);
  }, [paused, toast.id]);

  return (
    <div
      role={toast.kind === 'error' || toast.kind === 'warning' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      // `animate-in slide-in-from-right-4 fade-in` used to sit here and did
      // nothing at all: this project has no tailwindcss-animate plugin, so
      // those utilities compile away. The motion is real CSS now.
      className={`toast-surface toast-enter pointer-events-auto w-full max-w-[420px] border ${accent} rounded-[22px]`}
    >
      <div className="flex items-start gap-3 p-4">
        <Icon size={16} className={`shrink-0 mt-0.5 ${accent.split(' ').pop()}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-white leading-snug">
            {toast.title}
            {/* Repeats collapse into a count rather than stacking identical
                cards down the screen. */}
            {toast.count > 1 ? (
              <span className="ml-1.5 font-mono text-[10px] tabular-nums text-white/45">
                &times;{toast.count}
              </span>
            ) : null}
          </p>
          {toast.description && (
            <p className="text-[11px] text-white/80 mt-1 leading-relaxed whitespace-pre-line">{toast.description}</p>
          )}
          {toast.actions && toast.actions.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              {toast.actions.map((a, i) => (
                <button
                  key={i}
                  onClick={a.onClick}
                  className={`text-[10px] font-medium uppercase tracking-wider px-3 py-1.5 rounded-md transition-colors ${
                    a.variant === 'danger'
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : a.variant === 'ghost'
                        ? 'text-white/80 hover:text-white hover:bg-white/[0.05]'
                        : 'bg-white text-black hover:bg-white'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-white/40 hover:text-white/80 transition-colors shrink-0"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
