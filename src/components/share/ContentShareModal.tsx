'use client';

import {
  X, Lock, Link2, Download, Calendar, Check, Copy, Loader2,
  Eye, MessageSquare, Edit3, Mail, Trash2, Send, ShoppingBag,
} from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useEffect, useState } from 'react';
import { copyToClipboard } from '@/lib/clipboard';
import { toast, confirmToast } from '@/hooks/useToast';

interface ContentShare {
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
  contentType: 'project' | 'playlist' | 'track';
  contentId: string;
  contentTitle: string;
  coverUrl?: string | null;
  onClose: () => void;
}

const ROLE_INFO: Record<ContentShare['role'], { label: string; help: string; icon: React.ComponentType<{ size?: number }> }> = {
  viewer:    { label: 'Viewer',    help: 'Can stream tracks',               icon: Eye },
  commenter: { label: 'Commenter', help: 'Can stream + leave comments',     icon: MessageSquare },
  editor:    { label: 'Editor',    help: 'Reserved — same as commenter',    icon: Edit3 },
};

function apiBase(contentType: 'project' | 'playlist' | 'track', contentId: string) {
  if (contentType === 'project') return `/api/projects/${contentId}/shares`;
  if (contentType === 'playlist') return `/api/playlists/${contentId}/shares`;
  return `/api/tracks/${contentId}/shares`;
}

const CONTENT_LABELS: Record<Props['contentType'], string> = {
  project: 'Share project',
  playlist: 'Share playlist',
  track: 'Share track',
};

