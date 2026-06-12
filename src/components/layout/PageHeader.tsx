'use client';

/**
 * PageHeader — the one consistent dashboard page header.
 *
 * Every dashboard surface (Library, Projects, Sales, Contacts…) used to
 * hand-roll its own header with different title sizes, container widths, and
 * action placement. This unifies them into one calm, premium pattern so the
 * producer side reads as a single product, and the PRIMARY action always
 * lives top-right where the eye expects it (fewer "where do I click?").
 *
 * Layout: eyebrow · title · description on the left; meta + actions on the
 * right (stacks on mobile). Pair with <PageContainer> for the matching width
 * and padding.
 */

import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Small mono label above the title, e.g. "Work in progress". */
  eyebrow?: string;
  title: string;
  /** One-line context under the title. */
  description?: string;
  /** Primary + secondary action buttons (top-right). */
  actions?: ReactNode;
  /** Quiet metric/count shown beside the actions, e.g. "12 projects". */
  meta?: ReactNode;
  /** Optional extra row under the header (filters, tabs). */
  children?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions, meta, children }: PageHeaderProps) {
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-[#D0C3AF] mb-2">{eyebrow}</p>
          )}
          <h1 className="text-[28px] sm:text-[34px] md:text-[40px] font-bold tracking-tight text-white leading-[1.05] font-heading">
            {title}
          </h1>
          {description && (
            <p className="text-[12px] text-[#D0C3AF] max-w-xl mt-2 leading-relaxed">{description}</p>
          )}
        </div>

        {(meta || actions) && (
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            {meta && (
              <span className="text-[11px] font-mono text-[#8a7a5c] uppercase tracking-wider whitespace-nowrap">{meta}</span>
            )}
            {actions}
          </div>
        )}
      </div>

      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}

/**
 * PageContainer — the consistent dashboard page width + horizontal padding.
 * One max-width (1400px) and one gutter scale so every surface aligns.
 */
export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`max-w-[1400px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-8 ${className}`}>
      {children}
    </div>
  );
}
