'use client';

/**
 * /contacts/[id] — full contact detail page.
 *
 * Same shape as the other detail pages (library, project, playlist):
 * side-by-side layout, big "cover" tile on the left, stacked content
 * on the right. The "cover" here is the avatar disc plus key fields;
 * the right column carries inline-editable info + the full send
 * history timeline.
 *
 * Quick peek via the existing `ContactHistoryDrawer` from `/contacts`
 * stays available — this is the deep view when the user wants
 * everything in one place.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, Mail, Phone, Globe, Tag, MapPin,
  Edit2, Check, X, Send, Trash2, FileText, BellRing,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageContainer } from '@/components/layout/PageHeader';
import { SendBeatModal } from '@/components/crm/SendBeatModal';
import { ContactTagPicker } from '@/components/crm/ContactTagPicker';
import { ContactStageCell, relativeDays } from '@/components/crm/contacts-shared';
import { NudgeModal } from '@/components/crm/NudgeModal';
import { ContactActivityTimeline } from '@/components/crm/ContactActivityTimeline';
import { ContactTasks } from '@/components/crm/ContactTasks';
import type { CrmStage } from '@/lib/contracts';
import { toast, confirmToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { Contact, BeatSend } from '@/lib/types';

const PIPELINE_TONES: Record<string, { dot: string; text: string; ring: string; label: string }> = {
  sent:        { dot: 'bg-[#B4AA99]', text: 'text-[#D0C3AF]', ring: 'ring-[#3B372F]',    label: 'Sent' },
  opened:      { dot: 'bg-[#7aa8e8]', text: 'text-[#7aa8e8]', ring: 'ring-[#3a4a6a]',    label: 'Opened' },
  interested:  { dot: 'bg-[#F3E6D1]', text: 'text-[#F3E6D1]', ring: 'ring-[#C9BCA8]/40', label: 'Interested' },
  negotiating: { dot: 'bg-[#e8a86a]', text: 'text-[#e8a86a]', ring: 'ring-[#C9BCA8]/40', label: 'Negotiating' },
  placed:      { dot: 'bg-[#6DC6A4]', text: 'text-[#6DC6A4]', ring: 'ring-[#1f5a4a]',    label: 'Placed' },
  pass:        { dot: 'bg-[#e88a8a]', text: 'text-[#e88a8a]', ring: 'ring-[#6a2a2a]',    label: 'Pass' },
};

export default function ContactDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = React.use(paramsPromise);
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [sends, setSends] = useState<BeatSend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [nudgeModalOpen, setNudgeModalOpen] = useState(false);

  // ── Fetch ───────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(`/api/contacts/${params.id}`),
        fetch('/api/beat_sends'),
      ]);
      const cData = await cRes.json();
      if (!cRes.ok) throw new Error(cData?.error || `HTTP ${cRes.status}`);
      const contactRow: Contact = cData?.contact ?? cData;
      setContact(contactRow);
      // Beat sends are loaded in bulk and filtered client-side — the
      // user is unlikely to have so many sends to one contact that
      // pagination matters. Same pattern the history drawer uses.
      const sData = await sRes.json();
      const allSends: BeatSend[] = Array.isArray(sData) ? sData : sData.sends ?? [];
      setSends(allSends.filter((s) => s.contact_id === params.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contact');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); }, [params.id]);

  // ── Engagement + pipeline derived state ─────────────────────────────
  const engagementTone = useMemo<'active' | 'engaged' | 'cold'>(() => {
    if (sends.length === 0) return 'cold';
    const latest = sends.reduce((m, s) => (s.sent_at > m ? s.sent_at : m), '');
    const days = (Date.now() - Date.parse(latest)) / 86_400_000;
    return days <= 30 ? 'active' : 'engaged';
  }, [sends]);

  const latestStatus = useMemo(() => {
    if (sends.length === 0) return null;
    const latest = [...sends].sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
    return latest.status;
  }, [sends]);

  const latestSend = useMemo(() => {
    if (sends.length === 0) return null;
    return [...sends].sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
  }, [sends]);

  const needsNudge = useMemo(() => {
    if (!latestSend || latestSend.status !== 'sent') return false;
    return (Date.now() - Date.parse(latestSend.sent_at)) / 86_400_000 > 5;
  }, [latestSend]);

  const quickStats = useMemo(() => {
    const total = sends.length;
    const opened = sends.filter((s) => s.opened_at).length;
    const openRate = total > 0 ? Math.round((opened / total) * 100) : null;
    const lastSentAt = latestSend?.sent_at;
    return { total, opened, openRate, lastSentAt };
  }, [sends, latestSend]);

  // ── Inline edit ─────────────────────────────────────────────────────
  // Single function handles every editable field — name, role, phone,
  // email, etc. Optimistic update on save; rolls back on error.
  const patchField = async (field: keyof Contact, value: string | null) => {
    if (!contact) return;
    const prev = contact[field];
    setContact({ ...contact, [field]: value } as Contact);
    try {
      const res = await fetch(`/api/contacts/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      // Roll back optimistic update
      setContact((c) => (c ? { ...c, [field]: prev } as Contact : c));
      toast.error('Save failed', err instanceof Error ? err.message : 'Try again');
    }
  };

  const deleteContact = async () => {
    if (!contact) return;
    const ok = await confirmToast(
      `Delete ${contact.name}?`,
      'This permanently removes the contact and all their send history.',
      { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/contacts/${params.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Contact deleted');
      router.push('/contacts');
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : 'Try again');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  if (loading && !contact) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full pt-32">
          <Loader2 size={18} className="animate-spin text-[#6E685B]" />
        </div>
      </DashboardLayout>
    );
  }

  if (!contact) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center pt-32 gap-3">
          <p className="text-[#B4AA99] text-sm">{error ? "Couldn't load contact" : 'Contact not found'}</p>
          {error && <p className="text-[10px] text-[#6E685B] font-mono">{error}</p>}
          <Link href="/contacts" className="text-[11px] text-[#F3E6D1] hover:text-white">Back to contacts</Link>
        </div>
      </DashboardLayout>
    );
  }

  const pipeline = latestStatus ? PIPELINE_TONES[latestStatus] ?? PIPELINE_TONES.sent : null;

  return (
    <DashboardLayout>
      <PageContainer className="pb-32">
        {/* Backlink */}
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-[11px] text-[#B4AA99] hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={12} />
          All contacts
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-6 sm:gap-8 lg:gap-10">
          {/* Left column — avatar disc + identity + actions. Sticky on
              tall viewports so the right column scrolls under it. */}
          <div className="lg:sticky lg:top-10 lg:self-start">
            <div className="rounded-2xl bg-gradient-to-br from-[#171511] to-[#090907] border border-[#2B2821] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)] relative overflow-hidden">
              {/* Warm radial wash in the corner — same lit-from-corner
                  pattern the drawer header + share modal use. */}
              <div
                className="absolute -top-12 -left-12 w-32 h-32 rounded-full pointer-events-none opacity-30"
                style={{ background: 'radial-gradient(circle, #E7D7BE 0%, transparent 70%)' }}
              />
              <div className="relative z-10">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#342F27] to-[#211F1A] border border-[#C9BCA8]/30 flex items-center justify-center mb-4 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                  <span className="text-[28px] font-medium text-[#F3E6D1]">
                    {contact.name[0]?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <EditableLine
                  value={contact.name}
                  onSave={(v) => patchField('name', v)}
                  className="text-[22px] font-medium text-white leading-tight tracking-tight"
                  placeholder="Name"
                />
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-[#B4AA99]">
                  {contact.role && <span>{contact.role}</span>}
                  {contact.role && contact.label && <span>·</span>}
                  {contact.label && <span>{contact.label}</span>}
                  {!contact.role && !contact.label && <span className="text-[#6E685B]">Role / Label</span>}
                </div>

                {/* Buyer pipeline badge (store buyers only) */}
                {contact.buyer_pipeline_status && contact.category === 'buyer' && (
                  <div className="mt-2">
                    <span className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      contact.buyer_pipeline_status === 'purchased' || contact.buyer_pipeline_status === 'repeat_buyer'
                        ? 'text-[#6DC6A4] bg-[#6DC6A4]/10 border-[#6DC6A4]/25'
                        : 'text-[#E7D7BE] bg-[#E7D7BE]/10 border-[#E7D7BE]/25'
                    }`}>
                      {contact.buyer_pipeline_status.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}

                {/* Status pills row */}
                <div className="flex items-center gap-1.5 mt-4 flex-wrap">
                  <EngagementPill tone={engagementTone} />
                  {pipeline && (
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset ${pipeline.ring} ${pipeline.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${pipeline.dot}`} />
                      {pipeline.label}
                    </span>
                  )}
                </div>

                {/* CRM lifecycle stage — inline editable */}
                <div className="mt-3">
                  <ContactStageCell
                    contactId={contact.id}
                    value={contact.crm_status}
                    derivedTone={engagementTone}
                    onChanged={(next) => setContact((c) => c ? { ...c, crm_status: next as CrmStage } : c)}
                  />
                </div>

                {/* Quick stats strip */}
                {quickStats.total > 0 && (
                  <div className="flex items-center gap-2 mt-3 text-[10px] font-mono text-[#9B9282] flex-wrap">
                    <span className="tabular-nums">{quickStats.total} send{quickStats.total === 1 ? '' : 's'}</span>
                    {quickStats.lastSentAt && <><span className="text-[#3B372F]">·</span><span>{relativeDays(quickStats.lastSentAt)}</span></>}
                    {quickStats.openRate !== null && <><span className="text-[#3B372F]">·</span><span className={quickStats.openRate > 0 ? 'text-[#6DC6A4]' : ''}>{quickStats.openRate}% opened</span></>}
                  </div>
                )}

                {/* Primary actions */}
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => setSendModalOpen(true)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-white text-black text-[12px] font-medium hover:bg-[#F7EBDD] active:scale-[0.98] transition-all"
                  >
                    <Send size={12} />
                    Send beat
                  </button>
                  {needsNudge && latestSend && (
                    <button onClick={() => setNudgeModalOpen(true)} title="Needs a nudge — last send gone cold"
                      className="px-3 py-2.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 transition-colors">
                      <BellRing size={12} />
                    </button>
                  )}
                  <button
                    onClick={deleteContact}
                    className="px-3 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[#B4AA99] hover:text-red-400 hover:border-red-500/30 text-[12px] font-medium transition-colors"
                    title="Delete contact"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right column — editable detail fields + activity timeline. */}
          <div className="min-w-0 space-y-8">
            {/* Detail field grid */}
            <section>
              <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] mb-3">Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <DetailField icon={<Mail size={11} />}    label="Email"     value={contact.email}     onSave={(v) => patchField('email', v)} />
                <DetailField icon={<Phone size={11} />}   label="Phone"     value={contact.phone}     onSave={(v) => patchField('phone', v)} />
                <DetailField icon={<Tag size={11} />}     label="Category"  value={contact.category} onSave={(v) => patchField('category', v)} />
                <DetailField icon={<Tag size={11} />}     label="Genre"     value={contact.genre}     onSave={(v) => patchField('genre', v)} />
                <DetailField icon={<Globe size={11} />}   label="Instagram" value={contact.instagram} onSave={(v) => patchField('instagram', v)} prefix="@" />
                <DetailField icon={<Globe size={11} />}   label="Twitter"   value={contact.twitter}   onSave={(v) => patchField('twitter', v)} prefix="@" />
                <DetailField icon={<MapPin size={11} />}  label="City"      value={contact.city}      onSave={(v) => patchField('city', v)} />
                <DetailField icon={<MapPin size={11} />}  label="Country"   value={contact.country}   onSave={(v) => patchField('country', v)} />
              </div>
            </section>

            {/* Tags — free-form CRM tags (mig 091) for find / regroup. */}
            <section>
              <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] mb-3 flex items-center gap-2">
                <Tag size={11} /> Tags
              </h2>
              <ContactTagPicker contactId={contact.id} />
            </section>

            {/* Notes — full-width textarea, autosave on blur. */}
            <section>
              <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] mb-3 flex items-center gap-2">
                <FileText size={11} /> Notes
              </h2>
              <textarea
                defaultValue={contact.notes ?? ''}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (contact.notes ?? '')) patchField('notes', v || null);
                }}
                placeholder="Session memory, preferred genres, decisions on past sends…"
                className="w-full min-h-[120px] bg-white/[0.02] border border-[#2B2821] rounded-xl px-4 py-3 text-[13px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F] resize-y"
              />
            </section>

            {/* Unified CRM activity timeline — beat sends, email opens,
                link clicks, and purchases (buyer-email matched) merged into
                one story, plus manual notes. Self-fetching component. */}
            {/* Follow-up tasks / reminders for this contact. */}
            <ContactTasks contactId={contact.id} />

            <ContactActivityTimeline
              contactId={contact.id}
              contactName={contact.name}
              onSendBeat={() => setSendModalOpen(true)}
            />
          </div>
        </div>
      </PageContainer>

      {sendModalOpen && (
        <SendBeatModal
          contact={contact}
          priorSentTrackIds={sends.length > 0 ? new Set(sends.flatMap((s) => s.track_ids ?? [])) : undefined}
          onClose={() => setSendModalOpen(false)}
          onSuccess={() => { setSendModalOpen(false); fetchAll(); }}
        />
      )}
      {nudgeModalOpen && latestSend && (
        <NudgeModal
          contact={contact}
          latestSend={latestSend}
          onClose={() => setNudgeModalOpen(false)}
          onSuccess={() => { setNudgeModalOpen(false); fetchAll(); }}
        />
      )}
    </DashboardLayout>
  );
}

