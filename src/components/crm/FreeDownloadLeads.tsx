'use client';

/**
 * Free-download leads panel.
 *
 * These addresses have been accumulating since migration 037 and nothing ever
 * read them — the producer's warmest audience was invisible. This surfaces the
 * list and lets it be promoted into the CRM.
 *
 * Promotion is explicit, never automatic: someone who took a free beat has not
 * opted into outreach, and quietly filling the CRM with them would corrupt both
 * its meaning and its pipeline statistics.
 */

import { useCallback, useEffect, useState } from 'react';
import { Download, UserPlus, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from '@/hooks/useToast';

interface Lead {
  email: string;
  downloads: number;
  tracks: string[];
  firstDownloadAt: string;
  lastDownloadAt: string;
}

export function FreeDownloadLeads() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [newLeads, setNewLeads] = useState<Lead[]>([]);
  const [totalDownloads, setTotalDownloads] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/store/free-downloads');
      if (!res.ok) return;
      const json = await res.json();
      setLeads(json.leads ?? []);
      setNewLeads(json.newLeads ?? []);
      setTotalDownloads(json.totalDownloads ?? 0);
    } catch {
      setLeads([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const promoteAll = useCallback(async () => {
    if (newLeads.length === 0) return;
    setPromoting(true);
    try {
      const res = await fetch('/api/store/free-downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: newLeads.map((l) => l.email) }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error('Could not add contacts', json?.error ?? 'Please try again.');
        return;
      }
      toast.success(
        `Added ${json.created} contact${json.created === 1 ? '' : 's'}`,
        json.skipped ? `${json.skipped} already in your CRM.` : 'Find them under Contacts.',
      );
      await load();
    } catch {
      toast.error('Could not add contacts', 'Please try again.');
    } finally {
      setPromoting(false);
    }
  }, [newLeads, load]);

  // Nothing collected yet — say nothing rather than showing an empty shell.
  if (!leads || leads.length === 0) return null;

  const shown = expanded ? leads : leads.slice(0, 5);

  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Download size={13} className="text-[#6DC6A4]" aria-hidden />
          <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/60">
            Free download leads
          </h2>
          <span className="font-mono text-[10px] tabular-nums text-white/35">
            {leads.length} {leads.length === 1 ? 'person' : 'people'} · {totalDownloads} downloads
          </span>
        </div>

        {newLeads.length > 0 ? (
          <button
            type="button"
            onClick={promoteAll}
            disabled={promoting}
            className="flex items-center gap-1.5 rounded-lg border border-[#D4BFA0]/30 bg-[#D4BFA0]/[0.10] px-3 py-1.5 text-[11px] text-[#E8DCC8] transition-colors hover:border-[#D4BFA0]/50 hover:bg-[#D4BFA0]/[0.16] disabled:opacity-50"
          >
            {promoting ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
            Add {newLeads.length} to contacts
          </button>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/30">
            All in contacts
          </span>
        )}
      </div>

      <ul className="divide-y divide-white/[0.05]">
        {shown.map((lead) => (
          <li key={lead.email} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] text-white/85">{lead.email}</p>
              {lead.tracks.length > 0 ? (
                <p className="truncate text-[10px] text-white/35">{lead.tracks.slice(0, 3).join(' · ')}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {/* Repeat downloaders are the warm ones — worth calling out. */}
              {lead.downloads > 1 ? (
                <span className="rounded border border-[#6DC6A4]/25 bg-[#6DC6A4]/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#6DC6A4]">
                  {lead.downloads}x
                </span>
              ) : null}
              <time
                dateTime={lead.lastDownloadAt}
                className="font-mono text-[10px] tabular-nums text-white/30"
              >
                {new Date(lead.lastDownloadAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </time>
            </div>
          </li>
        ))}
      </ul>

      {leads.length > 5 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-white/40 transition-colors hover:text-white/70"
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? 'Show less' : `Show all ${leads.length}`}
        </button>
      ) : null}
    </section>
  );
}
