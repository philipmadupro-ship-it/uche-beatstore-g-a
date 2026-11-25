'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { Checkbox } from '@/components/ui/Checkbox';
import { ListRow } from '@/components/ui/ListRow';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';
import { InlineText } from '@/components/ui/InlineText';
import { CRM_STAGES, type CrmStage } from '@/lib/contracts';
import type { Contact } from '@/lib/types';
import type { ContactKind } from '@/lib/contacts/kind';
import { CONTACT_CATEGORIES } from '@/lib/contacts/roles';
import {
  kindHint, nextSendPreset, roleChoices, roleLine, rolePatch, sendPresetsFor, sentCountText, tabLabelFor,
  type SendPreset, type SentSummary,
} from '@/lib/contacts/row-model';
import { ContactAvatar, ContactStageCell, STAGE_META, relativeDays, type ActivityTone } from './contacts-shared';

export type ContactPatch = Partial<Pick<Contact, 'name' | 'category' | 'secondary_category' | 'crm_status'>>;

/** Column widths shared by the row and the list header, so the two always line up. */
export const CONTACT_COLS = {
  stage: 'w-[150px]',
  sent: 'w-[224px]',
  lead: 'w-[84px]',
  tags: 'w-[132px]',
  /** Send button + gap + ⋯ menu: icon-only below lg (36 + 8 + 32), labelled from lg (156 + 8 + 32). */
  trailing: 'w-[76px] lg:w-[196px]',
} as const;

const LEAD_TINTS: Record<string, string> = { hot: '#E8896A', warm: 'rgba(255,255,255,0.9)', cold: '#7d92b0' };
const LEAD_LABELS: Record<string, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };

