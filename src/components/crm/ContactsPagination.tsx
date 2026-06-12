'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { pageCount } from '@/lib/contacts/filters';

/**
 * Page-based pagination bar. Replaces the old infinite-scroll window.
 * Shows "Showing 26–50 of 487", « Prev [1][2]…[20] Next », and a page-size select.
 */
export function ContactsPagination({
  total, page, pageSize, onPage, onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  if (total === 0) return null;
  const pages = pageCount(total, pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Compact page-number window: 1 … (p-1) p (p+1) … last
  const nums: (number | '…')[] = [];
  const push = (n: number) => { if (!nums.includes(n)) nums.push(n); };
  push(1);
  if (page - 1 > 2) nums.push('…');
  for (let p = Math.max(2, page - 1); p <= Math.min(pages - 1, page + 1); p++) push(p);
  if (page + 1 < pages - 1) nums.push('…');
  if (pages > 1) push(pages);

  return (
    <div className="flex items-center justify-between gap-4 px-1 py-3 flex-wrap">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-mono text-[#9B9282] tabular-nums">
          Showing {from}–{to} of {total.toLocaleString()}
        </span>
        <Dropdown
          value={String(pageSize)}
          onChange={(v) => onPageSize(Number(v))}
          options={[{ value: '25', label: '25 / page' }, { value: '50', label: '50 / page' }, { value: '100', label: '100 / page' }]}
          menuWidth={110}
          align="left"
          className="!h-7 !py-0.5 !px-2 !text-[11px]"
          aria-label="Rows per page"
        />
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="h-8 px-2 rounded-md flex items-center gap-1 text-[11px] text-[#D0C3AF] hover:text-[#F7EBDD] hover:bg-[#211F1A] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`gap-${i}`} className="px-1.5 text-[11px] text-[#6E685B]">…</span>
          ) : (
            <button
              key={n}
              onClick={() => onPage(n)}
              className={`h-8 min-w-8 px-2 rounded-md text-[11px] font-medium tabular-nums transition-colors ${
                n === page ? 'bg-[var(--accent)] text-black' : 'text-[#D0C3AF] hover:text-[#F7EBDD] hover:bg-[#211F1A]'
              }`}
            >
              {n}
            </button>
          ),
        )}
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="h-8 px-2 rounded-md flex items-center gap-1 text-[11px] text-[#D0C3AF] hover:text-[#F7EBDD] hover:bg-[#211F1A] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
