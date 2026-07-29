import { useState } from 'react';
import { BeatSend, Contact } from '@/lib/types';
import { Mail, CheckCircle, Clock, XCircle, ArrowUpRight, Music, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface BeatLogProps {
  sends: BeatSend[];
  /** Optional contact lookup so each row renders the actual contact name
   *  instead of "Contact ID: <uuid>". Passed in from the parent list page
   *  which already has the contacts loaded. */
  contacts?: Contact[];
}

const STATUS_CONFIG: Record<string, { icon: typeof Mail; dot: string; text: string; ring: string; label: string }> = {
  sent:        { icon: Mail,        dot: 'bg-white/40', text: 'text-white/70', ring: 'ring-white/20',    label: 'Sent' },
  opened:      { icon: Clock,       dot: 'bg-[#7aa8e8]', text: 'text-[#7aa8e8]', ring: 'ring-[#3a4a6a]',    label: 'Opened' },
  interested:  { icon: ArrowUpRight,dot: 'bg-white', text: 'text-white', ring: 'ring-white/40', label: 'Interested' },
  negotiating: { icon: Clock,       dot: 'bg-[#e8a86a]', text: 'text-[#e8a86a]', ring: 'ring-white/40', label: 'Negotiating' },
  placed:      { icon: CheckCircle, dot: 'bg-[#6DC6A4]', text: 'text-[#6DC6A4]', ring: 'ring-[#1f5a4a]',    label: 'Placed' },
  pass:        { icon: XCircle,     dot: 'bg-[#e88a8a]', text: 'text-[#e88a8a]', ring: 'ring-[#6a2a2a]',    label: 'Pass' },
};

// Fallback tags for contacts without tags
const TAG_PELLETS = [
  { bg: 'bg-[#1f1a10]', text: 'text-[#c8a47a]', border: 'border-[#3d3020]/30' },
  { bg: 'bg-[#0a1f0f]', text: 'text-[#6DC6A4]', border: 'border-[#1f5a4a]/40' },
  { bg: 'bg-[#1f1a0a]', text: 'text-amber-400', border: 'border-[#3a2f1f]/60' },
  { bg: 'bg-[#1f0f0a]', text: 'text-[#e87a6a]', border: 'border-[#6a2a1f]/40' },
  { bg: 'bg-[#0a1420]', text: 'text-[#7aa8e8]', border: 'border-[#3a4a6a]/40' },
  { bg: 'bg-[#1a1410]', text: 'text-white', border: 'border-white/30' },
];

function relativeDays(iso: string, nowMs: number): string {
  const days = Math.floor((nowMs - Date.parse(iso)) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

export function BeatLog({ sends, contacts = [] }: BeatLogProps) {
  const [nowMs] = useState(() => Date.now());
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  const sorted = [...sends].sort((a, b) =>
    Date.parse(b.sent_at) - Date.parse(a.sent_at),
  );

  return (
    <div className="w-full bg-[#090907] border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/60 mb-1">CRM · Pipeline</p>
          <h3 className="text-[13px] font-bold text-white">Beat Sends</h3>
        </div>
        <span className="text-[10px] font-mono text-white/40 tabular-nums">{sends.length} record{sends.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table header */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-[40px_1.8fr_0.9fr_1fr_100px_60px] items-center gap-4 px-5 h-8 border-b border-white/10 text-[9px] font-mono uppercase tracking-wider text-white/40 bg-[#090907]">
          <span />
          <span>Contact</span>
          <span>Tracks</span>
          <span>Message</span>
          <span>Status</span>
          <span className="text-right">Open</span>
        </div>

        <div className="divide-y divide-white/10">
          {sorted.map((send, i) => {
            const contact = contactMap.get(send.contact_id);
            const name = contact?.name || contact?.email || 'Unknown Contact';
            const cfg = STATUS_CONFIG[send.status] || STATUS_CONFIG.sent;
            const Icon = cfg.icon;

            return (
              <div
                key={send.id}
                className="grid grid-cols-[40px_1.8fr_0.9fr_1fr_100px_60px] items-center gap-4 px-5 h-14 hover:bg-white/10 transition-colors"
              >
                {/* Icon */}
                <div className="flex justify-center">
                  <div className="w-7 h-7 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center">
                    <Icon size={13} className={cfg.text} />
                  </div>
                </div>

                {/* Contact */}
                <div className="min-w-0 pr-2">
                  <span className="text-[12px] font-medium text-white truncate">{name}</span>
                  {contact?.email && contact.name !== contact.email && (
                    <p className="text-[10px] text-white/40 truncate">{contact.email}</p>
                  )}
                </div>

                {/* Track count */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <Music size={10} className="text-white/40 shrink-0" />
                  <span className="text-[11px] font-mono text-white/80 tabular-nums">
                    {(send.track_ids?.length ?? 0)}
                  </span>
                </div>

                {/* Message snippet */}
                <div className="min-w-0 pr-2">
                  <p className="text-[10px] text-white/60 truncate">
                    {send.message || <span className="text-white/40 italic">No message</span>}
                  </p>
                </div>

                {/* Status pill */}
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.dot === 'bg-white/40' ? '' : 'animate-pulse'}`} />
                  <span className={`text-[10px] font-mono uppercase tracking-wider ${cfg.text}`}>
                    {cfg.label}
                  </span>
                </div>

                {/* Open link */}
                <div className="flex justify-end">
                  <a
                    href={`/share/${send.share_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-7 h-7 rounded-full border border-white/20 hover:border-white/40 flex items-center justify-center text-white/40 hover:text-white transition-all"
                    title="View Share Page"
                  >
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            );
          })}

          {sends.length === 0 && (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                <Mail size={18} className="text-white/40" />
              </div>
              <div className="mt-3">
                <p className="text-[12px] text-white mb-1">No sends yet</p>
                <p className="text-[10px] text-white/40">Send a beat to a contact to start tracking your pipeline</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