/**
 * Compact engagement pill — same three tones as the row pills on the
 * contacts list. Doesn't need to be clickable here since this page is
 * about a single contact, not a filter.
 */
function EngagementPill({ tone }: { tone: 'active' | 'engaged' | 'cold' }) {
  const cfg =
    tone === 'active'  ? { dot: 'bg-[#F3E6D1]', text: 'text-[#F3E6D1]', ring: 'ring-[#C9BCA8]/40', label: 'Active' }
  : tone === 'engaged' ? { dot: 'bg-[#C9BCA8]', text: 'text-[#D0C3AF]', ring: 'ring-[#3B372F]',    label: 'Engaged' }
  :                      { dot: 'bg-[#6E685B]', text: 'text-[#B4AA99]', ring: 'ring-[#3B372F]',    label: 'Cold' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset ${cfg.ring} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${tone === 'active' ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
}

/**
 * Click-to-edit single-line text field. Used for the contact's name
 * in the avatar card — clicking the text reveals an input + Save/Cancel
 * row. Empty input is treated as "delete the value" via null.
 */
function EditableLine({
  value, onSave, className, placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onSave(draft.trim()); setEditing(false); }
            else if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
          className={cn('bg-transparent border-b border-[#C9BCA8]/50 outline-none text-white w-full', className)}
        />
        <button onClick={() => { onSave(draft.trim()); setEditing(false); }} className="p-1 text-[#F3E6D1]"><Check size={13} /></button>
        <button onClick={() => { setDraft(value); setEditing(false); }} className="p-1 text-[#B4AA99]"><X size={13} /></button>
      </div>
    );
  }
  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className={cn('group inline-flex items-center gap-1.5 w-full text-left', className)}
    >
      <span className="truncate">{value || placeholder}</span>
      <Edit2 size={11} className="opacity-0 group-hover:opacity-60 text-[#B4AA99] shrink-0" />
    </button>
  );
}

