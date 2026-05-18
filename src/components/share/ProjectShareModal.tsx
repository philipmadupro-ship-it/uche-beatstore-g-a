'use client';

import {
  X, Lock, Link2, Download, Calendar, Check, Copy, Loader2,
  Eye, MessageSquare, Edit3, Mail, Trash2, Send, ShoppingBag,
} from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useEffect, useState } from 'react';
import { copyToClipboard } from '@/lib/clipboard';
import { toast, confirmToast } from '@/hooks/useToast';

interface ProjectShare {
  id: string;
  token: string;
  role: 'viewer' | 'commenter' | 'editor';
  allow_downloads: boolean;
  expires_at: string | null;
  invited_email: string | null;
  label: string | null;
  plays: number;
  created_at: string;
  revoked_at?: string | null;
}

interface Props {
  projectId: string;
  projectTitle: string;
  coverUrl?: string | null;
  onClose: () => void;
}

const ROLE_INFO: Record<ProjectShare['role'], { label: string; help: string; icon: React.ComponentType<{ size?: number }> }> = {
  viewer:    { label: 'Viewer',    help: 'Can stream tracks',                            icon: Eye },
  commenter: { label: 'Commenter', help: 'Can stream + leave comments',                  icon: MessageSquare },
  editor:    { label: 'Editor',    help: 'Reserved — same as commenter for now',         icon: Edit3 },
};

