'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X, Send, Loader2, Search, Check, Music, Layers, Eye, Pencil,
  Lock, Calendar, MessageSquare, Download, Disc3, Tag as TagIcon, Users, Sparkles,
  Star, ArrowUpDown, Zap, Mail, BookmarkPlus, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Contact, Track } from '@/lib/types';
import { toast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';
import { Modal } from '@/components/ui/Modal';
import { buildBeatSendEmail, defaultSubject } from '@/lib/email/beat-send-template';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';

// Simple avatar color from name — used in preview recipient chip.
const PREVIEW_PALETTES = [
  { bg: 'bg-white/10', text: 'text-white' },
  { bg: 'bg-[#1a1833]', text: 'text-[#AFA9EC]' },
  { bg: 'bg-[#0d2318]', text: 'text-[#6DC6A4]' },
  { bg: 'bg-[#2a1810]', text: 'text-[#e8a86a]' },
];
function previewPalette(name: string) { return PREVIEW_PALETTES[(name.charCodeAt(0) ?? 0) % PREVIEW_PALETTES.length]; }

interface Project {
  id: string;
  name: string;
  cover_url: string | null;
  description: string | null;
  track_count?: number;
}

type TrackWithTags = Track & {
  track_tags?: { tag: string }[];
};

function trackTags(track: Track): { tag: string }[] {
  return (track as TrackWithTags).track_tags ?? [];
}

interface SendBeatModalProps {
  /** Single contact or list of contacts. Both supported for back-compat. */
  contact?: Contact;
  contacts?: Contact[];
  /**
   * Pre-populated track selection — used when the modal is opened
   * via a track-on-contact drag-and-drop. Mode auto-switches to
   * 'tracks' so the user lands on their pre-selected pack.
   */
  initialTrackIds?: string[];
  /**
   * Track IDs that have already been sent to this recipient (or any
   * of the recipients in a bulk send). Callers compute this from their
   * already-loaded beatSends and pass it in — no extra fetch needed.
   * Used to show "Sent before" badges on the track picker cards.
   */
  priorSentTrackIds?: Set<string>;
  /**
   * Pre-selected campaign. When set (e.g. opened from a campaign detail
   * page) the campaign selector defaults to it; the send stamps
   * beat_sends.campaign_id and upserts campaign_targets server-side.
   */
  campaignId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type SendMode = 'tracks' | 'project';
type ShareRole = 'viewer' | 'commenter';

/**
 * Send-files-to-contact flow. Supports both single and bulk recipients,
 * tracks-or-project source modes, tag/project filtering for source search,
 * and an email preview tab. For bulk sends we create one share PER
 * recipient so revocation / per-contact tracking stays clean.
 */
export function SendBeatModal({ contact, contacts: contactsProp, initialTrackIds, priorSentTrackIds, campaignId: initialCampaignId, onClose, onSuccess }: SendBeatModalProps) {
  // Normalize the input — caller can pass either `contact` or `contacts`.
  // Internal logic only sees `recipients`.
  const initialRecipients = useMemo<Contact[]>(() => {
    if (contactsProp && contactsProp.length > 0) return contactsProp;
    if (contact) return [contact];
    return [];
  }, [contact, contactsProp]);

  const [recipients, setRecipients] = useState<Contact[]>(initialRecipients);
  // Ad-hoc recipient input — emails not yet in the CRM. Synthetic recipients
  // carry an `adhoc:` id; on send they're find-or-created via /api/contacts/resolve.
  const [adhocEmail, setAdhocEmail] = useState('');

  // When opened via track-on-contact DnD, start on the tracks tab so
  // the user sees their pre-loaded selection right away.
  const [mode, setMode] = useState<SendMode>('tracks');
  const [tab, setTab] = useState<'compose' | 'preview'>('compose');

  // Source state
  const [tracks, setTracks] = useState<Track[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>(initialTrackIds ?? []);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Filters — applied only in tracks mode. Tag is a free-text match against
  // the joined track_tags rows that come back on /api/tracks. ProjectScope
  // restricts the candidate set to tracks already in a chosen project.
  const [tagFilter, setTagFilter] = useState<string>('');
  const [projectScopeId, setProjectScopeId] = useState<string>('');
  const [projectScopeTrackIds, setProjectScopeTrackIds] = useState<string[] | null>(null);

  // Composer state
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [role, setRole] = useState<ShareRole>('viewer');
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [expiresDays, setExpiresDays] = useState(30);
  // Campaign attachment — '' = none. Pre-seeded when opened from a campaign page.
  const [campaignId, setCampaignId] = useState<string>(initialCampaignId ?? '');
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  // Track picker sort mode
  const [trackSort, setTrackSort] = useState<'default' | 'rating' | 'bpm' | 'energy'>('default');
  const [sending, setSending] = useState(false);

  // ── Message templates — saved to localStorage ─────────────────────────
  const TEMPLATES_KEY = 'antigravity-msg-templates';
  interface MsgTemplate { id: string; name: string; subject: string; message: string; createdAt: number }
  const loadTemplates = (): MsgTemplate[] => { try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]'); } catch { return []; } };
  const [templates, setTemplates] = useState<MsgTemplate[]>(() => typeof window !== 'undefined' ? loadTemplates() : []);
  const [showTemplates, setShowTemplates] = useState(false);
  const saveTemplate = () => {
    if (!subject.trim() && !message.trim()) { toast.error('Nothing to save', 'Add a subject or message first'); return; }
    const name = window.prompt('Name this template:', 'Follow-up · Rappers')?.trim();
    if (!name) return;
    const t: MsgTemplate = { id: crypto.randomUUID(), name, subject: subject.trim(), message: message.trim(), createdAt: Date.now() };
    const next = [t, ...templates];
    setTemplates(next);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next));
    toast.success('Template saved');
  };

  const applyTemplate = (t: MsgTemplate) => {
    setSubject(t.subject);
    setMessage(t.message);
    setShowTemplates(false);
    toast.success(`Template loaded: ${t.name}`);
  };

  const deleteTemplate = (id: string) => {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next));
  };

  // Preview recipient index — lets the user flip through recipients to see personalised versions
  const [previewIdx, setPreviewIdx] = useState(0);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        // Parallel fetch — source toggle is then instant.
        const [tRes, pRes, cRes] = await Promise.all([
          fetch('/api/tracks'),
          fetch('/api/projects'),
          fetch('/api/campaigns'),
        ]);
        const tData = await tRes.json();
        const pData = await pRes.json();
        const cData = await cRes.json().catch(() => ({}));
        if (aborted) return;
        setTracks(Array.isArray(tData) ? tData : tData.tracks || []);
        setProjects(pData.projects || []);
        setCampaigns((cData.campaigns ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      } catch (err) {
        console.error('Fetch sources error:', err);
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, []);

  // When a project scope is picked in tracks mode, hydrate the allowed
  // track-id set so the list filters down. We hit /api/tracks?project_id=
  // because the project-tracks junction is server-side and not present in
  // the bulk /api/tracks payload.
  useEffect(() => {
    let aborted = false;
    if (!projectScopeId) {
      setProjectScopeTrackIds(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/tracks?project_id=${projectScopeId}`);
        const data = await res.json();
        if (aborted) return;
        const arr: Track[] = Array.isArray(data) ? data : data.tracks || [];
        setProjectScopeTrackIds(arr.map((t) => t.id));
      } catch {
        if (!aborted) setProjectScopeTrackIds([]);
      }
    })();
    return () => { aborted = true; };
  }, [projectScopeId]);

  // Tag list — collect every distinct tag across the user's tracks. We
  // rely on the joined `track_tags` field that /api/tracks returns when
  // it can; falling back to empty when joins aren't available.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks) {
      const joined = (t as unknown as { track_tags?: { tag: string }[] }).track_tags;
      if (Array.isArray(joined)) joined.forEach((r) => r.tag && set.add(r.tag));
    }
    return Array.from(set).sort();
  }, [tracks]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const selectedTracks = useMemo(
    () => tracks.filter((t) => selectedTrackIds.includes(t.id)),
    [tracks, selectedTrackIds],
  );

  const summary = useMemo(() => {
    if (mode === 'tracks') {
      return {
        title: selectedTracks.length === 1 ? selectedTracks[0].title : `${selectedTracks.length} tracks`,
        cover: selectedTracks[0]?.cover_url ?? null,
        valid: selectedTracks.length > 0,
        countLabel: `${selectedTracks.length} track${selectedTracks.length === 1 ? '' : 's'}`,
      };
    }
    return {
      title: selectedProject?.name ?? 'Pick a project',
      cover: selectedProject?.cover_url ?? null,
      valid: !!selectedProjectId,
      countLabel: selectedProject?.track_count != null
        ? `${selectedProject.track_count} track${selectedProject.track_count === 1 ? '' : 's'}`
        : 'project',
    };
  }, [mode, selectedTracks, selectedProject, selectedProjectId]);

  const baselineTrack = useMemo(() => {
    if (selectedTrackIds.length === 0) return null;
    return tracks.find((t) => t.id === selectedTrackIds[0]) ?? null;
  }, [tracks, selectedTrackIds]);

  const suggestedTracks = useMemo(() => {
    if (!baselineTrack) return [];
    return tracks.filter((t) => {
      if (t.id === baselineTrack.id) return false;
      const withinBpm = baselineTrack.bpm && t.bpm ? Math.abs(t.bpm - baselineTrack.bpm) <= 5 : false;
      
      const baselineTags = new Set(trackTags(baselineTrack).map((r) => r.tag));
      const sharesTag = trackTags(t).some((r) => r.tag && baselineTags.has(r.tag));
      
      return withinBpm || sharesTag;
    });
  }, [tracks, baselineTrack]);

  const filteredTracks = useMemo(() => {
    let pool = tracks;
    if (projectScopeId && projectScopeTrackIds) {
      const allowed = new Set(projectScopeTrackIds);
      pool = pool.filter((t) => allowed.has(t.id));
    }
    if (tagFilter) {
      pool = pool.filter((t) => {
        const tags = (t as unknown as { track_tags?: { tag: string }[] }).track_tags ?? [];
        return tags.some((r) => r.tag === tagFilter);
      });
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      pool = pool.filter((t) => t.title.toLowerCase().includes(q));
    }
    const sorted = [...pool];
    switch (trackSort) {
      case 'rating': sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)); break;
      case 'bpm':    sorted.sort((a, b) => (b.bpm ?? 0) - (a.bpm ?? 0)); break;
      case 'energy': sorted.sort((a, b) => (b.energy ?? 0) - (a.energy ?? 0)); break;
    }
    return sorted;
  }, [tracks, projectScopeId, projectScopeTrackIds, tagFilter, searchQuery, trackSort]);

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const toggleTrack = (id: string) => {
    setSelectedTrackIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  };

  const addAdhocEmail = () => {
    const email = adhocEmail.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email'); return; }
    const emailLc = email.toLowerCase();
    if (recipients.some((r) => (r.email ?? '').toLowerCase() === emailLc)) { setAdhocEmail(''); return; }
    // Synthetic recipient — resolved to a real contact on send.
    const synthetic = { id: `adhoc:${emailLc}`, name: email.split('@')[0] || email, email } as Contact;
    setRecipients((prev) => [...prev, synthetic]);
    setAdhocEmail('');
  };

  const removeRecipient = (id: string) => {
    setRecipients((prev) => prev.filter((c) => c.id !== id));
  };

  // ── Send dispatch (single OR bulk) ───────────────────────────────────
  const handleSend = async () => {
    if (!summary.valid || recipients.length === 0) return;
    setSending(true);

    let succeeded = 0;
    const failures: { name: string; reason: string }[] = [];

    try {
      // Per-recipient share + invite. We create a fresh share per contact
      // so the owner panel shows distinct rows for each send and revoking
      // one recipient's access doesn't affect the others.
      for (const r of recipients) {
        if (!r.email) {
          failures.push({ name: r.name, reason: 'no email' });
          continue;
        }
        try {
          // Ad-hoc recipient — find-or-create a real contact so the send is
          // tracked and the person enters the CRM. Replaces the synthetic id.
          let contactId = r.id;
          if (r.id.startsWith('adhoc:')) {
            const resolveRes = await fetch('/api/contacts/resolve', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: r.email, name: r.name }),
            });
            const resolveData = await resolveRes.json().catch(() => ({}));
            if (!resolveRes.ok || !resolveData.contact?.id) throw new Error(resolveData.error || 'Could not create contact');
            contactId = resolveData.contact.id;
          }
          if (mode === 'project' && selectedProjectId) {
            const shareRes = await fetch(`/api/projects/${selectedProjectId}/shares`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                role,
                allow_downloads: allowDownloads,
                expires_days: expiresDays,
                password: usePassword && password ? password : null,
                invited_email: r.email,
                label: r.name,
              }),
            });
            const data = await shareRes.json();
            if (!shareRes.ok) throw new Error(data.error || `share ${shareRes.status}`);

            const inviteRes = await fetch(`/api/projects/${selectedProjectId}/shares/${data.share.id}/invite`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: r.email, message }),
            });
            if (!inviteRes.ok) {
              const e = await inviteRes.json().catch(() => ({}));
              throw new Error(e.error || `invite ${inviteRes.status}`);
            }
            const inviteData = await inviteRes.json().catch(() => ({}));

            if (campaignId) {
              const trackingRes = await fetch(`/api/campaigns/${campaignId}/targets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  project_send: {
                    contact_id: contactId,
                    project_id: selectedProjectId,
                    share_id: data.share.id,
                    share_token: data.share.token,
                    message,
                    email_resend_id: inviteData.resendId ?? null,
                  },
                }),
              });
              if (!trackingRes.ok) {
                const trackingData = await trackingRes.json().catch(() => ({}));
                throw new Error(trackingData.error || `campaign tracking ${trackingRes.status}`);
              }
            }
          } else {
            const shareRes = await fetch('/api/share', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                track_ids: selectedTrackIds,
                expires_days: expiresDays,
                allow_downloads: allowDownloads,
                password: usePassword && password ? password : null,
              }),
            });
            const shareData = await shareRes.json();
            if (!shareRes.ok) throw new Error(shareData.error || `share ${shareRes.status}`);

            const emailRes = await fetch('/api/email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contactId,
                email: r.email,
                recipientName: r.name,
                trackIds: selectedTrackIds,
                shareToken: shareData.token,
                campaignId: campaignId || null,
                message,
                subject: resolvedSubject,
                packTitle: summary.title,
                packMeta: summary.countLabel,
                coverUrl: summary.cover,
                allowDownloads,
                expiresDays,
                tracks: selectedTracks.map((t) => ({ title: t.title, bpm: t.bpm, key: t.key, type: t.type })),
              }),
            });
            // Two-stage check: HTTP status first (a 500 with non-JSON
            // body would otherwise throw inside .json() and surface as
            // "unknown" in the failures list, hiding the real reason).
            if (!emailRes.ok) {
              const errText = await emailRes.text().catch(() => '');
              throw new Error(errText || `email failed (HTTP ${emailRes.status})`);
            }
            const emailData = await emailRes.json().catch(() => ({}));
            if (!emailData.success) throw new Error(emailData.error || 'email failed');
          }
          succeeded += 1;
        } catch (err: unknown) {
          failures.push({ name: r.name, reason: err instanceof Error ? err.message : 'unknown' });
        }
      }

      if (succeeded > 0 && failures.length === 0) {
        toast.success(
          succeeded === 1 ? 'Sent' : `Sent to ${succeeded}`,
          succeeded === 1
            // toast.success's detail expects string | undefined; the
            // contact's email is typed string | null on the model, so
            // coerce a missing email to `undefined` (we wouldn't reach
            // this branch with no email anyway — the loop skips them).
            ? (recipients[0].email ?? undefined)
            : `${summary.countLabel} to ${succeeded} contacts`,
        );
      } else if (succeeded > 0) {
        toast.warning(
          `Sent ${succeeded}/${recipients.length}`,
          `Failed: ${failures.map((f) => f.name).join(', ')}`,
        );
      } else {
        toast.error('Send failed', failures[0]?.reason || 'No recipients with email');
      }
      onSuccess();
      onClose();
    } finally {
      setSending(false);
    }
  };

  // ── Preview — uses the same canonical template as the actual sent email ──
  const validPreviewIdx = Math.min(previewIdx, Math.max(0, recipients.length - 1));
  const previewContact = recipients[validPreviewIdx] ?? null;
  const previewRecipient = previewContact?.name ?? 'Recipient';
  const resolvedSubject = subject.trim() || defaultSubject('U2C Beatstore', summary.title, mode);
  const previewHtml = useMemo(() => buildBeatSendEmail({
    recipientName: previewRecipient,
    shareUrl: '#preview',
    packTitle: summary.title,
    packMeta: summary.countLabel,
    coverUrl: summary.cover,
    message: message.trim(),
    allowDownloads,
    expiresDays,
    kind: mode,
    tracks: mode === 'tracks' ? selectedTracks.map((t) => ({ title: t.title, bpm: t.bpm, key: t.key, type: t.type })) : [],
  }), [previewRecipient, summary, message, mode, allowDownloads, expiresDays, selectedTracks]);

  const recipientsWithoutEmail = recipients.filter((r) => !r.email);
  const recipientsWithEmail = recipients.length - recipientsWithoutEmail.length;

  return (
    <Modal
      onClose={onClose}
      title={recipients.length > 1 ? `Send to ${recipients.length} contacts` : 'Send to contact'}
      description={
        recipients.length === 1
          ? `${recipients[0].name}${recipients[0].email ? ` · ${recipients[0].email}` : ''}`
          : `${recipientsWithEmail}/${recipients.length} have email`
      }
      icon={recipients.length > 1 ? <Users size={18} /> : <Send size={18} />}
      size="xl"
      className="max-h-[88dvh]"
      contentClassName="p-0"
    >

        {/* Recipients — chips + an "add email" input so you can send to people
            not yet in the CRM. New emails are find-or-created as contacts on send. */}
        <div className="px-8 py-3 border-b border-white/10 bg-[#090907]/40 flex flex-wrap items-center gap-1.5">
          {recipients.map((r) => {
            const isAdhoc = r.id.startsWith('adhoc:');
            return (
              <span
                key={r.id}
                className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${
                  isAdhoc
                    ? 'bg-[#1a1833] border-[#534AB7]/40 text-[#AFA9EC]'
                    : r.email
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-white/[0.05] border-white/10 text-yellow-500/70'
                }`}
                title={r.email || 'No email on file'}
              >
                {isAdhoc ? r.email : r.name}
                {isAdhoc && <span className="text-[7px] opacity-70">NEW</span>}
                {!isAdhoc && !r.email && <span className="text-[8px]">⚠</span>}
                <button onClick={() => removeRecipient(r.id)} className="text-white/60 hover:text-red-400 -mr-0.5" title="Remove from this send">
                  <X size={10} />
                </button>
              </span>
            );
          })}
          {/* Add-email input */}
          <span className="flex items-center gap-1">
            <input
              type="email"
              value={adhocEmail}
              onChange={(e) => setAdhocEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAdhocEmail(); } }}
              placeholder={recipients.length ? 'Add email…' : 'Type an email to send…'}
              className="w-40 bg-white/[0.02] border border-white/10 rounded px-2.5 py-1 text-[11px] text-white placeholder:text-white/40 focus:outline-none focus:border-[#534AB7]/60"
            />
            {adhocEmail.trim() && (
              <button onClick={addAdhocEmail} className="text-[10px] font-mono uppercase tracking-wider text-[#AFA9EC] hover:text-white px-1.5 py-1 rounded transition-colors">
                + Add
              </button>
            )}
          </span>
        </div>

        {/* Mode + tab segmented controls */}
        <div className="px-8 py-3 border-b border-white/10 flex items-center gap-4 bg-[#090907]/40">
          <div className="flex items-center gap-1 bg-[#090907] border border-white/10 rounded-md p-0.5">
            <SegBtn active={mode === 'tracks'} onClick={() => setMode('tracks')} icon={<Music size={11} />}>
              Tracks
            </SegBtn>
            <SegBtn active={mode === 'project'} onClick={() => setMode('project')} icon={<Layers size={11} />}>
              Project
            </SegBtn>
          </div>

          <div className="flex items-center gap-1 bg-[#090907] border border-white/10 rounded-md p-0.5 ml-auto">
            <SegBtn active={tab === 'compose'} onClick={() => setTab('compose')} icon={<Pencil size={11} />}>
              Compose
            </SegBtn>
            <SegBtn active={tab === 'preview'} onClick={() => setTab('preview')} icon={<Eye size={11} />}>
              Preview
            </SegBtn>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left — source selection */}
          <div className="w-5/12 border-r border-white/10 flex flex-col">
            <div className="px-6 pt-4 pb-3 border-b border-white/10 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={12} />
                <input
                  type="text"
                  placeholder={mode === 'tracks' ? 'Search tracks…' : 'Search projects…'}
                  className="w-full bg-[#090907] border border-white/10 rounded-md py-2 pl-9 pr-3 text-[11px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/40"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Tag + project scope + sort — tracks mode only */}
              {mode === 'tracks' && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1 bg-[#090907] border border-white/10 rounded-md px-2 py-1 flex-1 min-w-0">
                      <TagIcon size={9} className="text-white/60 shrink-0" />
                      <Dropdown
                        value={tagFilter || 'none'}
                        onChange={(val) => setTagFilter(val === 'none' ? '' : val)}
                        disabled={allTags.length === 0}
                        options={[{ value: 'none', label: allTags.length === 0 ? 'No tags' : 'Any tag' }, ...allTags.map((t) => ({ value: t, label: t.toUpperCase() }))]}
                        className="bg-transparent border-none text-[10px] text-[#bbb] p-0 hover:bg-transparent hover:border-none focus:ring-0 w-full flex-1 h-6"
                      />
                    </div>
                    <div className="flex items-center gap-1 bg-[#090907] border border-white/10 rounded-md px-2 py-1 flex-1 min-w-0">
                      <Layers size={9} className="text-white/60 shrink-0" />
                      <Dropdown
                        value={projectScopeId || 'none'}
                        onChange={(val) => setProjectScopeId(val === 'none' ? '' : val)}
                        options={[{ value: 'none', label: 'Any project' }, ...projects.map((p) => ({ value: p.id, label: p.name.toUpperCase() }))]}
                        className="bg-transparent border-none text-[10px] text-[#bbb] p-0 hover:bg-transparent hover:border-none focus:ring-0 w-full flex-1 h-6"
                      />
                    </div>
                  </div>
                  {/* Sort row */}
                  <div className="flex items-center gap-1">
                    <ArrowUpDown size={9} className="text-white/50 shrink-0" />
                    <span className="text-[9px] font-mono text-white/50 uppercase tracking-wider mr-1">Sort:</span>
                    {(['default', 'rating', 'bpm', 'energy'] as const).map((s) => (
                      <button key={s} onClick={() => setTrackSort(s)}
                        className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider transition-colors capitalize ${trackSort === s ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'}`}>
                        {s === 'default' ? 'Default' : s === 'rating' ? '⭐ Rating' : s === 'bpm' ? 'BPM' : '⚡ Energy'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 custom-scrollbar">
              {/* Similar Beats AI Suggestions Strip */}
              {mode === 'tracks' && baselineTrack && suggestedTracks.length > 0 && (
                <div className="mb-4 p-3 rounded-lg border border-[#7F77DD]/25 bg-[#100e1f]/90 backdrop-blur-md space-y-2 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[#AFA9EC]">
                      <Sparkles size={11} className="animate-pulse text-[#7F77DD]" />
                      <span className="text-[9px] font-bold uppercase tracking-widest font-akira">
                        AI SUGGESTIONS FOR {baselineTrack.title.toUpperCase()}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const idsToSelect = suggestedTracks.map((t) => t.id);
                        setSelectedTrackIds((prev) => Array.from(new Set([...prev, ...idsToSelect])));
                        toast.success(`Selected ${suggestedTracks.length} similar beats!`);
                      }}
                      className="text-[8px] font-panchang font-bold uppercase tracking-wider text-[#AFA9EC] hover:text-white px-2 py-0.5 border border-[#7F77DD]/35 hover:border-[#7F77DD] rounded transition-colors"
                    >
                      SELECT ALL
                    </button>
                  </div>
                  
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {suggestedTracks.map((t) => {
                      const selected = selectedTrackIds.includes(t.id);
                      return (
                        <div
                          key={t.id}
                          onClick={() => toggleTrack(t.id)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded border shrink-0 cursor-pointer transition-all ${
                            selected
                              ? 'bg-[#7F77DD]/20 border-[#7F77DD] text-[#AFA9EC]'
                              : 'bg-white/[0.02] border-white/[0.06] text-[#888] hover:text-[#e8e8e8] hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="w-5 h-5 bg-[#101010] rounded overflow-hidden shrink-0">
                            {t.cover_url ? (
                              <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[#444]"><Music size={8} /></div>
                            )}
                          </div>
                          <div className="text-left">
                            <p className="text-[10px] font-medium truncate max-w-[100px]">{t.title}</p>
                            <p className="text-[7px] font-mono uppercase tracking-wider text-[#555]">
                              {t.bpm ? `${t.bpm} BPM` : ''}{t.key ? ` · ${t.key}` : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-white/40" size={16} /></div>
              ) : mode === 'tracks' ? (
                filteredTracks.length === 0 ? (
                  <p className="text-[10px] text-white/40 text-center py-6">
                    {tagFilter || projectScopeId || searchQuery
                      ? 'No tracks match the current filters.'
                      : 'No tracks yet.'}
                  </p>
                ) : (
                  filteredTracks.map((track) => {
                    const selected = selectedTrackIds.includes(track.id);
                    const sentBefore = priorSentTrackIds?.has(track.id) ?? false;
                    const rating = track.rating ?? 0;
                    const energy = track.energy != null ? Math.round(track.energy * 100) : null;
                    const hasCover = !!track.cover_url;
                    return (
                      <div
                        key={track.id}
                        onClick={() => toggleTrack(track.id)}
                        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                          selected
                            ? 'bg-white/10 border-white/20'
                            : sentBefore
                              ? 'bg-[#1f1a10]/60 border-white/10 hover:bg-[#2A2010] hover:border-[#3a3010]'
                              : 'bg-transparent border-transparent hover:bg-white/[0.04] hover:border-white/10'
                        }`}
                      >
                        {/* Checkbox */}
                        <div className={`w-5 h-5 mt-0.5 rounded flex items-center justify-center border shrink-0 transition-colors ${
                          selected ? 'bg-white/20 border-white/40 text-white' : 'border-white/20'
                        }`}>
                          {selected && <Check size={11} className="text-white" />}
                        </div>
                        {/* Cover */}
                        <div className="w-9 h-9 bg-[#0E0E0E] rounded-lg border border-white/10 overflow-hidden shrink-0">
                          {hasCover
                            ? <img loading="lazy" src={track.cover_url!} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-white/40"><Music size={12} /></div>}
                        </div>
                        {/* Title + meta */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className={`text-[12px] font-medium truncate ${selected ? 'text-white' : 'text-white/90'}`}>{track.title}</p>
                            {sentBefore && (
                              <span className="shrink-0 text-[8px] font-mono uppercase tracking-wider text-white/80 bg-white/10 border border-white/20 px-1.5 py-0.5 rounded" title="Already sent to this contact">
                                Sent before
                              </span>
                            )}
                          </div>
                          <p className="text-[9px] font-mono text-white/60 uppercase tracking-wider">
                            {track.type}{track.bpm ? ` · ${track.bpm} bpm` : ''}{track.key ? ` · ${track.key}${track.scale === 'minor' ? 'm' : ''}` : ''}
                          </p>
                          {/* Quality signals */}
                          <div className="flex items-center gap-2 mt-1">
                            {/* Stars */}
                            {rating > 0 && (
                              <span className="flex items-center gap-0.5">
                                {[1,2,3,4,5].map((s) => (
                                  <Star key={s} size={9} fill={s <= rating ? '#FFFFFF' : 'none'} strokeWidth={1.5} className={s <= rating ? 'text-white' : 'text-white/30'} />
                                ))}
                              </span>
                            )}
                            {/* Energy bar */}
                            {energy != null && (
                              <span className="flex items-center gap-1">
                                <Zap size={9} className="text-white/50" />
                                <div className="w-10 h-1 bg-white/[0.05] rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-gradient-to-r from-white/40 to-white" style={{ width: `${energy}%` }} />
                                </div>
                                <span className="text-[8px] font-mono text-white/50">{energy}%</span>
                              </span>
                            )}
                            {!hasCover && <span className="text-[8px] font-mono text-white/40">no cover</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )
              ) : (
                filteredProjects.map((project) => {
                  const selected = selectedProjectId === project.id;
                  return (
                    <div
                      key={project.id}
                      onClick={() => setSelectedProjectId(selected ? null : project.id)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-md border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'bg-transparent border-transparent hover:bg-[#101010] text-white/80 hover:text-white'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        selected ? 'bg-white/20 border border-white/40' : 'bg-white/[0.05]'
                      }`}>
                        {selected && <Check size={11} className="text-white" />}
                      </div>
                      <div className="w-7 h-7 bg-[#0E0E0E] rounded border border-white/10 overflow-hidden shrink-0">
                        {project.cover_url
                          ? <img loading="lazy" src={project.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-white/40"><Disc3 size={11} /></div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium truncate">{project.name}</p>
                        <p className="text-[9px] font-mono text-white/60 uppercase tracking-wider">
                          {project.track_count != null ? `${project.track_count} tracks` : 'project'}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right — compose or preview */}
          <div className="flex-1 flex flex-col bg-[#090907]/40 min-h-0">
            {tab === 'compose' ? (
              <div className="flex flex-col flex-1 min-h-0 px-7 py-6 gap-5 overflow-y-auto custom-scrollbar">
                {/* Summary */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-2">Sending</p>
                  <div className="bg-[#0E0E0E] border border-white/10 rounded-xl p-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/[0.05] rounded-lg overflow-hidden shrink-0 border border-white/20">
                      {summary.cover
                        ? <img loading="lazy" src={summary.cover} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-white/40"><Music size={14} /></div>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-white truncate">{summary.title}</p>
                      <p className="text-[10px] font-mono text-white/60">{summary.countLabel}</p>
                    </div>
                  </div>
                </div>

                {/* Templates bar */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/50">Templates</span>
                  {templates.slice(0, 4).map((t) => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="px-2 py-1 rounded-md bg-[#0E0E0E] border border-white/10 text-[10px] text-white/80 hover:text-white hover:border-white/20 truncate max-w-[90px] transition-colors" title={t.name}>
                      {t.name}
                    </button>
                  ))}
                  {templates.length > 4 && (
                    <button onClick={() => setShowTemplates((v) => !v)}
                      className="px-2 py-1 rounded-md bg-[#0E0E0E] border border-white/10 text-[10px] text-white/60 hover:text-white/80">
                      +{templates.length - 4}
                    </button>
                  )}
                  <button onClick={saveTemplate} title="Save current as template"
                    className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-white/20 text-[10px] text-white/60 hover:text-white hover:border-white/40 transition-colors shrink-0">
                    <BookmarkPlus size={11} /> Save
                  </button>
                </div>

                {/* Full template list (expanded) */}
                {showTemplates && templates.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-[#090907] p-2 space-y-1">
                    {templates.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 group">
                        <button onClick={() => applyTemplate(t)} className="flex-1 text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
                          <p className="text-[12px] font-medium text-white">{t.name}</p>
                          {t.subject && <p className="text-[10px] text-white/60 truncate">{t.subject}</p>}
                        </button>
                        <button onClick={() => deleteTemplate(t.id)} className="p-1 text-white/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Subject + message stacked */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 bg-[#0E0E0E] border border-white/10 rounded-xl px-3.5 py-2 focus-within:border-white/40 transition-colors">
                    <Mail size={11} className="text-white/50 shrink-0" />
                    <input
                      type="text"
                      placeholder={resolvedSubject}
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="flex-1 bg-transparent text-[12px] text-white placeholder:text-white/40 focus:outline-none min-w-0"
                    />
                  </div>
                  <div className="relative bg-[#0E0E0E] border border-white/10 rounded-xl focus-within:border-white/40 transition-colors">
                    <MessageSquare size={11} className="absolute left-3.5 top-3.5 text-white/50 pointer-events-none" />
                    <textarea
                      placeholder={`Hey ${(recipients[0]?.name || '').split(' ')[0] || 'there'}, here's some new work…`}
                      className="w-full min-h-[110px] bg-transparent pl-9 pr-4 pt-3 pb-3 text-[12px] text-white placeholder:text-white/50 focus:outline-none resize-none leading-relaxed"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    {message.length > 0 && (
                      <span className="absolute bottom-2 right-3 text-[9px] font-mono text-white/40">{message.length}</span>
                    )}
                  </div>
                  {recipients.length > 1 && (
                    <p className="text-[9px] text-white/50 font-mono">
                      Tip: Same message for all recipients — use first names in your text.
                    </p>
                  )}
                </div>

                {/* Permissions */}
                <div className="grid grid-cols-2 gap-2">
                  {mode === 'project' && (
                    <div className="col-span-2">
                      <p className="text-[10px] text-white/70 uppercase tracking-wider mb-1.5">Role</p>
                      <div className="flex gap-1 bg-[#0E0E0E] border border-white/10 rounded-md p-0.5">
                        <SegBtn active={role === 'viewer'} onClick={() => setRole('viewer')} icon={<Eye size={10} />}>Viewer</SegBtn>
                        <SegBtn active={role === 'commenter'} onClick={() => setRole('commenter')} icon={<MessageSquare size={10} />}>Commenter</SegBtn>
                      </div>
                    </div>
                  )}

                  <ToggleRow
                    icon={<Download size={11} />} label="Downloads"
                    active={allowDownloads} onToggle={() => setAllowDownloads((v) => !v)}
                  />
                  <ToggleRow
                    icon={<Lock size={11} />} label="Password"
                    active={usePassword} onToggle={() => setUsePassword((v) => !v)}
                  />
                  {usePassword && (
                    <input
                      type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password" autoComplete="new-password"
                      className="col-span-2 bg-[#0E0E0E] border border-white/10 rounded-md px-3 py-2 text-[11px] text-white placeholder:text-white/50 focus:outline-none focus:border-white/40"
                    />
                  )}
                  <div className="col-span-2 flex items-center gap-2 bg-[#0E0E0E] border border-white/10 rounded-md px-3 py-2">
                    <Calendar size={11} className="text-white/70 shrink-0" />
                    <span className="text-[10px] text-white/80 uppercase tracking-wider">Expires</span>
                    <Dropdown
                      value={String(expiresDays)}
                      onChange={(val) => setExpiresDays(Number(val))}
                      options={[
                        { value: '7', label: '7 days' },
                        { value: '14', label: '14 days' },
                        { value: '30', label: '30 days' },
                        { value: '90', label: '90 days' },
                        { value: '0', label: 'Never' }
                      ]}
                      className="ml-auto bg-transparent border-none text-[11px] text-white p-0 hover:bg-transparent hover:border-none focus:ring-0 focus:ring-offset-0 h-6 shrink-0"
                    />
                  </div>
                  {campaigns.length > 0 && (
                    <div className="col-span-2 flex items-center gap-2 bg-[#0E0E0E] border border-white/10 rounded-md px-3 py-2">
                      <Zap size={11} className="text-white/70 shrink-0" />
                      <span className="text-[10px] text-white/80 uppercase tracking-wider">Campaign</span>
                      <Dropdown
                        value={campaignId}
                        onChange={setCampaignId}
                        options={[
                          { value: '', label: 'None' },
                          ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                        ]}
                        aria-label="Attach to campaign"
                        className="ml-auto bg-transparent border-none text-[11px] text-white p-0 hover:bg-transparent hover:border-none focus:ring-0 focus:ring-offset-0 h-6 shrink-0"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {/* Recipient selector — appears when sending to multiple */}
                {recipients.length > 1 && (
                  <div className="sticky top-0 z-10 px-4 py-2 border-b border-white/10 bg-white/[0.02] flex items-center gap-2">
                    <button disabled={validPreviewIdx === 0} onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
                      className="w-7 h-7 rounded flex items-center justify-center text-white/60 hover:text-white disabled:opacity-30 transition-colors">
                      <ChevronLeft size={14} />
                    </button>
                    <div className="flex-1 flex items-center justify-center gap-2">
                      {/* Avatar */}
                      {previewContact && (() => {
                        const p = previewPalette(previewContact.name);
                        return <div className={`w-8 h-8 rounded-full ${p.bg} flex items-center justify-center text-[12px] font-bold ${p.text} shrink-0`}>{previewContact.name[0]?.toUpperCase()}</div>;
                      })()}
                      <div className="text-left">
                        <p className="text-[12px] font-semibold text-white">{previewContact?.name}</p>
                        <p className="text-[10px] text-white/60">{previewContact?.email ?? 'no email'}</p>
                      </div>
                    </div>
                    <button disabled={validPreviewIdx >= recipients.length - 1} onClick={() => setPreviewIdx((i) => Math.min(recipients.length - 1, i + 1))}
                      className="w-7 h-7 rounded flex items-center justify-center text-white/60 hover:text-white disabled:opacity-30 transition-colors">
                      <ChevronRight size={14} />
                    </button>
                    <span className="text-[10px] font-mono text-white/40 w-14 text-right">{validPreviewIdx + 1} / {recipients.length}</span>
                  </div>
                )}

                <div className="p-4">
                  {/* Email client frame */}
                  <div className="rounded-xl overflow-hidden border border-white/20 bg-white/[0.04] shadow-xl">
                    {/* Header: From / To / Subject */}
                    <div className="px-4 py-3 border-b border-white/10 space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[9px] font-mono text-white/40 w-9 shrink-0 uppercase tracking-wider">From</span>
                        <span className="text-[11px] text-white/70">U2C Beatstore &lt;beats@uche.co&gt;</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-[9px] font-mono text-white/40 w-9 shrink-0 uppercase tracking-wider">To</span>
                        <div className="flex items-center gap-1.5">
                          {previewContact && (() => {
                            const p = previewPalette(previewContact.name);
                            return <div className={`w-5 h-5 rounded-full ${p.bg} flex items-center justify-center text-[9px] font-bold ${p.text} shrink-0`}>{previewContact.name[0]?.toUpperCase()}</div>;
                          })()}
                          <span className="text-[11px] font-medium text-white/80">
                            {previewRecipient}{previewContact?.email ? ` <${previewContact.email}>` : ''}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-[9px] font-mono text-white/40 w-9 shrink-0 uppercase tracking-wider">Subj</span>
                        <span className="text-[12px] font-semibold text-white truncate">{resolvedSubject}</span>
                      </div>
                    </div>
                    {/* Email body */}
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  </div>
                  <p className="text-[9px] font-mono text-white/40 text-center mt-3 uppercase tracking-wider">
                    {recipients.length > 1
                      ? `Showing personalised preview for ${previewRecipient.split(' ')[0]} · ${recipients.length} total recipients`
                      : `Exactly what ${previewRecipient.split(' ')[0]} will receive`}
                  </p>
                </div>
              </div>
            )}

            <div className="px-7 py-4 border-t border-white/10 bg-[#090907] flex items-center gap-3">
              {recipientsWithoutEmail.length > 0 && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-yellow-500/80 mr-auto">
                  ⚠ {recipientsWithoutEmail.length} no email · will skip
                </span>
              )}
              <LiquidGlassButton
                disabled={sending || !summary.valid || recipientsWithEmail === 0}
                onClick={handleSend}
                active
              >
                {sending ? (
                  <><Loader2 size={12} className="animate-spin" /> Sending…</>
                ) : (
                  <>
                    <Send size={12} />
                    Send to {recipientsWithEmail === 1
                      ? (recipients.find((r) => r.email)?.name || '').split(' ')[0]
                      : `${recipientsWithEmail} contact${recipientsWithEmail === 1 ? '' : 's'}`}
                  </>
                )}
              </LiquidGlassButton>
            </div>
          </div>
        </div>

        <style jsx>{`
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #222222; border-radius: 10px; }
        `}</style>
    </Modal>
  );
}

function SegBtn({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
        active
          ? 'bg-white/15 text-white shadow-sm'
          : 'text-white/60 hover:text-white'
      }`}
    >
      {icon}{children}
    </button>
  );
}

function ToggleRow({ icon, label, active, onToggle }: {
  icon: React.ReactNode; label: string; active: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-between px-3 py-2 rounded-md border transition-colors ${
        active ? 'bg-white/15 border-white/30 text-white shadow-sm' : 'bg-white/[0.03] border-white/10 text-white/70 hover:border-white/20'
      }`}
    >
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
        {icon}{label}
      </span>
      <span className={`text-[9px] font-mono uppercase tracking-wider ${active ? 'text-white' : 'text-white/50'}`}>
        {active ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

// buildPreview removed — the modal now uses buildBeatSendEmail from
// @/lib/email/beat-send-template, ensuring the preview exactly matches
// what Resend sends.
