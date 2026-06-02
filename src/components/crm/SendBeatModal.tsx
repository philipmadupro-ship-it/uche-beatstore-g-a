'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X, Send, Loader2, Search, Check, Music, Layers, Eye, Pencil,
  Lock, Calendar, MessageSquare, Download, Disc3, Tag as TagIcon, Users, Sparkles,
} from 'lucide-react';
import { Contact, Track } from '@/lib/types';
import { toast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';

interface Project {
  id: string;
  name: string;
  cover_url: string | null;
  description: string | null;
  track_count?: number;
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
export function SendBeatModal({ contact, contacts: contactsProp, initialTrackIds, onClose, onSuccess }: SendBeatModalProps) {
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
  const [role, setRole] = useState<ShareRole>('viewer');
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [expiresDays, setExpiresDays] = useState(30);
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);

  const [sending, setSending] = useState(false);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        // Parallel fetch — source toggle is then instant.
        const [tRes, pRes] = await Promise.all([
          fetch('/api/tracks'),
          fetch('/api/projects'),
        ]);
        const tData = await tRes.json();
        const pData = await pRes.json();
        if (aborted) return;
        setTracks(Array.isArray(tData) ? tData : tData.tracks || []);
        setProjects(pData.projects || []);
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
      
      const baselineTags = new Set(
        ((baselineTrack as any).track_tags ?? []).map((r: any) => r.tag)
      );
      const sharesTag = ((t as any).track_tags ?? []).some((r: any) => r.tag && baselineTags.has(r.tag));
      
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
    return pool;
  }, [tracks, projectScopeId, projectScopeTrackIds, tagFilter, searchQuery]);

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
                trackIds: selectedTrackIds,
                shareToken: shareData.token,
                message,
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

  // ── Preview body ─────────────────────────────────────────────────────
  const previewRecipient = recipients[0]?.name ?? 'Recipient';
  const previewHtml = useMemo(() => buildPreview({
    contactName: previewRecipient,
    summaryTitle: summary.title,
    summaryCount: summary.countLabel,
    cover: summary.cover,
    message: message.trim(),
    role: mode === 'project' ? role : 'viewer',
    allowDownloads,
    expiresDays,
    isProject: mode === 'project',
  }), [previewRecipient, summary, message, mode, role, allowDownloads, expiresDays]);

  const recipientsWithoutEmail = recipients.filter((r) => !r.email);
  const recipientsWithEmail = recipients.length - recipientsWithoutEmail.length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-4xl bg-[#16130e] border border-[#1f1a13] rounded-3xl shadow-2xl flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="px-8 py-5 border-b border-[#1f1a13] flex justify-between items-center bg-[#0a0907]">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-10 h-10 bg-[#2A2418] rounded-xl flex items-center justify-center text-[#D4BFA0] shrink-0">
              {recipients.length > 1 ? <Users size={18} /> : <Send size={18} />}
            </div>
            <div className="min-w-0">
              <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#E8DCC8]">
                {recipients.length > 1 ? `Send to ${recipients.length} contacts` : 'Send to contact'}
              </h2>
              <p className="text-[10px] text-[#6a5d4a] font-mono uppercase tracking-widest mt-1">
                {recipients.length === 1
                  ? `${recipients[0].name}${recipients[0].email ? ` · ${recipients[0].email}` : ''}`
                  : `${recipientsWithEmail}/${recipients.length} have email`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#4a4338] hover:text-[#E8DCC8] transition-colors p-2 shrink-0">
            <X size={22} />
          </button>
        </div>

        {/* Recipients — chips + an "add email" input so you can send to people
            not yet in the CRM. New emails are find-or-created as contacts on send. */}
        <div className="px-8 py-3 border-b border-[#1f1a13] bg-[#0a0907]/40 flex flex-wrap items-center gap-1.5">
          {recipients.map((r) => {
            const isAdhoc = r.id.startsWith('adhoc:');
            return (
              <span
                key={r.id}
                className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${
                  isAdhoc
                    ? 'bg-[#1a1833] border-[#534AB7]/40 text-[#AFA9EC]'
                    : r.email
                      ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]'
                      : 'bg-[#1a160f] border-[#1f1a13] text-yellow-500/70'
                }`}
                title={r.email || 'No email on file'}
              >
                {isAdhoc ? r.email : r.name}
                {isAdhoc && <span className="text-[7px] opacity-70">NEW</span>}
                {!isAdhoc && !r.email && <span className="text-[8px]">⚠</span>}
                <button onClick={() => removeRecipient(r.id)} className="text-[#6a5d4a] hover:text-red-400 -mr-0.5" title="Remove from this send">
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
              className="w-40 bg-[#0e0c08] border border-[#1f1a13] rounded px-2.5 py-1 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#534AB7]/60"
            />
            {adhocEmail.trim() && (
              <button onClick={addAdhocEmail} className="text-[10px] font-mono uppercase tracking-wider text-[#AFA9EC] hover:text-white px-1.5 py-1 rounded transition-colors">
                + Add
              </button>
            )}
          </span>
        </div>

        {/* Mode + tab segmented controls */}
        <div className="px-8 py-3 border-b border-[#1f1a13] flex items-center gap-4 bg-[#0a0907]/40">
          <div className="flex items-center gap-1 bg-[#0a0907] border border-[#1a160f] rounded-md p-0.5">
            <SegBtn active={mode === 'tracks'} onClick={() => setMode('tracks')} icon={<Music size={11} />}>
              Tracks
            </SegBtn>
            <SegBtn active={mode === 'project'} onClick={() => setMode('project')} icon={<Layers size={11} />}>
              Project
            </SegBtn>
          </div>

          <div className="flex items-center gap-1 bg-[#0a0907] border border-[#1a160f] rounded-md p-0.5 ml-auto">
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
          <div className="w-5/12 border-r border-[#1f1a13] flex flex-col">
            <div className="px-6 pt-4 pb-3 border-b border-[#1f1a13] space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" size={12} />
                <input
                  type="text"
                  placeholder={mode === 'tracks' ? 'Search tracks…' : 'Search projects…'}
                  className="w-full bg-[#0a0907] border border-[#1a160f] rounded-md py-2 pl-9 pr-3 text-[11px] text-[#E8DCC8] placeholder:text-[#4a4338] focus:outline-none focus:border-[#D4BFA0]/40"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Tag + project filters — tracks mode only */}
              {mode === 'tracks' && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-[#0a0907] border border-[#1a160f] rounded-md px-2 py-1 flex-1 min-w-0">
                    <TagIcon size={10} className="text-[#5a5142] shrink-0" />
                    <Dropdown
                      value={tagFilter || 'none'}
                      onChange={(val) => setTagFilter(val === 'none' ? '' : val)}
                      disabled={allTags.length === 0}
                      options={[
                        { value: 'none', label: allTags.length === 0 ? 'No tags' : 'Any tag' },
                        ...allTags.map((t) => ({ value: t, label: t.toUpperCase() }))
                      ]}
                      className="bg-transparent border-none text-[10px] text-[#bbb] p-0 hover:bg-transparent hover:border-none focus:ring-0 focus:ring-offset-0 w-full flex-1 h-6"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 bg-[#0a0907] border border-[#1a160f] rounded-md px-2 py-1 flex-1 min-w-0">
                    <Layers size={10} className="text-[#5a5142] shrink-0" />
                    <Dropdown
                      value={projectScopeId || 'none'}
                      onChange={(val) => setProjectScopeId(val === 'none' ? '' : val)}
                      options={[
                        { value: 'none', label: 'Any project' },
                        ...projects.map((p) => ({ value: p.id, label: p.name.toUpperCase() }))
                      ]}
                      className="bg-transparent border-none text-[10px] text-[#bbb] p-0 hover:bg-transparent hover:border-none focus:ring-0 focus:ring-offset-0 w-full flex-1 h-6"
                    />
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
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#4a4338]" size={16} /></div>
              ) : mode === 'tracks' ? (
                filteredTracks.length === 0 ? (
                  <p className="text-[10px] text-[#5a5142] text-center py-6">
                    {tagFilter || projectScopeId || searchQuery
                      ? 'No tracks match the current filters.'
                      : 'No tracks yet.'}
                  </p>
                ) : (
                  filteredTracks.map((track) => {
                    const selected = selectedTrackIds.includes(track.id);
                    return (
                      <div
                        key={track.id}
                        onClick={() => toggleTrack(track.id)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-md border cursor-pointer transition-colors ${
                          selected
                            ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]'
                            : 'bg-transparent border-transparent hover:bg-[#101010] text-[#a08a6a] hover:text-[#E8DCC8]'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center border shrink-0 ${
                          selected ? 'bg-[#D4BFA0] border-[#D4BFA0]' : 'border-[#2d2620]'
                        }`}>
                          {selected && <Check size={11} className="text-white" />}
                        </div>
                        <div className="w-7 h-7 bg-[#16130e] rounded border border-[#1a160f] overflow-hidden shrink-0">
                          {track.cover_url
                            ? <img loading="lazy" src={track.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={11} /></div>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium truncate">{track.title}</p>
                          <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider truncate">
                            {track.type}{track.bpm ? ` · ${track.bpm}` : ''}{track.key ? ` · ${track.key}` : ''}
                          </p>
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
                          ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]'
                          : 'bg-transparent border-transparent hover:bg-[#101010] text-[#a08a6a] hover:text-[#E8DCC8]'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        selected ? 'bg-[#D4BFA0]' : 'bg-[#1a160f]'
                      }`}>
                        {selected && <Check size={11} className="text-white" />}
                      </div>
                      <div className="w-7 h-7 bg-[#16130e] rounded border border-[#1a160f] overflow-hidden shrink-0">
                        {project.cover_url
                          ? <img loading="lazy" src={project.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Disc3 size={11} /></div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium truncate">{project.name}</p>
                        <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider">
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
          <div className="flex-1 flex flex-col bg-[#0a0907]/40 min-h-0">
            {tab === 'compose' ? (
              <div className="flex flex-col flex-1 min-h-0 px-7 py-6 gap-5 overflow-y-auto custom-scrollbar">
                {/* Summary */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#6a5d4a] mb-2">Sending</p>
                  <div className="bg-[#16130e] border border-[#1f1a13] rounded-xl p-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#1a160f] rounded-lg overflow-hidden shrink-0 border border-[#2d2620]">
                      {summary.cover
                        ? <img loading="lazy" src={summary.cover} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={14} /></div>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-white truncate">{summary.title}</p>
                      <p className="text-[10px] font-mono text-[#5a5142]">{summary.countLabel}</p>
                    </div>
                  </div>
                </div>

                {/* Personal message */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#6a5d4a] mb-2 flex items-center gap-1.5">
                    <MessageSquare size={10} /> Personal message
                  </p>
                  <textarea
                    placeholder={`Hey ${(recipients[0]?.name || '').split(' ')[0] || 'there'}, here's some new work…`}
                    className="flex-1 min-h-[120px] bg-[#16130e] border border-[#1f1a13] rounded-xl p-4 text-[12px] text-[#E8DCC8] placeholder:text-[#4a4338] focus:outline-none focus:border-[#D4BFA0]/40 resize-none leading-relaxed"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  {recipients.length > 1 && (
                    <p className="text-[9px] text-[#5a5142] mt-2">
                      Same message goes out to every recipient — substitute their name with “Hey there” if you’re bulk-sending.
                    </p>
                  )}
                </div>

                {/* Permissions */}
                <div className="grid grid-cols-2 gap-2">
                  {mode === 'project' && (
                    <div className="col-span-2">
                      <p className="text-[10px] text-[#6a5d4a] uppercase tracking-wider mb-1.5">Role</p>
                      <div className="flex gap-1 bg-[#16130e] border border-[#1f1a13] rounded-md p-0.5">
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
                      className="col-span-2 bg-[#16130e] border border-[#1f1a13] rounded-md px-3 py-2 text-[11px] text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#D4BFA0]/40"
                    />
                  )}
                  <div className="col-span-2 flex items-center gap-2 bg-[#16130e] border border-[#1f1a13] rounded-md px-3 py-2">
                    <Calendar size={11} className="text-[#6a5d4a] shrink-0" />
                    <span className="text-[10px] text-[#a08a6a] uppercase tracking-wider">Expires</span>
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
                      className="ml-auto bg-transparent border-none text-[11px] text-[#E8DCC8] p-0 hover:bg-transparent hover:border-none focus:ring-0 focus:ring-offset-0 h-6 shrink-0"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#6a5d4a] mb-3">
                  Email preview · {recipients.length > 1
                    ? `each of ${recipients.length} recipients sees their own copy`
                    : `what ${previewRecipient.split(' ')[0]} will see`}
                </p>
                <div
                  className="bg-white text-black rounded-xl overflow-hidden border border-[#1f1a13]"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            )}

            <div className="px-7 py-4 border-t border-[#1f1a13] bg-[#0a0907] flex items-center gap-3">
              {recipientsWithoutEmail.length > 0 && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-yellow-500/80 mr-auto">
                  ⚠ {recipientsWithoutEmail.length} no email · will skip
                </span>
              )}
              <button
                disabled={sending || !summary.valid || recipientsWithEmail === 0}
                onClick={handleSend}
                className="ml-auto bg-[#D4BFA0] hover:bg-[#8A7A5C] disabled:bg-[#1a160f] disabled:text-[#4a4338] text-white py-2.5 px-6 rounded-md text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-colors"
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
              </button>
            </div>
          </div>
        </div>

        <style jsx>{`
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #1f1a13; border-radius: 10px; }
        `}</style>
      </div>
    </div>
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
          ? 'bg-[#2A2418] text-[#E8D8B8]'
          : 'text-[#6a5d4a] hover:text-white'
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
        active ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]' : 'bg-[#16130e] border-[#1f1a13] text-[#a08a6a] hover:border-[#2d2620]'
      }`}
    >
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
        {icon}{label}
      </span>
      <span className={`text-[9px] font-mono uppercase tracking-wider ${active ? 'text-[#E8D8B8]' : 'text-[#5a5142]'}`}>
        {active ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

function buildPreview(opts: {
  contactName: string;
  summaryTitle: string;
  summaryCount: string;
  cover: string | null;
  message: string;
  role: ShareRole;
  allowDownloads: boolean;
  expiresDays: number;
  isProject: boolean;
}): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
  const safeMessage = escape(opts.message).replace(/\n/g, '<br>');
  const safeName = escape(opts.contactName.split(' ')[0]);
  const safeTitle = escape(opts.summaryTitle);
  const expiresLine = opts.expiresDays > 0
    ? `<p style="font-size:11px;color:#a08a6a;margin:10px 0 0;">Link expires in ${opts.expiresDays} days.</p>`
    : '';
  const roleBadge = opts.isProject
    ? `<span style="display:inline-block;background:#ede9fe;color:#6d52e6;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;margin-right:6px;">${opts.role}</span>`
    : '';
  const downloads = opts.allowDownloads
    ? '<span style="color:#6d52e6;font-weight:600;">Downloads enabled</span>'
    : '<span style="color:#a08a6a;">Downloads off</span>';

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;padding:32px 24px;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #ececec;border-radius:14px;overflow:hidden;">
      ${opts.cover ? `<img loading="lazy" src="${escape(opts.cover)}" alt="" style="width:100%;display:block;max-height:240px;object-fit:cover;">` : ''}
      <div style="padding:28px 28px 24px;">
        <p style="font-size:11px;color:#6d52e6;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 8px;font-weight:700;">${opts.isProject ? 'Project share' : 'New music'}</p>
        <h1 style="font-size:22px;font-weight:600;color:#14110d;margin:0 0 6px;">${safeTitle}</h1>
        <p style="font-size:13px;color:#6a5d4a;margin:0 0 18px;">
          ${roleBadge}${escape(opts.summaryCount)} · ${downloads}
        </p>
        <p style="font-size:14px;color:#3a3328;line-height:1.6;margin:0 0 18px;">Hey ${safeName},</p>
        ${safeMessage
          ? `<div style="font-size:14px;color:#3a3328;line-height:1.6;background:#fafafa;border-left:3px solid #6d52e6;padding:14px 16px;border-radius:6px;margin:0 0 22px;">${safeMessage}</div>`
          : '<p style="font-size:13px;color:#b89e7a;margin:0 0 22px;font-style:italic;">No personal message — recipient will see only the link.</p>'}
        <a href="#" style="display:inline-block;background:#6d52e6;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;">Open ${opts.isProject ? 'project' : 'pack'}</a>
        ${expiresLine}
      </div>
    </div>
    <p style="text-align:center;font-size:10px;color:#b89e7a;text-transform:uppercase;letter-spacing:0.3em;margin-top:20px;">Sent via U2C Beatstore</p>
  </div>`;
}
