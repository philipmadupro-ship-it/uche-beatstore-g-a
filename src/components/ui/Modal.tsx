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

interface ModalProps {
  open?: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  placement?: 'center' | 'top';
  closeLabel?: string;
  closeOnOutsideClick?: boolean;
  className?: string;
  contentClassName?: string;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open = true,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = 'md',
  placement = 'center',
  closeLabel = 'Close dialog',
  closeOnOutsideClick = true,
  className,
  contentClassName,
}: ModalProps) {
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

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex justify-center p-4',
        placement === 'top' ? 'items-start pt-6 sm:pt-8' : 'items-center',
      )}
      style={{ zIndex: 'var(--z-modal)' }}
      role="presentation"
    >
      <button
        type="button"
        aria-label={closeLabel}
        className="ui-scrim absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => closeOnOutsideClick && onClose()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'ui-modal-panel relative flex max-h-[min(90dvh,760px)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_30px_90px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.04)]',
          sizeClasses[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--bg-page)] px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--accent)]">
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={closeLabel}
            onClick={onClose}
            className="size-9 min-h-9"
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
        <div className={cn('flex-1 overflow-y-auto p-5 sm:p-6', contentClassName)}>{children}</div>
        {footer && <div className="border-t border-[var(--border)] bg-[var(--bg-page)] px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
