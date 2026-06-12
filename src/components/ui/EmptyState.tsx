import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from './Card';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Card className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mb-4 grid size-11 place-items-center rounded-full border border-[var(--border)] bg-[var(--bg-page)] text-[var(--accent)]">
          {icon}
        </div>
      )}
      <h3 className="font-heading text-xl text-[var(--text-primary)]">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-readable)]">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}