export interface ContactRowProps {
  contact: Contact;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  summary: SentSummary;
  tone: ActivityTone;
  kind?: ContactKind;
  lead?: { tier?: string; score: number; reasons?: string[] };
  inWorkspace: boolean;
  needsNudge: boolean;
  dropHover: boolean;
  onDragOver: (id: string, e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (c: Contact, e: React.DragEvent) => void;
  onSend: (c: Contact, preset: SendPreset) => void;
  onNudge: (c: Contact) => void;
  onOpenHistory: (c: Contact) => void;
  onStageChange: (id: string, next: CrmStage | null) => void;
  onPatch: (c: Contact, patch: ContactPatch, okText?: string) => Promise<boolean>;
  onDelete: (c: Contact) => void;
}

/**
 * One contact, drawn like a track: the whole row opens the contact (ListRow's
 * stretched activator), the name renames in place from the ⋯ menu, and what
 * was sent reads as words. Nothing interactive is nested inside the activator.
 */
export function ContactRow(p: ContactRowProps) {
  const { contact: c, summary } = p;
  const [renaming, setRenaming] = useState(false);
  const presets = sendPresetsFor(c, p.inWorkspace);
  const primary = nextSendPreset(c, p.inWorkspace);
  const role = roleLine(c);
  const hint = kindHint(p.kind);
  const tags = c.tags ?? [];
  const showLead = p.lead?.tier && p.lead.tier !== 'new' && LEAD_LABELS[p.lead.tier];

  const sections: MenuSection[] = [
    {
      id: 'send',
      items: [
        ...presets.map((preset) => ({
          id: `send-${preset.id}`, label: preset.label, hidden: !c.email, onSelect: () => p.onSend(c, preset),
        })),
        { id: 'nudge', label: 'Nudge', hint: 'Follow up on the last send', hidden: !p.needsNudge || !c.email, onSelect: () => p.onNudge(c) },
        { id: 'history', label: 'Send history', onSelect: () => p.onOpenHistory(c) },
      ],
    },
    { id: 'edit', items: [{ id: 'rename', label: 'Rename', onSelect: () => setRenaming(true) }] },
    {
      id: 'role',
      label: 'Role',
      items: roleChoices(CONTACT_CATEGORIES).map((r) => ({
        id: `role-${r.value}`,
        label: r.label,
        checked: (c.category ?? '').toLowerCase() === r.value,
        onSelect: async () => {
          const patch = rolePatch(c, r.value);
          if (patch) await p.onPatch(c, patch, `${c.name} is now ${r.label} · shows under ${tabLabelFor(r.value)}`);
        },
      })),
    },
    {
      id: 'stage',
      label: 'Stage',
      items: [
        { id: 'stage-auto', label: 'Auto', checked: !c.crm_status, onSelect: () => { void p.onPatch(c, { crm_status: null }); } },
        ...CRM_STAGES.map((s) => ({
          id: `stage-${s}`, label: STAGE_META[s].label, checked: c.crm_status === s, onSelect: () => { void p.onPatch(c, { crm_status: s }); },
        })),
      ],
    },
    { id: 'danger', danger: true, items: [{ id: 'delete', label: 'Delete contact', onSelect: () => p.onDelete(c) }] },
  ];

  const lastText = summary.lastAt ? relativeDays(summary.lastAt) : null;
  const outcomeLine = summary.count > 0 ? [summary.outcomeLabel, lastText].filter(Boolean).join(' · ') : null;

  return (
    <div
      onDragOver={(e) => p.onDragOver(c.id, e)}
      onDragLeave={p.onDragLeave}
      onDrop={(e) => p.onDrop(c, e)}
      data-testid="contact-row"
      className={p.dropHover ? 'ring-2 ring-inset ring-white/40 bg-white/[0.06]' : p.selected ? 'bg-white/[0.06]' : undefined}
    >
      <ListRow
        href={`/contacts/${c.id}`}
        label={`Open ${c.name}`}
        titleInteractive={renaming}
        leading={<Checkbox checked={p.selected} onChange={() => p.onToggleSelect(c.id)} aria-label={`Select ${c.name}`} />}
        media={<ContactAvatar name={c.name} />}
        title={renaming ? (
          <InlineText
            value={c.name}
            label={`name of ${c.name}`}
            editing
            onEditingChange={setRenaming}
            hideAffordance
            inputClassName="text-[13px] font-semibold"
            onSave={(next) => p.onPatch(c, { name: next }, 'Renamed')}
          />
        ) : (
          <span className="text-[13px] font-semibold text-white/90">{c.name}</span>
        )}
        meta={(
          <span className="text-[11px] text-white/60">
            {role ?? 'No role set'}
            <span className="hidden sm:inline">{c.email ? ` · ${c.email}` : ''}</span>
            {hint && <span className="hidden text-white/40 md:inline"> · {hint}</span>}
            {/* Phone: the columns are hidden, so what was sent rides on this line. */}
            <span className="md:hidden text-white/40">{outcomeLine ? ` · ${outcomeLine}` : ''}</span>
          </span>
        )}
        columns={(
          <>
            <div className={`${CONTACT_COLS.stage} pointer-events-auto hidden lg:block`}>
              <ContactStageCell
                contactId={c.id}
                name={c.name}
                value={c.crm_status}
                derivedTone={p.tone}
                onChanged={(next) => p.onStageChange(c.id, next)}
              />
            </div>
            <div className={`${CONTACT_COLS.sent} min-w-0`}>
              <p className="truncate text-[11px] text-white/80">{sentCountText(summary)}</p>
              {outcomeLine && (
                <p className={`truncate text-[11px] ${summary.stale ? 'text-[#e8a86a]' : 'text-white/40'}`}>{outcomeLine}</p>
              )}
            </div>
            <div className={`${CONTACT_COLS.lead} hidden lg:block`}>
              {showLead ? (
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] tabular-nums"
                  style={{ color: LEAD_TINTS[p.lead!.tier!] }}
                  title={`${LEAD_LABELS[p.lead!.tier!]} lead · score ${p.lead!.score}${p.lead!.reasons?.length ? ` · ${p.lead!.reasons.join(' · ')}` : ''}`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LEAD_TINTS[p.lead!.tier!] }} />
                  {LEAD_LABELS[p.lead!.tier!]} · {p.lead!.score}
                </span>
              ) : <span className="text-white/20">—</span>}
            </div>
            <div className={`${CONTACT_COLS.tags} hidden min-w-0 items-center gap-1 xl:flex`}>
              {tags.slice(0, 2).map((t) => (
                <span key={t.tag} className="truncate rounded-lg border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/60">{t.tag}</span>
              ))}
              {tags.length > 2 && <span className="font-mono text-[10px] text-white/40">+{tags.length - 2}</span>}
              {tags.length === 0 && <span className="text-white/20">—</span>}
            </div>
          </>
        )}
        trailing={(
          <>
            <button
              type="button"
              onClick={() => p.onSend(c, primary)}
              disabled={!c.email}
              aria-label={`${primary.label} to ${c.name}`}
              title={c.email ? primary.label : 'Add an email address to send'}
              className="inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] text-[11px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white disabled:opacity-40 lg:w-[156px]"
            >
              <Send size={13} aria-hidden />
              <span className="hidden whitespace-nowrap lg:inline">{primary.label}</span>
            </button>
            <ActionMenu label={`More actions for ${c.name}`} sections={sections} />
          </>
        )}
      />
    </div>
  );
}
