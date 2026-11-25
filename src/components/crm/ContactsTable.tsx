'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Checkbox } from '@/components/ui/Checkbox';
import { ListContainer } from '@/components/ui/ListRow';
import type { BeatSend, Contact } from '@/lib/types';
import type { CrmStage } from '@/lib/contracts';
import type { ContactSortMode, SortDir } from '@/lib/contacts/filters';
import type { ContactKind } from '@/lib/contacts/kind';
import { summarizeSends, type SendPreset } from '@/lib/contacts/row-model';
import type { ActivityTone } from './contacts-shared';
import { CONTACT_COLS, ContactRow, type ContactPatch } from './ContactRow';

interface Props {
  contacts: Contact[];                         // paginated slice
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectPage: () => void;              // header checkbox — all rows on this page
  allPageSelected: boolean;

  sortMode: ContactSortMode;
  sortDir: SortDir;
  onSort: (col: ContactSortMode) => void;

  /** Every send, grouped by contact — the row words what was sent from these. */
  sendsByContact: Map<string, BeatSend[]>;
  leadScoreByContact?: Map<string, number>;
  leadTierByContact?: Map<string, string>;
  /** Score drivers per contact, strongest first — shown as the tier tooltip. */
  leadReasonsByContact?: Map<string, string[]>;
  kindByContact?: Map<string, ContactKind>;
  /** Contacts with a workspace or portal: their main role counts as artist. */
  workspaceIds?: ReadonlySet<string>;
  toneFor: (id: string) => ActivityTone;
  needsNudge: (id: string) => boolean;

  onOpenHistory: (c: Contact) => void;
  onSend: (c: Contact, preset: SendPreset) => void;
  onNudge: (c: Contact) => void;
  onStageChange: (id: string, next: CrmStage | null) => void;
  onPatch: (c: Contact, patch: ContactPatch, okText?: string) => Promise<boolean>;
  onDelete: (c: Contact) => void;

  dropHoverId: string | null;
  onRowDragOver: (id: string, e: React.DragEvent) => void;
  onRowDragLeave: (e: React.DragEvent) => void;
  onRowDrop: (c: Contact, e: React.DragEvent) => void;
}

const NO_SENDS: BeatSend[] = [];

function SortHead({ label, col, p, className }: { label: string; col: ContactSortMode; p: Props; className?: string }) {
  const active = p.sortMode === col;
  return (
    <button
      type="button"
      onClick={() => p.onSort(col)}
      aria-label={`Sort by ${label}`}
      className={`inline-flex items-center gap-1 text-left transition-colors hover:text-white ${active ? 'text-white' : 'text-white/40'} ${className ?? ''}`}
    >
      {label}
      {active && (p.sortDir === 'asc' ? <ArrowUp size={10} aria-hidden /> : <ArrowDown size={10} aria-hidden />)}
    </button>
  );
}

/**
 * The contact list: one `ContactRow` per person inside the same list container
 * the Projects and Playlists pages use. Same markup on a phone and a desktop —
 * the row drops its columns below md instead of switching to a second layout.
 */
export function ContactsTable(p: Props) {
  const [now] = useState(() => Date.now());

  return (
    <ListContainer
      className="bg-[#0D0D0A]"
      header={(
        <div className="flex w-full items-center gap-3 font-mono text-[10px] uppercase tracking-wider">
          <span className="w-4 shrink-0">
            <Checkbox
              checked={p.allPageSelected}
              indeterminate={!p.allPageSelected && p.contacts.some((c) => p.selectedIds.has(c.id))}
              onChange={p.onToggleSelectPage}
              aria-label="Select page"
            />
          </span>
          <span className="w-8 shrink-0" aria-hidden />
          <SortHead label="Contact" col="name" p={p} className="min-w-0 flex-1" />
          <span className="flex shrink-0 items-center gap-4">
            <span className={`${CONTACT_COLS.stage} hidden text-white/40 lg:block`}>Stage</span>
            <SortHead label="Sent" col="lastSent" p={p} className={CONTACT_COLS.sent} />
            <SortHead label="Lead" col="lead" p={p} className={`${CONTACT_COLS.lead} hidden lg:inline-flex`} />
            <span className={`${CONTACT_COLS.tags} hidden text-white/40 xl:block`}>Tags</span>
          </span>
          <span className={`${CONTACT_COLS.trailing} shrink-0`} aria-hidden />
        </div>
      )}
    >
      {p.contacts.map((c) => {
        const sends = p.sendsByContact.get(c.id) ?? NO_SENDS;
        const tier = p.leadTierByContact?.get(c.id);
        return (
          <ContactRow
            key={c.id}
            contact={c}
            selected={p.selectedIds.has(c.id)}
            onToggleSelect={p.onToggleSelect}
            summary={summarizeSends(sends, now)}
            tone={p.toneFor(c.id)}
            kind={p.kindByContact?.get(c.id)}
            lead={tier ? { tier, score: p.leadScoreByContact?.get(c.id) ?? 0, reasons: p.leadReasonsByContact?.get(c.id) } : undefined}
            inWorkspace={p.workspaceIds?.has(c.id) ?? false}
            needsNudge={p.needsNudge(c.id)}
            dropHover={p.dropHoverId === c.id}
            onDragOver={p.onRowDragOver}
            onDragLeave={p.onRowDragLeave}
            onDrop={p.onRowDrop}
            onSend={p.onSend}
            onNudge={p.onNudge}
            onOpenHistory={p.onOpenHistory}
            onStageChange={p.onStageChange}
            onPatch={p.onPatch}
            onDelete={p.onDelete}
          />
        );
      })}
    </ListContainer>
  );
}