export function ContentShareModal({ contentType, contentId, contentTitle, coverUrl, onClose }: Props) {
  const [role, setRole] = useState<ContentShare['role']>('viewer');
  const [recipientKind, setRecipientKind] = useState<'client' | 'producer' | 'rapper' | 'friend'>('client');
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

  const [shares, setShares] = useState<ContentShare[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);

  const fetchShares = async () => {
    setLoadingShares(true);
    try {
      const res = await fetch(apiBase(contentType, contentId));
      const data = await res.json();
      if (res.ok) setShares(data.shares ?? []);
    } catch {
      // Silent — empty list is the right fallback.
    } finally {
      setLoadingShares(false);
    }
  };

  useEffect(() => { fetchShares(); }, [contentId, contentType]);

  const generateLink = async () => {
    setGenerating(true);
    setGeneratedUrl(null);
    try {
      const res = await fetch(apiBase(contentType, contentId), {
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

  const revokeShare = async (s: ContentShare) => {
    const ok = await confirmToast(
      'Revoke this share link?',
      'The recipient will lose access immediately and any open tabs will stop working on the next reload.',
      { confirmLabel: 'Revoke', cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/shares/${s.id}`, { method: 'DELETE' });
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

  const sendInvite = async (s: ContentShare) => {
    const recipient = s.invited_email?.trim();
    if (!recipient) {
      toast.error('No recipient set', 'Add an email to this share before sending an invite.');
      return;
    }
    try {
      const res = await fetch(`/api/projects/${contentId}/shares/${s.id}/invite`, {
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

  const toggleDownloads = async (s: ContentShare) => {
    try {
      const res = await fetch(`/api/shares/${s.id}`, {
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
        className="w-full max-w-[640px] max-h-[90vh] flex flex-col rounded-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-500 bg-gradient-to-b from-[#121214]/95 via-[#0e0e10]/95 to-[#090907]/98 backdrop-blur-2xl border border-white/[0.06] shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)_inset]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative p-6 border-b border-white/[0.04] overflow-hidden">
          <div
            className="absolute -top-16 -left-16 w-44 h-44 rounded-full pointer-events-none opacity-25"
            style={{ background: 'radial-gradient(circle, #E7D7BE 0%, transparent 70%)' }}
          />
          <div className="relative z-10 flex items-start gap-4">
            <div className="w-14 h-14 bg-[#211F1A] rounded-xl overflow-hidden shrink-0 border border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
              {coverUrl ? (
                <img loading="lazy" src={coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#837B6D] font-black text-xl uppercase bg-gradient-to-br from-[#342F27] to-[#090907]">
                  {contentTitle.charAt(0)}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-[#F3E6D1] uppercase tracking-[0.2em] mb-1">{CONTENT_LABELS[contentType]}</p>
              <h2 className="text-[18px] font-medium text-white truncate">{contentTitle}</h2>
              <p className="text-[11px] text-[#B4AA99] mt-1">
                Create a link with a specific permission level. Each recipient can get their own.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#B4AA99] hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-colors backdrop-blur-sm"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-6 border-b border-[#2B2821] space-y-5">
            <p className="text-[10px] font-bold text-[#D0C3AF] uppercase tracking-[0.2em]">New link</p>

            <div>
              <p className="text-[10px] text-[#B4AA99] uppercase tracking-wider mb-2">Audience</p>
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
                          ? 'bg-[#342F27] border-[#C9BCA8] text-[#F3E6D1]'
                          : 'bg-[#090907] border-[#211F1A] text-[#D0C3AF] hover:border-[#3B372F]'
                      }`}
                    >
                      <span className="text-[11px] font-medium">{k.label}</span>
                      <span className="text-[9px] text-[#9B9282] leading-tight">{k.help}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-[#B4AA99] uppercase tracking-wider mb-2">Permission</p>
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
                          ? 'bg-[#342F27] border-[#C9BCA8] text-[#F3E6D1]'
                          : 'bg-[#090907] border-[#211F1A] text-[#D0C3AF] hover:border-[#3B372F]'
                      }`}
                    >
                      <Icon size={13} />
                      <span className="text-[11px] font-medium">{ROLE_INFO[r].label}</span>
                      <span className="text-[9px] text-[#9B9282] leading-tight">{ROLE_INFO[r].help}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <ToggleRow
                icon={<Download size={12} />}
                label="Allow downloads"
                active={allowDownloads}
                onToggle={() => setAllowDownloads((v) => !v)}
              />
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
                  className="w-full bg-[#090907] border border-[#211F1A] rounded-md px-3 py-2 text-[12px] text-white placeholder:text-[#837B6D] focus:outline-none focus:border-[#C9BCA8]"
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
                    { value: '30', label: '30 days' },
                  ]}
                  className="w-full bg-[#090907] border border-[#211F1A] rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-[#C9BCA8]"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-[#B4AA99] uppercase tracking-wider mb-1">Recipient (label)</p>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Label A&R"
                  className="w-full bg-[#090907] border border-[#211F1A] rounded-md px-3 py-2 text-[11px] text-white placeholder:text-[#837B6D] focus:outline-none focus:border-[#C9BCA8]"
                />
              </div>
              <div>
                <p className="text-[10px] text-[#B4AA99] uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Mail size={9} /> Email (optional)
                </p>
                <input
                  type="email"
                  value={invitedEmail}
                  onChange={(e) => setInvitedEmail(e.target.value)}
                  placeholder="them@example.com"
                  className="w-full bg-[#090907] border border-[#211F1A] rounded-md px-3 py-2 text-[11px] text-white placeholder:text-[#837B6D] focus:outline-none focus:border-[#C9BCA8]"
                />
              </div>
            </div>

            {generatedUrl ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 bg-white/[0.02] border border-[#C9BCA8]/30 rounded-xl px-3 py-2.5 backdrop-blur-sm">
                  <Link2 size={12} className="text-[#F3E6D1] shrink-0" />
                  <input
                    readOnly
                    value={generatedUrl}
                    className="flex-1 bg-transparent text-[11px] text-[#F7EBDD] font-mono focus:outline-none truncate"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => doCopy(generatedUrl)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white text-black text-[12px] font-medium hover:bg-[#F7EBDD] active:scale-[0.98] transition-all"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    onClick={() => setGeneratedUrl(null)}
                    className="px-4 py-3 rounded-full bg-white/[0.04] border border-white/[0.06] text-[#F7EBDD] text-[12px] font-medium hover:bg-white/[0.08] hover:border-white/[0.12] transition-colors"
                  >
                    Create another
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={generateLink}
                disabled={generating}
                className="w-full bg-white hover:bg-[#F7EBDD] disabled:opacity-40 text-black text-[12px] font-medium py-3 rounded-full transition-all active:scale-[0.99] flex items-center justify-center gap-2"
              >
                {generating ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                Generate link
              </button>
            )}
          </div>

          <div className="p-6">
            <p className="text-[10px] font-bold text-[#D0C3AF] uppercase tracking-[0.2em] mb-3">
              Active links {shares.length > 0 && <span className="text-[#9B9282]">({shares.length})</span>}
            </p>
            {loadingShares ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={14} className="animate-spin text-[#837B6D]" />
              </div>
            ) : shares.length === 0 ? (
              <p className="text-[11px] text-[#9B9282] py-3">No shares yet — generate one above.</p>
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
                        revoked || expired ? 'bg-[#090907] border-[#161616] opacity-50' : 'bg-[#090907] border-[#211F1A] hover:border-[#3B372F]'
                      } transition-all`}
                    >
                      <div className="w-7 h-7 rounded bg-[#342F27] border border-[#C9BCA8]/30 flex items-center justify-center shrink-0">
                        <Icon size={11} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-[#F7EBDD] truncate">
                            {s.label || s.invited_email || 'Untitled link'}
                          </span>
                          <span className="text-[8px] font-bold text-[#F3E6D1] bg-[#342F27] border border-[#C9BCA8]/40 rounded px-1.5 py-0.5 uppercase">
                            {ROLE_INFO[s.role].label}
                          </span>
                          {revoked && <span className="text-[8px] text-red-400 uppercase">Revoked</span>}
                          {expired && !revoked && <span className="text-[8px] text-yellow-500 uppercase">Expired</span>}
                        </div>
                        <p className="text-[9px] font-mono text-[#9B9282] mt-0.5 truncate">
                          {s.plays} {s.plays === 1 ? 'play' : 'plays'} · created {fmtDate(s.created_at)}
                          {s.expires_at ? ` · expires ${fmtDate(s.expires_at)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => doCopy(url)}
                          className="p-1.5 rounded text-[#B4AA99] hover:text-white hover:bg-[#211F1A]"
                          title="Copy link"
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          onClick={() => toggleDownloads(s)}
                          className={`p-1.5 rounded hover:bg-[#211F1A] transition-colors ${s.allow_downloads ? 'text-[#E7D7BE]' : 'text-[#837B6D]'}`}
                          title={s.allow_downloads ? 'Downloads allowed — click to disable' : 'Downloads disabled — click to enable'}
                        >
                          <Download size={11} />
                        </button>
                        {contentType === 'project' && s.invited_email && !revoked && (
                          <button
                            onClick={() => sendInvite(s)}
                            className="p-1.5 rounded text-[#B4AA99] hover:text-[#E7D7BE] hover:bg-[#211F1A]"
                            title={`Email this link to ${s.invited_email}`}
                          >
                            <Send size={11} />
                          </button>
                        )}
                        {!revoked && (
                          <button
                            onClick={() => revokeShare(s)}
                            className="p-1.5 rounded text-[#B4AA99] hover:text-red-400 hover:bg-[#211F1A]"
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
        active ? 'bg-[#342F27] border-[#C9BCA8]/40 text-[#F3E6D1]' : 'bg-[#090907] border-[#211F1A] text-[#D0C3AF] hover:border-[#3B372F]'
      }`}
    >
      <span className="flex items-center gap-2 text-[11px] font-medium">
        {icon}
        {label}
      </span>
      <span className={`text-[9px] font-mono uppercase tracking-wider ${active ? 'text-[#F3E6D1]' : 'text-[#9B9282]'}`}>
        {active ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
