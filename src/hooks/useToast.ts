'use client';

import { create } from 'zustand';
import {
  enqueueToast, dismissToast, defaultDuration, type ToastKind,
} from '@/lib/ui/toast-queue';

export type { ToastKind };

export interface ToastAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
}

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  duration: number; // ms; 0 = sticky until manually dismissed
  actions?: ToastAction[];
  /** Repeats collapsed into this card. Rendered as "x3". */
  count: number;
}

interface ToastStore {
  toasts: Toast[];
  // `count` is derived by the queue, never supplied by a caller.
  push: (t: Omit<Toast, 'id' | 'duration' | 'count'> & { duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
  /** Suspend auto-dismiss while the card is hovered or focused. */
  hold: (id: string) => void;
  /** Resume auto-dismiss, restarting the full duration. */
  release: (id: string) => void;
}

/** Pending auto-dismiss timers, so they can be cancelled on manual dismiss. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2, 10);
    const duration = t.duration ?? defaultDuration(t.kind);

    // Queue policy — capping and deduplication — lives in lib/ui/toast-queue
    // so it can be unit-tested. With 333 call sites, "append unconditionally"
    // meant a batch of failures could bury the screen and a retry loop could
    // render the same sentence five times.
    const result = enqueueToast(
      get().toasts as never,
      { id, duration, kind: t.kind, title: t.title, description: t.description } as never,
    );
    set({
      toasts: (result.queue as unknown as Toast[]).map((queued) => (
        // Actions do not survive the pure layer (they are functions), so
        // reattach them from the incoming toast for the card it belongs to.
        queued.id === result.id && t.actions ? { ...queued, actions: t.actions } : queued
      )),
    });

    // A duplicate must not schedule a SECOND timer against the same id: the
    // first would fire mid-life and dismiss a card the user is still reading.
    if (duration > 0 && !result.deduped) {
      const timer = setTimeout(() => {
        timers.delete(id);
        set((s) => ({ toasts: dismissToast(s.toasts as never, id) as unknown as Toast[] }));
      }, duration);
      timers.set(id, timer);
    }

    return result.id;
  },
  dismiss: (id) => {
    // Clear the pending timer too. Without this a manually dismissed toast
    // leaves a timer that fires into an empty queue — harmless, but it also
    // means the id could collide with a later toast reusing it.
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((s) => ({ toasts: dismissToast(s.toasts as never, id) as unknown as Toast[] }));
  },
  clear: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ toasts: [] });
  },

  hold: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
  },

  release: (id) => {
    const t = get().toasts.find((x) => x.id === id);
    // Sticky toasts (duration 0) and toasts already dismissed stay as they are.
    if (!t || t.duration <= 0 || timers.has(id)) return;
    // Restart the FULL duration rather than resuming a remainder: the pointer
    // left because reading finished, so the useful clock starts now.
    const timer = setTimeout(() => {
      timers.delete(id);
      set((s) => ({ toasts: dismissToast(s.toasts as never, id) as unknown as Toast[] }));
    }, t.duration);
    timers.set(id, timer);
  },
}));

/**
 * Imperative helpers — usable anywhere (event handlers, async functions,
 * outside React). Don't subscribe components that don't need to re-render.
 */
export const toast = {
  info:    (title: string, description?: string) => useToastStore.getState().push({ kind: 'info',    title, description }),
  success: (title: string, description?: string) => useToastStore.getState().push({ kind: 'success', title, description }),
  error:   (title: string, description?: string) => useToastStore.getState().push({ kind: 'error',   title, description }),
  warning: (title: string, description?: string) => useToastStore.getState().push({ kind: 'warning', title, description }),
  custom:  (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => useToastStore.getState().push(t),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};

/**
 * Promise-based confirm — drop-in replacement for native `confirm()`.
 * Renders a sticky toast with Confirm + Cancel buttons.
 */
export function confirmToast(
  title: string,
  description?: string,
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean; timeoutMs?: number },
): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmLabel = opts?.confirmLabel ?? 'Confirm';
    const cancelLabel = opts?.cancelLabel ?? 'Cancel';
    const timeoutMs = opts?.timeoutMs ?? 0; // sticky by default
    let settled = false;
    let id = '';
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      useToastStore.getState().dismiss(id);
      resolve(ok);
    };
    id = useToastStore.getState().push({
      kind: 'warning',
      title,
      description,
      duration: timeoutMs,
      actions: [
        { label: cancelLabel, onClick: () => finish(false), variant: 'ghost' },
        { label: confirmLabel, onClick: () => finish(true), variant: opts?.danger ? 'danger' : 'primary' },
      ],
    });
  });
}
