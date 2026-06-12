'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { CRM_STAGES, type CrmStage } from '@/lib/contracts';
import { toast } from '@/hooks/useToast';

// ── CRM lifecycle stage metadata ──────────────────────────────────────────
export const STAGE_META: Record<CrmStage, { label: string; dot: string; text: string }> = {
  prospect:  { label: 'Prospect',  dot: 'bg-[#7aa8e8]', text: 'text-[#7aa8e8]' },
  active:    { label: 'Active',    dot: 'bg-[#6DC6A4]', text: 'text-[#6DC6A4]' },
  engaged:   { label: 'Engaged',   dot: 'bg-[#E7D7BE]', text: 'text-[#E7D7BE]' },
  cold:      { label: 'Cold',      dot: 'bg-[#B4AA99]', text: 'text-[#B4AA99]' },
  archived:  { label: 'Archived',  dot: 'bg-[#6E685B]', text: 'text-[#6E685B]' },
};

// ── Derived activity tone (read-only) ─────────────────────────────────────
export type ActivityTone = 'active' | 'engaged' | 'cold';
const ACTIVITY_META: Record<ActivityTone, { label: string; dot: string; text: string }> = {
  active:  { label: 'Active',  dot: 'bg-[#6DC6A4]', text: 'text-[#6DC6A4]' },
  engaged: { label: 'Engaged', dot: 'bg-[#E7D7BE]', text: 'text-[#D0C3AF]' },
  cold:    { label: 'Cold',    dot: 'bg-[#837B6D]', text: 'text-[#9B9282]' },
};

/** Compact dot + label, no big bubble. Read-only by default; clickable to filter. */
export function ActivityDot({ tone, onClick, active }: { tone: ActivityTone; onClick?: (t: ActivityTone) => void; active?: boolean }) {
  const m = ACTIVITY_META[tone];
  const inner = (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${tone === 'active' ? 'animate-pulse' : ''}`} />
      <span className={`text-[11px] font-medium ${m.text}`}>{m.label}</span>
    </span>
  );
  if (!onClick) return inner;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(tone); }}
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md transition-colors ${active ? 'bg-[var(--accent-tint)] ring-1 ring-[var(--accent-dim)]/40' : 'hover:bg-[#211F1A]'}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${tone === 'active' ? 'animate-pulse' : ''}`} />
      <span className={`text-[11px] font-medium ${m.text}`}>{m.label}</span>
    </button>
  );
}

/**
 * Inline-editable CRM stage cell. Shows the stored crm_status, or the derived
 * activity tone as a faded "(auto)" hint when no stage is set. Selecting a stage
 * PATCHes /api/contacts/[id] optimistically.
 */
export function ContactStageCell({
  contactId, value, derivedTone, onChanged,
}: {
  contactId: string;
  value: CrmStage | null | undefined;
  derivedTone: ActivityTone;
  onChanged: (next: CrmStage | null) => void;
}) {
  const [saving, setSaving] = useState(false);

  const setStage = async (next: CrmStage | null) => {
    const prev = value ?? null;
    if (next === prev) return;
    onChanged(next);            // optimistic
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crm_status: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      onChanged(prev);          // rollback
      toast.error("Couldn't update stage", err instanceof Error ? err.message : '');
    } finally { setSaving(false); }
  };

  const options = [
    { value: '', label: `Auto · ${ACTIVITY_META[derivedTone].label}` },
    ...CRM_STAGES.map((s) => ({ value: s, label: STAGE_META[s].label })),
  ];
  const m = value ? STAGE_META[value] : null;

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m ? m.dot : ACTIVITY_META[derivedTone].dot} ${!m ? 'opacity-50' : ''}`} />
      <Dropdown
        value={value ?? ''}
        onChange={(v) => setStage(v === '' ? null : (v as CrmStage))}
        options={options}
        placeholder={`Auto · ${ACTIVITY_META[derivedTone].label}`}
        menuWidth={150}
        className={`!h-7 !py-0.5 !px-2 !text-[11px] !rounded-md border-transparent hover:border-[var(--border-hover)] ${m ? m.text : 'text-[#9B9282]'} ${!value ? 'italic' : 'font-medium'}`}
        aria-label="CRM stage"
      />
      {saving && <Loader2 size={10} className="animate-spin text-[#9B9282] shrink-0" />}
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────
const AVATAR_PALETTES = [
  { bg: 'bg-[#342F27]', text: 'text-[#F3E6D1]', border: 'border-[#C9BCA8]/40' },
  { bg: 'bg-[#1a1833]', text: 'text-[#AFA9EC]', border: 'border-[#534AB7]/40' },
  { bg: 'bg-[#0d2318]', text: 'text-[#6DC6A4]', border: 'border-[#6DC6A4]/30' },
  { bg: 'bg-[#2a1810]', text: 'text-[#e8a86a]', border: 'border-[#e8a86a]/30' },
  { bg: 'bg-[#1a0d2e]', text: 'text-[#c89de8]', border: 'border-[#c89de8]/30' },
  { bg: 'bg-[#102018]', text: 'text-[#8fd6c0]', border: 'border-[#8fd6c0]/30' },
];
export function nameToAvatar(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(h) % AVATAR_PALETTES.length];
}
export function ContactAvatar({ name }: { name: string }) {
  const av = nameToAvatar(name);
  return (
    <div className={`w-8 h-8 rounded-full ${av.bg} border ${av.border} flex items-center justify-center text-[11px] font-bold ${av.text} shrink-0`}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

// ── Relative time ─────────────────────────────────────────────────────────
export function relativeDays(iso: string | undefined): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ── Pipeline pill (send-status progress) ──────────────────────────────────
const PIPELINE_STAGES = ['sent', 'opened', 'interested', 'negotiating', 'placed'] as const;
const STAGE_FILL: Record<string, string> = {
  sent: 'bg-[#B4AA99]', opened: 'bg-[#7aa8e8]', interested: 'bg-[#F3E6D1]',
  negotiating: 'bg-[#e8a86a]', placed: 'bg-[#6DC6A4]',
};
export function PipelinePill({ status }: { status: string | null }) {
  if (!status) return <span className="text-[11px] text-[#6E685B]">—</span>;
  if (status === 'pass') {
    return <span className="text-[10px] font-medium text-red-400/80 bg-red-500/10 px-1.5 py-0.5 rounded">Pass</span>;
  }
  const idx = PIPELINE_STAGES.indexOf(status as any);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {PIPELINE_STAGES.map((s, i) => (
          <span key={s} className={`w-1.5 h-1.5 rounded-full ${i <= idx ? STAGE_FILL[s] : 'bg-[#2B2821]'}`} />
        ))}
      </div>
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282] capitalize">{status}</span>
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────
export function ContactsTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[var(--border)]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 h-14">
          <div className="w-4 h-4 rounded skeleton-shimmer" />
          <div className="w-8 h-8 rounded-full skeleton-shimmer" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-40 rounded skeleton-shimmer" />
            <div className="h-2 w-24 rounded skeleton-shimmer" />
          </div>
          <div className="h-3 w-20 rounded skeleton-shimmer hidden sm:block" />
          <div className="h-3 w-16 rounded skeleton-shimmer hidden md:block" />
          <div className="h-3 w-12 rounded skeleton-shimmer" />
        </div>
      ))}
    </div>
  );
}
