'use client';

import { useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import {
  Loader2, Save, CheckCircle2, User, DollarSign, Link2 as LinkIcon,
  Camera, AtSign, Music, Globe, Mail, FileText,
  Eye, LogOut, X as CloseIcon,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';

const EMPTY_PROFILE = {
  display_name: '',
  bio: '',
  hero_image_url: '',
  credits: '',
  license_lease_price_usd: '',
  license_exclusive_price_usd: '',
  license_notes: '',
  license_agreement: '',
  default_discount_percent: '',
  contact_email: '',
  instagram_handle: '',
  twitter_handle: '',
  spotify_url: '',
  soundcloud_url: '',
  website_url: '',
};

type Profile = typeof EMPTY_PROFILE;

const inputCls =
  'w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">
        {label}
        {hint && <span className="ml-2 normal-case text-[#3a3328]">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#14110d] border border-[#1a160f] rounded-2xl p-8 shadow-xl">
      <div className="flex items-center gap-3 mb-6 border-b border-[#1a160f] pb-4">
        <span className="text-[#a08a6a]">{icon}</span>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#E8DCC8]">{title}</h2>
          {subtitle && <p className="text-[10px] font-mono text-[#5a5142] mt-0.5 uppercase tracking-widest">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewView, setPreviewView] = useState<'client' | 'rapper' | 'friend'>('client');
  const heroInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((data) => {
        if (data.profile) {
          setProfile({
            display_name: data.profile.display_name || '',
            bio: data.profile.bio || '',
            hero_image_url: data.profile.hero_image_url || '',
            credits: data.profile.credits || '',
            license_lease_price_usd: data.profile.license_lease_price_usd != null ? String(data.profile.license_lease_price_usd) : '',
            license_exclusive_price_usd: data.profile.license_exclusive_price_usd != null ? String(data.profile.license_exclusive_price_usd) : '',
            license_notes: data.profile.license_notes || '',
            license_agreement: data.profile.license_agreement || '',
            default_discount_percent: data.profile.default_discount_percent != null ? String(data.profile.default_discount_percent) : '',
            contact_email: data.profile.contact_email || '',
            instagram_handle: data.profile.instagram_handle || '',
            twitter_handle: data.profile.twitter_handle || '',
            spotify_url: data.profile.spotify_url || '',
            soundcloud_url: data.profile.soundcloud_url || '',
            website_url: data.profile.website_url || '',
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile((p) => ({ ...p, [key]: e.target.value }));

  const handleHeroFile = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => setProfile((p) => ({ ...p, hero_image_url: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profile,
          license_lease_price_usd: profile.license_lease_price_usd ? Number(profile.license_lease_price_usd) : null,
          license_exclusive_price_usd: profile.license_exclusive_price_usd ? Number(profile.license_exclusive_price_usd) : null,
          default_discount_percent: profile.default_discount_percent ? Number(profile.default_discount_percent) : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setSaved(true);
      toast.success('Profile saved');
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      toast.error('Save failed', err?.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <DashboardLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={20} className="animate-spin text-[#4a4338]" />
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="max-w-[860px] mx-auto px-4 md:px-10 pt-6 pb-32">

        {/* Page header */}
        <div className="relative mb-8 rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d]/50 via-[#0a0907]/30 to-[#0a0907] p-8">
          <div className="absolute inset-0 z-0 bg-[url('/images/hero-abstract-3.jpg')] bg-cover bg-center opacity-20 mix-blend-overlay" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] mb-2">Creator</p>
              <h1 className="text-[40px] font-bold tracking-tight text-white leading-none font-heading mb-1">Profile</h1>
              <p className="text-[11px] text-[#a08a6a] mt-2">{user?.email}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setShowPreview(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#2d2620] hover:border-[#D4BFA0]/50 text-[12px] font-medium text-[#a08a6a] hover:text-[#E8DCC8] transition-all bg-[#0a0907]"
              >
                <Eye size={13} />
                Preview
              </button>
              <button
                onClick={handleSave}
                disabled={saving || saved}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-[12px] font-medium transition-all ${
                  saved
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-white text-black hover:bg-[#E8DCC8] disabled:opacity-50'
                }`}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CheckCircle2 size={13} /> : <Save size={13} />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
              </button>
              <button
                onClick={() => signOut()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.06] text-[12px] font-medium text-[#a08a6a] hover:text-red-400 hover:border-red-400/30 transition-all"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-8">

          {/* ── Section 1: Identity ─────────────────────────────────── */}
          <Section icon={<User size={15} />} title="Identity" subtitle="How you appear on your public share pages">

            {/* Hero image */}
            <div className="flex gap-5 items-start">
              <div
                onClick={() => heroInputRef.current?.click()}
                className="w-28 h-28 rounded-2xl bg-[#16130e] border border-[#1a160f] overflow-hidden shrink-0 cursor-pointer hover:border-[#D4BFA0]/40 transition-colors group relative"
              >
                {profile.hero_image_url ? (
                  <img src={profile.hero_image_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-[#3a3328] gap-1">
                    <Camera size={20} />
                    <span className="text-[9px] font-mono uppercase tracking-wider">Photo</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera size={18} className="text-white" />
                </div>
              </div>
              <input ref={heroInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleHeroFile(f); }} />
              <div className="flex-1 space-y-3">
                <Field label="Display Name">
                  <input type="text" value={profile.display_name} onChange={set('display_name')}
                    placeholder="e.g. U2C Beatstore" className={inputCls} />
                </Field>
                <Field label="Hero Image URL" hint="paste CDN link or click photo above to upload">
                  <input type="url" value={profile.hero_image_url} onChange={set('hero_image_url')}
                    placeholder="https://…" className={inputCls} />
                </Field>
              </div>
            </div>

            <Field label="Bio">
              <textarea rows={4} value={profile.bio} onChange={set('bio')}
                placeholder="Your story. This intro leads your public client landing page…"
                className={`${inputCls} resize-none leading-relaxed`} />
            </Field>

            <Field label="Credits (one per line)" hint="Appears as a list on your share page">
              <textarea rows={4} value={profile.credits} onChange={set('credits')}
                placeholder={"Drake — Honestly Nevermind\nLil Baby — It's Only Me\nGunna — DS4EVER"}
                className={`${inputCls} resize-none font-mono leading-relaxed`} />
            </Field>
          </Section>

          {/* ── Section 2: Pricing & Licensing ─────────────────────── */}
          <Section icon={<DollarSign size={15} />} title="Pricing & Licensing" subtitle="Default prices applied to all share links unless overridden per-link">

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Lease Price (USD)">
                <input type="number" min="0" step="0.01" value={profile.license_lease_price_usd} onChange={set('license_lease_price_usd')}
                  placeholder="e.g. 150" className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Exclusive Price (USD)">
                <input type="number" min="0" step="0.01" value={profile.license_exclusive_price_usd} onChange={set('license_exclusive_price_usd')}
                  placeholder="e.g. 2500" className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Default Discount (%)" hint="Applied automatically to new share links">
                <input type="number" min="0" max="100" value={profile.default_discount_percent} onChange={set('default_discount_percent')}
                  placeholder="e.g. 20" className={`${inputCls} font-mono`} />
              </Field>
            </div>

            <Field label="Licensing Notes" hint="Short terms shown on the license card">
              <textarea rows={2} value={profile.license_notes} onChange={set('license_notes')}
                placeholder="e.g. 50/50 split on master and publishing. Stems sent on full payment."
                className={`${inputCls} resize-none leading-relaxed`} />
            </Field>

            <Field label="Custom License Agreement" hint="Full legal text shown to buyers at checkout">
              <textarea rows={8} value={profile.license_agreement} onChange={set('license_agreement')}
                placeholder={"This license grants the purchaser the right to use the beat in one (1) commercial release…\n\nAll rights to the master recording remain with the producer.\n\nThis license is non-exclusive unless otherwise stated."}
                className={`${inputCls} resize-y font-mono leading-relaxed`} />
            </Field>
          </Section>

          {/* ── Section 3: Contact & Socials ───────────────────────── */}
          <Section icon={<LinkIcon size={15} />} title="Contact & Socials" subtitle="Shown at the bottom of your share pages">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact Email">
                <div className="relative">
                  <Mail size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
                  <input type="email" value={profile.contact_email} onChange={set('contact_email')}
                    placeholder="beats@yourname.com" className={`${inputCls} pl-8`} />
                </div>
              </Field>
              <Field label="Website">
                <div className="relative">
                  <Globe size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
                  <input type="url" value={profile.website_url} onChange={set('website_url')}
                    placeholder="https://yourname.com" className={`${inputCls} pl-8`} />
                </div>
              </Field>
              <Field label="Instagram">
                <div className="relative">
                  <AtSign size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
                  <input type="text" value={profile.instagram_handle} onChange={set('instagram_handle')}
                    placeholder="yourusername" className={`${inputCls} pl-8`} />
                </div>
              </Field>
              <Field label="Twitter / X">
                <div className="relative">
                  <AtSign size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
                  <input type="text" value={profile.twitter_handle} onChange={set('twitter_handle')}
                    placeholder="yourusername" className={`${inputCls} pl-8`} />
                </div>
              </Field>
              <Field label="Spotify">
                <div className="relative">
                  <Music size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
                  <input type="url" value={profile.spotify_url} onChange={set('spotify_url')}
                    placeholder="https://open.spotify.com/artist/…" className={`${inputCls} pl-8`} />
                </div>
              </Field>
              <Field label="SoundCloud">
                <div className="relative">
                  <Music size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
                  <input type="url" value={profile.soundcloud_url} onChange={set('soundcloud_url')}
                    placeholder="https://soundcloud.com/yourname" className={`${inputCls} pl-8`} />
                </div>
              </Field>
            </div>
          </Section>

        </div>
      </div>

      {/* ── Profile Preview Slide-over ─────────────────────────── */}
      {showPreview && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={() => setShowPreview(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-[#0c0a08] border-l border-[#1f1a13] z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 overflow-hidden">

            {/* Preview header */}
            <div className="px-6 py-4 border-b border-[#1f1a13] flex items-center justify-between bg-[#14110d] shrink-0">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#a08a6a]">Live Preview</p>
                <p className="text-xs font-bold text-white mt-0.5 uppercase tracking-wider">How your page looks</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="text-[#6a5d4a] hover:text-white p-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                <CloseIcon size={16} />
              </button>
            </div>

            {/* View tabs */}
            <div className="flex p-3 gap-1 bg-[#0c0a08] border-b border-[#1a160f] shrink-0">
              {(['client', 'rapper', 'friend'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setPreviewView(v)}
                  className={`flex-1 py-2 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${
                    previewView === v
                      ? 'bg-[#1e1a14] text-[#E8DCC8] border border-[#2d2620]'
                      : 'text-[#5a5142] hover:text-[#a08a6a]'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Preview content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* Hero card */}
              <div className="relative rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d] via-[#0c0c0c] to-[#0c0c0c] p-6 text-center">
                {profile.hero_image_url ? (
                  <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[#D4BFA0] mx-auto shadow-xl">
                    <img loading="lazy" src={profile.hero_image_url} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-full border-2 border-dashed border-[#2d2620] flex items-center justify-center text-[#3a3328] mx-auto bg-[#0a0907]">
                    <User size={28} />
                  </div>
                )}
                <h4 className="text-lg font-bold text-white tracking-tight mt-4 uppercase font-heading">
                  {profile.display_name || 'CREATOR NAME'}
                </h4>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mt-1">
                  {previewView === 'client' ? 'Producer · Beatmaker' : previewView === 'rapper' ? 'Vocalist Session' : 'Private Preview'}
                </p>
              </div>

              {previewView === 'client' && (
                <>
                  {profile.bio && (
                    <div className="bg-[#14110d]/45 border border-[#1a160f] rounded-2xl p-5">
                      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2 font-bold">Bio</p>
                      <p className="text-xs text-[#E8DCC8] leading-relaxed italic whitespace-pre-wrap">{profile.bio}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#14110d]/50 border border-[#1a160f] p-4 rounded-xl text-center">
                      <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#5a5142] font-bold block">Lease</span>
                      <p className="text-xl font-mono text-[#D4BFA0] font-bold mt-1">
                        {profile.license_lease_price_usd ? `$${profile.license_lease_price_usd}` : '—'}
                      </p>
                      <span className="text-[8px] text-[#5a5142] block mt-0.5">WAV · MP3</span>
                    </div>
                    <div className="bg-[#14110d]/50 border border-[#1a160f] p-4 rounded-xl text-center">
                      <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#5a5142] font-bold block">Exclusive</span>
                      <p className="text-xl font-mono text-[#7F77DD] font-bold mt-1">
                        {profile.license_exclusive_price_usd ? `$${profile.license_exclusive_price_usd}` : '—'}
                      </p>
                      <span className="text-[8px] text-[#5a5142] block mt-0.5">Full ownership</span>
                    </div>
                  </div>

                  {profile.license_notes && (
                    <div className="bg-[#14110d]/30 border border-[#1a160f] p-4 rounded-xl">
                      <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-1 font-bold">Terms</p>
                      <p className="text-[10px] text-[#a08a6a] leading-relaxed">{profile.license_notes}</p>
                    </div>
                  )}

                  {profile.credits && (
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2 font-bold">Credits</p>
                      <div className="flex flex-wrap gap-1.5">
                        {profile.credits.split('\n').filter(Boolean).map((c, i) => (
                          <span key={i} className="px-2.5 py-1 bg-[#1a1833]/30 border border-[#534AB7]/30 text-[#AFA9EC] text-[9px] font-mono rounded-full font-bold">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {previewView === 'rapper' && (
                <div className="bg-[#14110d]/50 border border-[#1a160f] rounded-2xl p-6 space-y-5">
                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mb-2 font-bold">Lyrics Studio</p>
                    <div className="bg-[#0a0907]/90 border border-[#1f1a13] p-4 rounded-xl font-mono text-[10px] text-white/90 leading-relaxed space-y-1">
                      <p className="text-[#D4BFA0] font-bold">Verse 1:</p>
                      <p className="opacity-60 italic">Start writing here…</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2 font-bold">Rhyme helper</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['fire', 'inspire', 'desire', 'wire'].map((w) => (
                        <span key={w} className="px-2 py-0.5 bg-[#1a1610]/40 border border-[#2d2620] text-[#a08a6a] text-[9px] rounded font-mono">{w}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {previewView === 'friend' && (
                <div className="text-center space-y-4">
                  <div className="w-32 h-32 rounded-full border border-white/[0.05] bg-[#14110d] mx-auto flex items-center justify-center">
                    {profile.hero_image_url
                      ? <img src={profile.hero_image_url} alt="" className="w-full h-full rounded-full object-cover" />
                      : <Music size={36} className="text-[#3a3328]" />}
                  </div>
                  <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">Minimal vinyl player</p>
                  <p className="text-[10px] text-[#3a3328]">Track list + spinning vinyl only</p>
                </div>
              )}

              {/* Footer social pills preview */}
              {(profile.contact_email || profile.instagram_handle || profile.twitter_handle) && (
                <div className="border-t border-[#1a160f] pt-4 flex flex-wrap justify-center gap-3">
                  {profile.contact_email && (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-[#14110d] border border-[#1a160f] rounded-full text-[9px] font-mono text-[#6a5d4a]">
                      <Mail size={9} /> {profile.contact_email}
                    </span>
                  )}
                  {profile.instagram_handle && (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-[#14110d] border border-[#1a160f] rounded-full text-[9px] font-mono text-[#6a5d4a]">
                      <AtSign size={9} /> {profile.instagram_handle}
                    </span>
                  )}
                  {profile.twitter_handle && (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-[#14110d] border border-[#1a160f] rounded-full text-[9px] font-mono text-[#6a5d4a]">
                      <AtSign size={9} /> {profile.twitter_handle}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