export function ProjectShareModal({ projectId, projectTitle, coverUrl, onClose }: Props) {
  // ── create-form state ────────────────────────────────────────────────
  const [role, setRole] = useState<ProjectShare['role']>('viewer');
  // Audience tag — drives the share page layout. Independent of role
  // (a "client" can still be a viewer; a "producer" can be a
  // commenter, etc). Default 'client' matches what most existing
  // shares look like in practice.
  const [recipientKind, setRecipientKind] = useState<'client' | 'producer' | 'rapper' | 'friend'>('client');
  // When true, the share page's license card renders Buy Lease /
  // Buy Exclusive buttons that route to Stripe Checkout. Defaults
  // OFF so a casual "check this out" send doesn't accidentally
  // become a storefront. Only meaningful for the `client` audience
  // (the other variants don't render a license card).
  const [salesEnabled, setSalesEnabled] = useState(false);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [passwordProtect, setPasswordProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [expiryEnabled, setExpiryEnabled] = useState(false);
  const [expiryDays, setExpiryDays] = useState(7);
  const [invitedEmail, setInvitedEmail] = useState('');
  const [label, setLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── existing-shares list ────────────────────────────────────────────
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);

  const fetchShares = async () => {
    setLoadingShares(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/shares`);
      const data = await res.json();
      if (res.ok) setShares(data.shares ?? []);
    } catch {
      // Silent — empty list is the right fallback.
    } finally {
      setLoadingShares(false);
    }
  };

  useEffect(() => { fetchShares(); }, [projectId]);

  // ── actions ─────────────────────────────────────────────────────────
  const generateLink = async () => {
    setGenerating(true);
    setGeneratedUrl(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          recipient_kind: recipientKind,
          sales_enabled: salesEnabled,
          allow_downloads: allowDownloads,
          password: passwordProtect && password ? password : null,
          expires_days: expiryEnabled ? expiryDays : 0,
          invited_email: invitedEmail.trim() || null,
          label: label.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setGeneratedUrl(data.url);
      // Reset password input so the next link doesn't accidentally reuse it.
      setPassword('');
      fetchShares();
    } catch (err: any) {
      toast.error('Couldn’t create share link', err?.message);
    } finally {
      setGenerating(false);
    }
  };

  const doCopy = async (url: string) => {
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const revokeShare = async (s: ProjectShare) => {
    const ok = await confirmToast(
      'Revoke this share link?',
      'The recipient will lose access immediately and any open tabs will stop working on the next reload.',
      { confirmLabel: 'Revoke', cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/shares/${s.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      toast.success('Share revoked');
      fetchShares();
    } catch (err: any) {
      toast.error('Revoke failed', err?.message);
    }
  };

  const sendInvite = async (s: ProjectShare) => {
    const recipient = s.invited_email?.trim();
    if (!recipient) {
      toast.error('No recipient set', 'Add an email to this share before sending an invite.');
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/shares/${s.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recipient }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Invite failed', data.error || `HTTP ${res.status}`);
        return;
      }
      toast.success('Invite sent', `Email queued for ${recipient}`);
    } catch (err: any) {
      toast.error('Invite failed', err?.message);
    }
  };

  const toggleDownloads = async (s: ProjectShare) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/shares/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_downloads: !s.allow_downloads }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      fetchShares();
    } catch (err: any) {
      toast.error('Update failed', err?.message);
    }
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] max-h-[90vh] flex flex-col rounded-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-500 bg-gradient-to-b from-[#121214]/95 via-[#0e0e10]/95 to-[#0a0907]/98 backdrop-blur-2xl border border-white/[0.06] shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)_inset]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — radial accent wash in the corner (same treatment as
            the TrackDetailsDrawer header) so the modal reads as a
            lifted, lit surface rather than a flat card. */}
        <div className="relative p-6 border-b border-white/[0.04] overflow-hidden">
          <div
            className="absolute -top-16 -left-16 w-44 h-44 rounded-full pointer-events-none opacity-25"
            style={{ background: 'radial-gradient(circle, #D4BFA0 0%, transparent 70%)' }}
          />
          <div className="relative z-10 flex items-start gap-4">
            <div className="w-14 h-14 bg-[#1a160f] rounded-xl overflow-hidden shrink-0 border border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
              {coverUrl ? (
                <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#4a4338] font-black text-xl uppercase bg-gradient-to-br from-[#2A2418] to-[#0a0907]">
                  {projectTitle.charAt(0)}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-[#E8D8B8] uppercase tracking-[0.2em] mb-1">Share project</p>
              <h2 className="text-[18px] font-medium text-white truncate">{projectTitle}</h2>
              <p className="text-[11px] text-[#6a5d4a] mt-1">
                Create a link with a specific permission level. Each recipient can get their own.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-colors backdrop-blur-sm"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Create-form */}
          <div className="p-6 border-b border-[#1f1a13] space-y-5">
            <p className="text-[10px] font-bold text-[#a08a6a] uppercase tracking-[0.2em]">New link</p>

            {/* Audience picker — drives the layout of the share page.
                Independent of permission: a client can still be a
                viewer-only, a producer can still be a commenter.
                Defaults to "client" because that's the most common
                pitch send and matches the historical layout. */}
            <div>
              <p className="text-[10px] text-[#6a5d4a] uppercase tracking-wider mb-2">Audience</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  { key: 'client',   label: 'Client / A&R',  help: 'Bio + curated tracks + license card' },
                  { key: 'producer', label: 'Producer',      help: 'Stems + full metadata' },
                  { key: 'rapper',   label: 'Rapper',        help: 'Vocal-friendly preview' },
                  { key: 'friend',   label: 'Friend',        help: 'Minimal, just play' },
                ] as const).map((k) => {
                  const active = recipientKind === k.key;
                  return (
                    <button
                      key={k.key}
                      onClick={() => setRecipientKind(k.key)}
                      className={`flex flex-col gap-1 px-3 py-3 rounded-lg border text-left transition-all ${
                        active
                          ? 'bg-[#2A2418] border-[#8A7A5C] text-[#E8D8B8]'
                          : 'bg-[#0a0907] border-[#1a160f] text-[#a08a6a] hover:border-[#2d2620]'
                      }`}
                    >
                      <span className="text-[11px] font-medium">{k.label}</span>
                      <span className="text-[9px] text-[#5a5142] leading-tight">{k.help}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Role picker */}
            <div>
              <p className="text-[10px] text-[#6a5d4a] uppercase tracking-wider mb-2">Permission</p>
              <div className="grid grid-cols-3 gap-2">
                {(['viewer', 'commenter', 'editor'] as const).map((r) => {
                  const Icon = ROLE_INFO[r].icon;
                  const active = role === r;
                  return (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className={`flex flex-col gap-1 px-3 py-3 rounded-lg border text-left transition-all ${
                        active
                          ? 'bg-[#2A2418] border-[#8A7A5C] text-[#E8D8B8]'
                          : 'bg-[#0a0907] border-[#1a160f] text-[#a08a6a] hover:border-[#2d2620]'
                      }`}
                    >
                      <Icon size={13} />
                      <span className="text-[11px] font-medium">{ROLE_INFO[r].label}</span>
                      <span className="text-[9px] text-[#5a5142] leading-tight">{ROLE_INFO[r].help}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              <ToggleRow
                icon={<Download size={12} />}
                label="Allow downloads"
                active={allowDownloads}
                onToggle={() => setAllowDownloads((v) => !v)}
              />
              {/* For sale — only relevant on the Client variant
                  since it owns the license card. Hiding the toggle
                  for the other audiences keeps the modal honest
                  (no UI control without an effect). */}
              {recipientKind === 'client' && (
                <ToggleRow
                  icon={<ShoppingBag size={12} />}
                  label="For sale (enables Stripe checkout)"
                  active={salesEnabled}
                  onToggle={() => setSalesEnabled((v) => !v)}
                />
              )}
              <ToggleRow
                icon={<Lock size={12} />}
                label="Password protect"
                active={passwordProtect}
                onToggle={() => setPasswordProtect((v) => !v)}
              />
              {passwordProtect && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full bg-[#0a0907] border border-[#1a160f] rounded-md px-3 py-2 text-[12px] text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#8A7A5C]"
                />
              )}
              <ToggleRow
                icon={<Calendar size={12} />}
                label="Expires"
                active={expiryEnabled}
                onToggle={() => setExpiryEnabled((v) => !v)}
              />
              {expiryEnabled && (
                <Dropdown
                  value={String(expiryDays)}
                  onChange={(val) => setExpiryDays(Number(val))}
                  options={[
                    { value: '1', label: '1 day' },
                    { value: '3', label: '3 days' },
                    { value: '7', label: '7 days' },
                    { value: '14', label: '14 days' },
                    { value: '30', label: '30 days' }
                  ]}
                  className="w-full bg-[#0a0907] border border-[#1a160f] rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8A7A5C]"
                />
              )}
            </div>

            {/* Optional metadata */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-[#6a5d4a] uppercase tracking-wider mb-1">Recipient (label)</p>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Label A&R"
                  className="w-full bg-[#0a0907] border border-[#1a160f] rounded-md px-3 py-2 text-[11px] text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#8A7A5C]"
                />
              </div>
              <div>
                <p className="text-[10px] text-[#6a5d4a] uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Mail size={9} /> Email (optional)
                </p>
                <input
                  type="email"
                  value={invitedEmail}
                  onChange={(e) => setInvitedEmail(e.target.value)}
                  placeholder="them@example.com"
                  className="w-full bg-[#0a0907] border border-[#1a160f] rounded-md px-3 py-2 text-[11px] text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#8A7A5C]"
                />
              </div>
            </div>

            {/* Generate / show URL — generated state shows a glass link
                card with side-by-side Copy + Share pills (matches the
                brief). Pre-generate the CTA is a single full-width pill. */}
            {generatedUrl ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 bg-white/[0.02] border border-[#8A7A5C]/30 rounded-xl px-3 py-2.5 backdrop-blur-sm">
                  <Link2 size={12} className="text-[#E8D8B8] shrink-0" />
                  <input
                    readOnly
                    value={generatedUrl}
                    className="flex-1 bg-transparent text-[11px] text-[#E8DCC8] font-mono focus:outline-none truncate"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => doCopy(generatedUrl)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white text-black text-[12px] font-medium hover:bg-[#E8DCC8] active:scale-[0.98] transition-all"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    onClick={() => setGeneratedUrl(null)}
                    className="px-4 py-3 rounded-full bg-white/[0.04] border border-white/[0.06] text-[#E8DCC8] text-[12px] font-medium hover:bg-white/[0.08] hover:border-white/[0.12] transition-colors"
                  >
                    Create another
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={generateLink}
                disabled={generating}
                className="w-full bg-white hover:bg-[#E8DCC8] disabled:opacity-40 text-black text-[12px] font-medium py-3 rounded-full transition-all active:scale-[0.99] flex items-center justify-center gap-2"
              >
                {generating ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                Generate link
              </button>
            )}
          </div>

          {/* Existing shares */}
          <div className="p-6">
            <p className="text-[10px] font-bold text-[#a08a6a] uppercase tracking-[0.2em] mb-3">
              Active links {shares.length > 0 && <span className="text-[#5a5142]">({shares.length})</span>}
            </p>
            {loadingShares ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={14} className="animate-spin text-[#4a4338]" />
              </div>
            ) : shares.length === 0 ? (
              <p className="text-[11px] text-[#5a5142] py-3">No shares yet — generate one above.</p>
            ) : (
              <div className="space-y-2">
                {shares.map((s) => {
                  const Icon = ROLE_INFO[s.role].icon;
                  const APP_URL = typeof window !== 'undefined' ? window.location.origin : '';
                  const url = `${APP_URL}/projects/share/${s.token}`;
                  const expired = s.expires_at && new Date(s.expires_at).getTime() < Date.now();
                  const revoked = Boolean(s.revoked_at);
                  return (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-3 px-3 py-2.5 rounded-md border ${
                        revoked || expired ? 'bg-[#0a0907] border-[#161616] opacity-50' : 'bg-[#0a0907] border-[#1a160f] hover:border-[#2d2620]'
                      } transition-all`}
                    >
                      <div className="w-7 h-7 rounded bg-[#2A2418] border border-[#8A7A5C]/30 flex items-center justify-center shrink-0">
                        <Icon size={11} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-[#E8DCC8] truncate">
                            {s.label || s.invited_email || 'Untitled link'}
                          </span>
                          <span className="text-[8px] font-bold text-[#E8D8B8] bg-[#2A2418] border border-[#8A7A5C]/40 rounded px-1.5 py-0.5 uppercase">
                            {ROLE_INFO[s.role].label}
                          </span>
                          {revoked && <span className="text-[8px] text-red-400 uppercase">Revoked</span>}
                          {expired && !revoked && <span className="text-[8px] text-yellow-500 uppercase">Expired</span>}
                        </div>
                        <p className="text-[9px] font-mono text-[#5a5142] mt-0.5 truncate">
                          {s.plays} {s.plays === 1 ? 'play' : 'plays'} · created {fmtDate(s.created_at)}
                          {s.expires_at ? ` · expires ${fmtDate(s.expires_at)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => doCopy(url)}
                          className="p-1.5 rounded text-[#6a5d4a] hover:text-white hover:bg-[#1a160f]"
                          title="Copy link"
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          onClick={() => toggleDownloads(s)}
                          className={`p-1.5 rounded hover:bg-[#1a160f] transition-colors ${s.allow_downloads ? 'text-[#D4BFA0]' : 'text-[#4a4338]'}`}
                          title={s.allow_downloads ? 'Downloads allowed — click to disable' : 'Downloads disabled — click to enable'}
                        >
                          <Download size={11} />
                        </button>
                        {s.invited_email && !revoked && (
                          <button
                            onClick={() => sendInvite(s)}
                            className="p-1.5 rounded text-[#6a5d4a] hover:text-[#D4BFA0] hover:bg-[#1a160f]"
                            title={`Email this link to ${s.invited_email}`}
                          >
                            <Send size={11} />
                          </button>
                        )}
                        {!revoked && (
                          <button
                            onClick={() => revokeShare(s)}
                            className="p-1.5 rounded text-[#6a5d4a] hover:text-red-400 hover:bg-[#1a160f]"
                            title="Revoke link"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ icon, label, active, onToggle }: { icon: React.ReactNode; label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-md border transition-colors ${
        active ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]' : 'bg-[#0a0907] border-[#1a160f] text-[#a08a6a] hover:border-[#2d2620]'
      }`}
    >
      <span className="flex items-center gap-2 text-[11px] font-medium">
        {icon}
        {label}
      </span>
      <span className={`text-[9px] font-mono uppercase tracking-wider ${active ? 'text-[#E8D8B8]' : 'text-[#5a5142]'}`}>
        {active ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
