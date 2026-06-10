'use client';

import Link from 'next/link';
import { Clock, Send, Mail, BellRing, ArrowUp, ArrowDown, Check } from 'lucide-react';
import type { Contact } from '@/lib/types';
import type { CrmStage } from '@/lib/contracts';
import type { ContactSortMode, SortDir, ContactStatusFilter } from '@/lib/contacts/filters';
import { ContactAvatar, ContactStageCell, ActivityDot, relativeDays, type ActivityTone } from './contacts-shared';

interface Props {
  contacts: Contact[];                         // paginated slice
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectPage: () => void;              // header checkbox — all rows on this page
  allPageSelected: boolean;

  sortMode: ContactSortMode;
  sortDir: SortDir;
  onSort: (col: ContactSortMode) => void;

  sendCountByContact: Map<string, number>;
  lastSentByContact: Map<string, string>;
  latestStatusByContact: Map<string, string>;
  leadScoreByContact?: Map<string, number>;
  leadTierByContact?: Map<string, string>;
  toneFor: (id: string) => ActivityTone;
  statusFilter: ContactStatusFilter;
  onFilterTone: (t: ActivityTone) => void;
  needsNudge: (id: string) => boolean;

  onOpenHistory: (c: Contact) => void;
  onSend: (c: Contact) => void;
  onNudge: (c: Contact) => void;
  onStageChange: (id: string, next: CrmStage | null) => void;

  dropHoverId: string | null;
  onRowDragOver: (id: string, e: React.DragEvent) => void;
  onRowDragLeave: (e: React.DragEvent) => void;
  onRowDrop: (c: Contact, e: React.DragEvent) => void;
}

const LEAD_TINTS: Record<string, string> = { hot: '#E8896A', warm: '#D4BFA0', cold: '#7d92b0', new: '#6a5d4a' };

