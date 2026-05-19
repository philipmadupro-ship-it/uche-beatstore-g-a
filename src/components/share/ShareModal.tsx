'use client';

import { X, Lock, Link2, Download, Calendar, Check, Copy, Loader2, Globe } from 'lucide-react';
import { useState } from 'react';
import { copyToClipboard } from '@/lib/clipboard';
import { Dropdown } from '@/components/ui/Dropdown';

interface ShareModalProps {
  onClose: () => void;
  title: string;
  trackIds: string[];
  coverUrl?: string | null;
  projectId?: string | null;
  kind?: 'track' | 'project' | 'playlist';
}

export function ShareModal({ onClose, title, trackIds, coverUrl, projectId, kind = 'project' }: ShareModalProps) {
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [passwordProtect, setPasswordProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [expiryEnabled, setExpiryEnabled] = useState(false);
  const [expiryDays, setExpiryDays] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipientKind, setRecipientKind] = useState<'client' | 'producer' | 'rapper' | 'friend'>('client');

  const generateLink = async () => {
    if (!trackIds.length) {
      setError('Nothing to share — add at least one track.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_ids: trackIds,
          title,
          cover_url: coverUrl || null,
          project_id: projectId || null,
          kind,
          allow_downloads: allowDownloads,
          expires_days: expiryEnabled ? expiryDays : 0,
          password: passwordProtect && password ? password : null,
          recipient_kind: recipientKind,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create link');
      setShareUrl(data.url);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setGenerating(false);
    }
  };

  const doCopy = async () => {
    if (!shareUrl) return;
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={onClose}>
      <div
        className="bg-[#0a0907] border border-[#1f1a13] w-full max-w-[520px] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-500"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-8 border-b border-[#1f1a13] bg-gradient-to-b from-[#16130e] to-[#0a0907] flex items-start gap-5">
          <div className="w-16 h-16 bg-[#1a160f] rounded-xl overflow-hidden shrink-0 border border-[#2d2620]">
            {coverUrl ? (
              <img loading="lazy" src={coverUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#4a4338] font-black text-2xl uppercase">
                {title[0] || '?'}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#D4BFA0] mb-2">Share {kind}</p>
            <h2 className="text-xl font-black uppercase tracking-tight text-white truncate leading-tight">{title}</h2>
            <p className="text-[10px] text-[#4a4338] uppercase tracking-widest mt-1 font-bold">
              {trackIds.length} track{trackIds.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-[#4a4338] hover:text-white hover:bg-[#1a160f] rounded-lg transition-all">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        {!shareUrl ? (
          <div className="p-8 space-y-6">
            {/* Audience Variant */}
            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] block">Audience Variant</label>
              <Dropdown
                value={recipientKind}
                onChange={(val) => setRecipientKind(val as any)}
                options={[
                  { value: 'client', label: 'Client Variant (Bio / Placements / Pricing)' },
                  { value: 'producer', label: 'Producer Variant (Stems Mixer & Tech Specs)' },
                  { value: 'rapper', label: 'Rapper Variant (Vocal Sheet / Lyrics Scroll)' },
                  { value: 'friend', label: 'Friend Variant (Standard Simple Player)' }
                ]}
                className="w-full bg-[#16130e] border border-[#1f1a13] rounded-lg py-3 px-4 text-xs text-white focus:outline-none focus:border-[#D4BFA0] transition-colors"
              />
            </div>

            {/* Allow Downloads */}
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#16130e] border border-[#1f1a13] flex items-center justify-center group-hover:border-[#D4BFA0]/40 transition-colors">
                  <Download size={16} className="text-[#a08a6a]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#E8DCC8]">Allow downloads</p>
                  <p className="text-[10px] uppercase tracking-widest text-[#4a4338] font-bold mt-0.5">Listeners can save the audio</p>
                </div>
              </div>
              <input type="checkbox" checked={allowDownloads} onChange={(e) => setAllowDownloads(e.target.checked)} className="agv-toggle" />
            </label>

            {/* Password */}
            <div className="space-y-3">
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#16130e] border border-[#1f1a13] flex items-center justify-center group-hover:border-[#D4BFA0]/40 transition-colors">
                    <Lock size={16} className="text-[#a08a6a]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#E8DCC8]">Password protect</p>
                    <p className="text-[10px] uppercase tracking-widest text-[#4a4338] font-bold mt-0.5">Require a password to listen</p>
                  </div>
                </div>
                <input type="checkbox" checked={passwordProtect} onChange={(e) => setPasswordProtect(e.target.checked)} className="agv-toggle" />
              </label>
              {passwordProtect && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full bg-[#16130e] border border-[#1f1a13] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#4a4338] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                />
              )}
            </div>

            {/* Expiry */}
            <div className="space-y-3">
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#16130e] border border-[#1f1a13] flex items-center justify-center group-hover:border-[#D4BFA0]/40 transition-colors">
                    <Calendar size={16} className="text-[#a08a6a]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#E8DCC8]">Set expiry</p>
                    <p className="text-[10px] uppercase tracking-widest text-[#4a4338] font-bold mt-0.5">Link auto-expires</p>
                  </div>
                </div>
                <input type="checkbox" checked={expiryEnabled} onChange={(e) => setExpiryEnabled(e.target.checked)} className="agv-toggle" />
              </label>
              {expiryEnabled && (
                <div className="flex gap-2">
                  {[1, 7, 30, 90].map((d) => (
                    <button
                      key={d}
                      onClick={() => setExpiryDays(d)}
                      className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        expiryDays === d
                          ? 'bg-[#D4BFA0] text-white shadow-lg shadow-[#D4BFA0]/20'
                          : 'bg-[#16130e] border border-[#1f1a13] text-[#a08a6a] hover:border-[#D4BFA0]/40'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-400 uppercase tracking-widest font-bold">{error}</p>}

            <button
              onClick={generateLink}
              disabled={generating}
              className="w-full flex items-center justify-center gap-3 bg-[#D4BFA0] hover:bg-[#8A7A5C] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl text-xs font-black uppercase tracking-[0.2em] transition-all shadow-lg shadow-[#D4BFA0]/20"
            >
              {generating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Generating Secure Link
                </>
              ) : (
                <>
                  <Link2 size={16} />
                  Generate Share Link
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="p-8 space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-center w-16 h-16 mx-auto bg-[#2A2418] rounded-full border border-[#D4BFA0]/30">
              <Check size={28} className="text-[#D4BFA0]" strokeWidth={3} />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-black uppercase text-white tracking-tight">Link Ready</h3>
              <p className="text-[10px] uppercase tracking-widest text-[#4a4338] font-bold mt-2">Anyone with this link can listen</p>
            </div>
            <div className="bg-[#16130e] border border-[#1f1a13] rounded-xl p-4 flex items-center gap-3">
              <Globe size={16} className="text-[#D4BFA0] shrink-0" />
              <p className="flex-1 text-xs text-[#E8DCC8] font-mono truncate">{shareUrl}</p>
              <button
                onClick={doCopy}
                className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shrink-0 ${
                  copied ? 'bg-green-500/20 text-green-400' : 'bg-[#D4BFA0] text-white hover:bg-[#8A7A5C]'
                }`}
              >
                {copied ? (
                  <span className="flex items-center gap-1.5"><Check size={12} /> Copied</span>
                ) : (
                  <span className="flex items-center gap-1.5"><Copy size={12} /> Copy</span>
                )}
              </button>
            </div>
            <button
              onClick={onClose}
              className="w-full bg-[#16130e] border border-[#1f1a13] hover:border-[#2d2620] text-[#a08a6a] hover:text-white py-3.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
            >
              Done
            </button>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .agv-toggle {
          appearance: none;
          width: 40px;
          height: 22px;
          background: #1a160f;
          border: 1px solid #1f1a13;
          border-radius: 999px;
          position: relative;
          cursor: pointer;
          outline: none;
          transition: background 0.25s, border-color 0.25s;
          flex-shrink: 0;
        }
        .agv-toggle::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          background: #4a4338;
          border-radius: 50%;
          transition: transform 0.25s, background 0.25s;
        }
        .agv-toggle:checked {
          background: #D4BFA0;
          border-color: #D4BFA0;
        }
        .agv-toggle:checked::after {
          transform: translateX(18px);
          background: #fff;
        }
      `}} />
    </div>
  );
}