/**
 * Single inline-editable detail field — icon + label header,
 * click-to-edit input below. Empty input saves as null so blank
 * fields don't accumulate empty-string clutter in Postgres.
 */
function DetailField({
  icon, label, value, onSave, prefix,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  onSave: (v: string | null) => void;
  prefix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => {
    const trimmed = draft.trim();
    onSave(trimmed.length === 0 ? null : trimmed);
    setEditing(false);
  };

  return (
    <div className="px-3 py-2.5 rounded-xl border border-[#2B2821] bg-[#171511] hover:border-[#3B372F] transition-colors">
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#B4AA99] mb-1">
        <span className="text-[#6E685B]">{icon}</span>
        {label}
      </div>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          }}
          className="w-full bg-transparent outline-none text-[12px] text-[#F7EBDD] border-b border-[#C9BCA8]/40"
          placeholder={`Add ${label.toLowerCase()}`}
        />
      ) : (
        <button onClick={() => { setDraft(value ?? ''); setEditing(true); }} className="block text-left text-[12px] w-full">
          {value ? (
            <span className="text-[#F7EBDD]">{prefix}{value}</span>
          ) : (
            <span className="text-[#6E685B]">Add {label.toLowerCase()}</span>
          )}
        </button>
      )}
    </div>
  );
}