function SortHeader({ label, col, active, dir, onSort, className }: { label: string; col: ContactSortMode; active: boolean; dir: SortDir; onSort: (c: ContactSortMode) => void; className?: string }) {
  return (
    <th className={`text-left font-mono uppercase tracking-wider text-[10px] text-[#6a5d4a] font-normal ${className ?? ''}`}>
      <button onClick={() => onSort(col)} className="inline-flex items-center gap-1 hover:text-[#a08a6a] transition-colors">
        {label}
        {active && (dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );
}

export function ContactsTable(p: Props) {
  return (
    <>
      {/* ── Desktop: the full data table (lg+, where 920px fits) ──────── */}
      <div className="hidden lg:block border border-[var(--border)] rounded-xl overflow-hidden overflow-x-auto bg-[var(--bg-card)]">
        <table className="w-full min-w-[920px] border-collapse">
          <thead className="sticky top-0 z-10 bg-[#0e0c08]">
            <tr className="border-b border-[var(--border)] h-9">
              <th className="w-10 px-3">
                <input type="checkbox" checked={p.allPageSelected} onChange={p.onToggleSelectPage} aria-label="Select page" className="accent-[var(--accent)] cursor-pointer" />
              </th>
              <SortHeader label="Contact" col="name" active={p.sortMode === 'name'} dir={p.sortDir} onSort={p.onSort} className="px-2" />
              <th className="text-left font-mono uppercase tracking-wider text-[10px] text-[#6a5d4a] font-normal px-2 hidden md:table-cell">Role</th>
              <th className="text-left font-mono uppercase tracking-wider text-[10px] text-[#6a5d4a] font-normal px-2 w-[150px]">Stage</th>
              <SortHeader label="Last Sent" col="lastSent" active={p.sortMode === 'lastSent'} dir={p.sortDir} onSort={p.onSort} className="px-2 w-[130px] hidden sm:table-cell" />
              <th className="text-left font-mono uppercase tracking-wider text-[10px] text-[#6a5d4a] font-normal px-2 hidden lg:table-cell">Tags</th>
              <SortHeader label="Sends" col="sends" active={p.sortMode === 'sends'} dir={p.sortDir} onSort={p.onSort} className="px-2 w-[70px] hidden sm:table-cell" />
              <SortHeader label="Lead" col="lead" active={p.sortMode === 'lead'} dir={p.sortDir} onSort={p.onSort} className="px-2 w-[90px] hidden md:table-cell" />
              <th className="text-right font-mono uppercase tracking-wider text-[10px] text-[#6a5d4a] font-normal px-3 w-[120px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {p.contacts.map((c, i) => {
              const sel = p.selectedIds.has(c.id);
              const sends = p.sendCountByContact.get(c.id) ?? 0;
              const last = p.lastSentByContact.get(c.id);
              const lastDays = last ? Math.floor((Date.now() - Date.parse(last)) / 86_400_000) : null;
              const tone = p.toneFor(c.id);
              const nudge = p.needsNudge(c.id);
              const isDrop = p.dropHoverId === c.id;

              return (
                <tr
                  key={c.id}
                  onDragOver={(e) => p.onRowDragOver(c.id, e)}
                  onDragLeave={p.onRowDragLeave}
                  onDrop={(e) => p.onRowDrop(c, e)}
                  className={`group border-b border-[#16130e] transition-colors ${
                    isDrop ? 'ring-2 ring-[var(--accent)]/60 ring-inset bg-[var(--accent-tint)]' : sel ? 'bg-[var(--accent-tint)]/40' : i % 2 ? 'bg-[#100d09]/40 hover:bg-[#1a160f]' : 'hover:bg-[#1a160f]'
                  }`}
                >
                  {/* Checkbox */}
                  <td className="px-3 align-middle">
                    <input type="checkbox" checked={sel} onChange={() => p.onToggleSelect(c.id)} className="accent-[var(--accent)] cursor-pointer" aria-label={`Select ${c.name}`} />
                  </td>

                  {/* Contact: avatar + name + sent ✓ */}
                  <td className="px-2 py-2.5 align-middle">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ContactAvatar name={c.name} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/contacts/${c.id}`} className="text-[14px] font-semibold text-[var(--text-primary)] truncate hover:text-white transition-colors">
                            {c.name}
                          </Link>
                          {sends > 0 && (
                            <span title={`${sends} beat${sends === 1 ? '' : 's'} sent`} className="inline-flex items-center text-[#6DC6A4]">
                              <Check size={11} strokeWidth={3} />
                            </span>
                          )}
                        </div>
                        {c.email && <p className="text-[11px] text-[var(--text-readable)] truncate">{c.email}</p>}
                      </div>
                    </div>
                  </td>

                  {/* Role / Category */}
                  <td className="px-2 align-middle hidden md:table-cell">
                    <p className="text-[12px] text-[#a08a6a] truncate">{c.role || c.label || c.category || '—'}</p>
                  </td>

                  {/* Stage (editable) */}
                  <td className="px-2 align-middle">
                    <ContactStageCell contactId={c.id} value={c.crm_status} derivedTone={tone} onChanged={(next) => p.onStageChange(c.id, next)} />
                  </td>

                  {/* Last sent + activity dot */}
                  <td className="px-2 align-middle hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-mono tabular-nums ${lastDays != null && lastDays > 30 ? 'text-[#e8a86a]' : 'text-[var(--text-readable)]'}`}>
                        {relativeDays(last)}
                      </span>
                      <ActivityDot tone={tone} onClick={p.onFilterTone} active={p.statusFilter === tone} />
                    </div>
                  </td>

                  {/* Tags */}
                  <td className="px-2 align-middle hidden lg:table-cell">
                    <div className="flex items-center gap-1 flex-wrap">
                      {(c.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t.tag} className="text-[9px] font-mono uppercase tracking-wider text-[#a08a6a] bg-[#1a160f] border border-[var(--border-hover)] px-1.5 py-0.5 rounded">{t.tag}</span>
                      ))}
                      {(c.tags?.length ?? 0) > 3 && <span className="text-[9px] font-mono text-[#6a5d4a]">+{c.tags!.length - 3}</span>}
                      {(c.tags?.length ?? 0) === 0 && <span className="text-[#2d2620]">—</span>}
                    </div>
                  </td>

                  {/* Sends */}
                  <td className="px-2 align-middle hidden sm:table-cell">
                    {sends > 0 ? (
                      <span className="text-[11px] font-mono tabular-nums text-[#a08a6a] bg-[#1a160f] rounded px-1.5 py-0.5">{sends}</span>
                    ) : <span className="text-[#2d2620]">—</span>}
                  </td>

                  {/* Lead score + tier dot */}
                  <td className="px-2 align-middle hidden md:table-cell">
                    {(() => {
                      const tier = p.leadTierByContact?.get(c.id);
                      const score = p.leadScoreByContact?.get(c.id) ?? 0;
                      if (!tier || tier === 'new') return <span className="text-[#2d2620]">—</span>;
                      const clr = LEAD_TINTS[tier] ?? '#6a5d4a';
                      return (
                        <span className="inline-flex items-center gap-1.5" title={`${tier} lead · score ${score}`}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: clr, boxShadow: `0 0 6px ${clr}66` }} />
                          <span className="text-[11px] font-mono tabular-nums" style={{ color: clr }}>{score}</span>
                        </span>
                      );
                    })()}
                  </td>

                  {/* Actions */}
                  <td className="px-3 align-middle">
                    <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                      {nudge && (
                        <button onClick={() => p.onNudge(c)} title="Needs a nudge — send follow-up" aria-label={`Nudge ${c.name}`}
                          className="tap w-7 h-7 rounded-md flex items-center justify-center text-[#e8a86a] hover:bg-[#e8a86a]/15 transition-colors">
                          <BellRing size={13} />
                        </button>
                      )}
                      <button onClick={() => p.onOpenHistory(c)} title={sends > 0 ? `${sends} sends — view history` : 'View history'} aria-label={`History for ${c.name}`}
                        className="tap w-7 h-7 rounded-md flex items-center justify-center text-[#6a5d4a] hover:text-[#E8DCC8] hover:bg-[#1a160f] transition-colors">
                        <Clock size={13} />
                      </button>
                      <button onClick={() => p.onSend(c)} title={sends > 0 ? 'Beat already sent — send another?' : 'Send beat'}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10px] font-medium border border-[var(--border-hover)] text-[#E8D8B8] hover:bg-[var(--accent-tint)] hover:border-[var(--accent-dim)]/60 transition-colors">
                        {sends > 0 ? <Mail size={11} /> : <Send size={11} />}
                        {sends > 0 ? 'Again' : 'Send'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Phone / tablet: the SAME data as stacked cards (below lg) ──── */}
      <div className="lg:hidden space-y-2.5">
        {p.contacts.map((c) => {
          const sel = p.selectedIds.has(c.id);
          const sends = p.sendCountByContact.get(c.id) ?? 0;
          const last = p.lastSentByContact.get(c.id);
          const lastDays = last ? Math.floor((Date.now() - Date.parse(last)) / 86_400_000) : null;
          const tone = p.toneFor(c.id);
          const nudge = p.needsNudge(c.id);
          const tier = p.leadTierByContact?.get(c.id);
          const score = p.leadScoreByContact?.get(c.id) ?? 0;
          const showLead = tier && tier !== 'new';
          const leadClr = showLead ? (LEAD_TINTS[tier] ?? '#6a5d4a') : '#6a5d4a';
          const tags = c.tags ?? [];

          return (
            <div
              key={c.id}
              className={`rounded-2xl border p-3.5 transition-colors ${sel ? 'border-[var(--accent-dim)]/50 bg-[var(--accent-tint)]/40' : 'border-[var(--border)] bg-[var(--bg-card)]'}`}
            >
              {/* Row 1 — select · avatar · name/email · lead */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={sel}
                  onChange={() => p.onToggleSelect(c.id)}
                  aria-label={`Select ${c.name}`}
                  className="tap accent-[var(--accent)] w-4 h-4 shrink-0 cursor-pointer"
                />
                <ContactAvatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/contacts/${c.id}`} className="text-[15px] font-semibold text-[var(--text-primary)] truncate hover:text-white transition-colors">
                      {c.name}
                    </Link>
                    {sends > 0 && (
                      <span title={`${sends} beat${sends === 1 ? '' : 's'} sent`} className="inline-flex items-center text-[#6DC6A4] shrink-0">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  {c.email && <p className="text-[12px] text-[var(--text-readable)] truncate">{c.email}</p>}
                </div>
                {showLead && (
                  <span
                    className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full"
                    title={`${tier} lead · score ${score}`}
                    style={{ background: `${leadClr}1f`, border: `1px solid ${leadClr}40` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: leadClr }} />
                    <span className="text-[11px] font-mono tabular-nums" style={{ color: leadClr }}>{score}</span>
                  </span>
                )}
              </div>

              {/* Row 2 — stage · last sent + dot */}
              <div className="flex items-center justify-between gap-2 mt-3">
                <ContactStageCell contactId={c.id} value={c.crm_status} derivedTone={tone} onChanged={(next) => p.onStageChange(c.id, next)} />
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] font-mono tabular-nums ${lastDays != null && lastDays > 30 ? 'text-[#e8a86a]' : 'text-[var(--text-readable)]'}`}>
                    {relativeDays(last)}
                  </span>
                  <ActivityDot tone={tone} onClick={p.onFilterTone} active={p.statusFilter === tone} />
                </div>
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-2.5">
                  {tags.slice(0, 4).map((t) => (
                    <span key={t.tag} className="text-[9px] font-mono uppercase tracking-wider text-[#a08a6a] bg-[#1a160f] border border-[var(--border-hover)] px-1.5 py-0.5 rounded">{t.tag}</span>
                  ))}
                  {tags.length > 4 && <span className="text-[9px] font-mono text-[#6a5d4a]">+{tags.length - 4}</span>}
                </div>
              )}

              {/* Actions — full-width, >=44px touch */}
              <div className="flex items-center gap-2 mt-3.5">
                {nudge && (
                  <button
                    onClick={() => p.onNudge(c)}
                    aria-label={`Nudge ${c.name}`}
                    className="min-h-[44px] w-11 shrink-0 rounded-xl flex items-center justify-center text-[#e8a86a] bg-[#e8a86a]/10 border border-[#e8a86a]/25 active:scale-95 transition-transform"
                  >
                    <BellRing size={16} />
                  </button>
                )}
                <button
                  onClick={() => p.onOpenHistory(c)}
                  aria-label={`History for ${c.name}`}
                  className="min-h-[44px] flex-1 rounded-xl flex items-center justify-center gap-2 text-[12px] font-medium text-[#a08a6a] bg-white/[0.03] border border-[var(--border)] active:scale-[0.98] transition-transform"
                >
                  <Clock size={14} /> History
                </button>
                <button
                  onClick={() => p.onSend(c)}
                  aria-label={sends > 0 ? `Send another beat to ${c.name}` : `Send beat to ${c.name}`}
                  className="min-h-[44px] flex-1 rounded-xl flex items-center justify-center gap-2 text-[12px] font-bold text-[#E8D8B8] bg-[var(--accent-tint)] border border-[var(--accent-dim)]/50 active:scale-[0.98] transition-transform"
                >
                  {sends > 0 ? <Mail size={14} /> : <Send size={14} />}
                  {sends > 0 ? 'Again' : 'Send'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
