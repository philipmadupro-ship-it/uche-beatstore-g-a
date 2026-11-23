'use client';

import { useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { Drawer } from '@/components/ui/Drawer';
import { cn } from '@/lib/utils';
import {
  LINK_KIND_FACETS,
  LINK_OPTION_FACETS,
  LINK_RECIPIENT_FACETS,
  LINK_SORTS,
  LINK_STATUS_FACETS,
  hasActiveLinkFacets,
  type LinkFacets,
  type LinkSort,
} from '@/lib/links/share-link';

const STATUS_LABEL: Record<(typeof LINK_STATUS_FACETS)[number], string> = {
  active: 'Active', expired: 'Expired', revoked: 'Revoked', unopened: 'Never opened',
};
const KIND_LABEL: Record<(typeof LINK_KIND_FACETS)[number], string> = {
  track: 'Track', project: 'Project', playlist: 'Playlist',
};
const RECIPIENT_LABEL: Record<(typeof LINK_RECIPIENT_FACETS)[number], string> = {
  client: 'Client', producer: 'Producer', rapper: 'Rapper', friend: 'Friend',
};
const OPTION_LABEL: Record<(typeof LINK_OPTION_FACETS)[number], string> = {
  password: 'Password', downloads_on: 'Downloads on', downloads_off: 'Downloads off',
};
const SORT_LABEL: Record<LinkSort, string> = {
  newest: 'Newest', oldest: 'Oldest', opens: 'Most opened', expiring: 'Expiring soon', title: 'Title A–Z',
};

function toggled<T extends string>(set: ReadonlySet<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

interface Props {
  facets: LinkFacets;
  onFacets: (next: LinkFacets) => void;
  sort: LinkSort;
  onSort: (next: LinkSort) => void;
  search: string;
  onSearch: (next: string) => void;
  /** Rows currently shown / all rows. */
  shown: number;
  total: number;
  /** Show the Recipient group only when some row carries `recipient_kind`. */
  hasRecipients: boolean;
  /** Phones open the facets in the bottom Drawer, like the Library. */
  mobile: boolean;
}

export function LinkFilterBar({
  facets, onFacets, sort, onSort, search, onSearch, shown, total, hasRecipients, mobile,
}: Props) {
  const [open, setOpen] = useState(false);
  const facetCount = facets.status.size + facets.kind.size + facets.recipient.size + facets.options.size;
  const active = hasActiveLinkFacets(facets) || search.trim() !== '';
  const clearAll = () => {
    onSearch('');
    onFacets({ status: new Set(), kind: new Set(), recipient: new Set(), options: new Set() });
  };

  const panel = (
    <div className="space-y-3">
      <Group label="Status" values={LINK_STATUS_FACETS} labels={STATUS_LABEL} selected={facets.status}
        onToggle={(v) => onFacets({ ...facets, status: toggled(facets.status, v) })} />
      <Group label="Kind" values={LINK_KIND_FACETS} labels={KIND_LABEL} selected={facets.kind}
        onToggle={(v) => onFacets({ ...facets, kind: toggled(facets.kind, v) })} />
      {hasRecipients && (
        <Group label="Recipient" values={LINK_RECIPIENT_FACETS} labels={RECIPIENT_LABEL} selected={facets.recipient}
          onToggle={(v) => onFacets({ ...facets, recipient: toggled(facets.recipient, v) })} />
      )}
      <Group label="Options" values={LINK_OPTION_FACETS} labels={OPTION_LABEL} selected={facets.options}
        onToggle={(v) => onFacets({ ...facets, options: toggled(facets.options, v) })} />
    </div>
  );

  return (
    <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.02] p-2.5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search title, token, kind…"
            aria-label="Search links"
            className="w-full rounded-full border border-white/10 bg-[#090907] py-2 pl-8 pr-3 text-[11px] text-white transition-colors placeholder:text-white/30 focus:border-white/50 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors',
              open || facetCount > 0
                ? 'border-white/20 bg-white/[0.10] text-white'
                : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]',
            )}
          >
            <SlidersHorizontal size={11} aria-hidden="true" />
            Filters{facetCount > 0 ? ` · ${facetCount}` : ''}
          </button>
          <Dropdown
            aria-label="Sort links"
            label="Sort:"
            value={sort}
            onChange={(v) => onSort(v as LinkSort)}
            options={LINK_SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))}
            align="right"
            className="rounded-full border border-white/10 bg-[#090907] px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-white/80"
          />
        </div>
      </div>

      {open && !mobile && <div className="mt-3 border-t border-white/10 px-1 pt-3">{panel}</div>}
      <Drawer
        open={open && mobile}
        onClose={() => setOpen(false)}
        side="bottom"
        title="Link filters"
        description={`${shown} of ${total} link${total === 1 ? '' : 's'} shown`}
        contentClassName="pb-8"
        footer={
          <button
            type="button"
            onClick={clearAll}
            disabled={!active}
            className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/60 hover:text-white disabled:opacity-40"
          >
            Clear all
          </button>
        }
      >
        {panel}
      </Drawer>

      <div className="mt-2 flex items-center justify-between px-1">
        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/30" data-testid="link-count">
          {active ? `${shown} of ${total}` : `${total} link${total === 1 ? '' : 's'}`}
        </p>
        {active && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/60 transition-colors hover:text-white"
          >
            <X size={10} aria-hidden="true" />
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

function Group<T extends string>({
  label, values, labels, selected, onToggle,
}: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  selected: ReadonlySet<T>;
  onToggle: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => {
          const on = selected.has(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(v)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors',
                on
                  ? 'border-white/30 bg-white/[0.14] text-white'
                  : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]',
              )}
            >
              {labels[v]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
