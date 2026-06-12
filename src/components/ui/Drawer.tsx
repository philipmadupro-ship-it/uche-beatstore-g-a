'use client';

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface DrawerProps {
  open?: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left' | 'bottom';
  size?: 'sm' | 'md' | 'lg';
  closeLabel?: string;
  closeOnOutsideClick?: boolean;
  showHeader?: boolean;
  className?: string;
  contentClassName?: string;
}

const widthClasses = {
  sm: 'sm:w-[380px]',
  md: 'sm:w-[440px]',
  lg: 'sm:w-[560px]',
};

export function Drawer({
  open = true,
  onClose,
  title,
  description,
  icon,
  headerAction,
  children,
  footer,
  side = 'right',
  size = 'md',
  closeLabel = 'Close drawer',
  closeOnOutsideClick = true,
  showHeader = true,
  className,
  contentClassName,
}: DrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      const first = panel?.querySelector<HTMLElement>(focusableSelector);
      (first ?? panel)?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  const sideClasses =
    side === 'bottom'
      ? 'ui-drawer-bottom inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl border-t'
      : side === 'left'
        ? cn('ui-drawer-left left-0 top-0 h-dvh w-full border-r', widthClasses[size])
        : cn('ui-drawer-right right-0 top-0 h-dvh w-full border-l', widthClasses[size]);

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: 'var(--z-drawer)' }} role="presentation">
      <button
        type="button"
        aria-label={closeLabel}
        className="ui-scrim absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => closeOnOutsideClick && onClose()}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'fixed flex flex-col overflow-hidden border-[var(--border)] bg-[var(--bg-page)] shadow-[0_0_80px_rgba(0,0,0,0.55)]',
          sideClasses,
          className,
        )}
      >
        {showHeader ? (
          <div className="border-b border-[var(--border)] bg-gradient-to-b from-[var(--bg-card)] to-[var(--bg-page)] px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                {icon && (
                  <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--accent)]">
                    {icon}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 id={titleId} className="font-mono text-xs font-black uppercase tracking-[0.2em] text-[var(--text-primary)]">
                    {title}
                  </h2>
                  {description && (
                    <p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--text-readable)]">
                      {description}
                    </p>
                  )}
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={closeLabel} onClick={onClose} className="size-9 min-h-9">
                <X size={16} aria-hidden="true" />
              </Button>
            </div>
            {headerAction && (
              <div className="mt-4 flex justify-end">
                {headerAction}
              </div>
            )}
          </div>
        ) : (
          <>
            <h2 id={titleId} className="sr-only">{title}</h2>
            {description && <p id={descriptionId} className="sr-only">{description}</p>}
          </>
        )}
        <div className={cn('flex-1 overflow-y-auto p-5', contentClassName)}>{children}</div>
        {footer && <div className="border-t border-[var(--border)] px-5 py-4">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}
