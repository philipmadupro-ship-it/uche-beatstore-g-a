'use client';

import { useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import {
  Loader2, Save, CheckCircle2, User, Camera, AtSign, Music, Globe, Mail,
  Eye, LogOut, X as CloseIcon,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import { discardUploadedImage, uploadImageFile } from '@/lib/upload/image-upload-client';
import { normalizeFontStyle, STORE_FONT_LABELS, STORE_FONT_STYLES } from '@/lib/store/appearance';
import { profileSaveBody, profileSaveError, type ProfileFormState } from '@/lib/profile/save-body';
import { unusableLinksWarning } from '@/lib/store/social-links';
import { profileCompleteness } from '@/lib/profile/completeness';

const EMPTY_PROFILE: ProfileFormState = {
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
  accent_color: '#FFFFFF',
  font_style: 'default',
};

type Profile = ProfileFormState;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

const inputCls =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg h-10 px-3 text-xs text-white placeholder:text-white/30 hover:border-white/20 focus:outline-none focus:border-white/30 transition-colors';
const areaCls =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg py-2.5 px-3 text-xs text-white placeholder:text-white/30 hover:border-white/20 focus:outline-none focus:border-white/30 transition-colors';
/** Translucent control: rest / hover, per the control language. */
const ghostBtn =
  'inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3.5 text-[11px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white disabled:opacity-40';

/** Label above, control, then the hint beneath it so labels in a row line up. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[10px] leading-snug text-white/40">{hint}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#0D0D0A] p-5 md:p-6">
      <div className="mb-5">
        <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/60">{title}</h2>
        {subtitle && <p className="mt-1 text-[11px] text-white/40">{subtitle}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function IconInput({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40">{icon}</span>
      {children}
    </div>
  );
}

const ACCENT_PRESETS = ['#FFFFFF', '#7F77DD', '#6DC6A4', '#E8874A', '#E87A8C', '#64B5F6'];

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);
  // A photo uploaded since the last save. Replacing it before saving discards
  // it, so picking three photos doesn't leave two orphans in the bucket.
  const unsavedHeroUrl = useRef<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const previewPanelRef = useDialogBehavior({ open: showPreview, onClose: () => setShowPreview(false) });

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
            accent_color: data.profile.accent_color || '#FFFFFF',
            font_style: normalizeFontStyle(data.profile.font_style),
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile((p) => ({ ...p, [key]: e.target.value }));

  const setValue = (key: keyof Profile, value: string) =>
    setProfile((p) => ({ ...p, [key]: value }));

  // Upload the photo and keep only its URL. It used to be read into a data:
  // URL, which the profile contract rejects (URL columns cap at 2000 chars),
  // so picking a photo made every later save fail — see lib/profile/save-body.
  const handleHeroFile = async (file: File) => {
    setUploadingHero(true);
    try {
      const url = await uploadImageFile(file);
      if (unsavedHeroUrl.current) void discardUploadedImage(unsavedHeroUrl.current);
      unsavedHeroUrl.current = url;
      setProfile((p) => ({ ...p, hero_image_url: url }));
    } catch (err: unknown) {
      toast.error('Photo upload failed', errorMessage(err, 'Unknown error'));
    } finally {
      setUploadingHero(false);
      if (heroInputRef.current) heroInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    const invalid = profileSaveError(profile);
    if (invalid) {
      toast.error('Save failed', invalid);
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileSaveBody(profile)),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      unsavedHeroUrl.current = null;
      setSaved(true);
      toast.success('Profile saved');
      const badLinks = unusableLinksWarning(profile);
      if (badLinks) toast.warning(badLinks.title, badLinks.description);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      toast.error('Save failed', errorMessage(err, 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  /** Same hook as the TopBar menu: toast on failure, hard-nav to /login. */
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const { error } = await signOut();
    if (error) {
      setSigningOut(false);
      toast.error('Sign out failed', error);
    }
  };

  if (loading) return (
    <DashboardLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={20} className="animate-spin text-white/40" />
      </div>
    </DashboardLayout>
  );

  const completeness = profileCompleteness(profile);
  const creditLines = profile.credits.split('\n').map((l) => l.trim()).filter(Boolean);
  const previewLinks = [profile.contact_email, profile.instagram_handle, profile.twitter_handle].filter(Boolean);

  return (
    <DashboardLayout>
      <PageContainer className="pb-32">
        <PageHeader
          eyebrow="Creator"
          title="Profile"
          description="How you appear on your public page, share links and license cards."
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setShowPreview(true)} className={ghostBtn}>
                <Eye size={13} />
                Preview
              </button>
              <button
                onClick={handleSave}
                disabled={saving || saved || uploadingHero}
                className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[11px] font-medium transition-colors ${
                  saved
                    ? 'border border-[#6DC6A4]/30 bg-[#6DC6A4]/10 text-[#6DC6A4]'
                    : 'bg-white text-black hover:bg-white/90 disabled:opacity-50'
                }`}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CheckCircle2 size={13} /> : <Save size={13} />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
              </button>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-8 lg:items-start">

          {/* ── Identity card: who the public sees, and how complete it is ── */}
          <aside className="rounded-xl border border-white/10 bg-[#0D0D0A] p-5 lg:sticky lg:top-20">
            <div className="flex items-center gap-4 lg:flex-col lg:items-start">
              <button
                type="button"
                onClick={() => heroInputRef.current?.click()}
                disabled={uploadingHero}
                aria-label={profile.hero_image_url ? 'Replace hero photo' : 'Upload hero photo'}
                aria-busy={uploadingHero}
                className="group relative h-24 w-24 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-[#090907] transition-colors hover:border-white/20 focus-visible:border-white/30 focus-visible:outline-none disabled:cursor-wait"
              >
                {profile.hero_image_url ? (
                  <img src={profile.hero_image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-white/40">
                    <Camera size={20} />
                    <span className="text-[10px] font-mono uppercase tracking-[0.2em]">Photo</span>
                  </div>
                )}
                <div className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${uploadingHero ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
                  {uploadingHero
                    ? <Loader2 size={18} className="animate-spin text-white" />
                    : <Camera size={18} className="text-white" />}
                </div>
              </button>
              <input ref={heroInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleHeroFile(f); }} />
              <div className="min-w-0">
                <p className="truncate font-heading text-[24px] leading-tight text-white">
                  {profile.display_name || 'Unnamed'}
                </p>
                {user?.email && <p className="mt-1 truncate text-[11px] text-white/60">{user.email}</p>}
              </div>
            </div>

            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="flex items-baseline justify-between">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Public profile</p>
                <p className="text-[11px] text-white/80">{completeness.filled} of {completeness.total}</p>
              </div>
              <div
                className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-label="Profile completeness"
                aria-valuemin={0}
                aria-valuemax={completeness.total}
                aria-valuenow={completeness.filled}
              >
                <div className="h-full rounded-full bg-white/60" style={{ width: `${(completeness.filled / completeness.total) * 100}%` }} />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-white/40">
                {completeness.missing.length === 0 ? 'Everything buyers look for is filled in.' : `Missing: ${completeness.missing.join(', ')}.`}
              </p>
            </div>

            <div className="mt-4 border-t border-white/10 pt-3">
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                aria-label="Sign out"
                className="-ml-2 inline-flex h-10 items-center gap-2 rounded-lg px-2 text-[11px] font-medium text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
              >
                <LogOut size={13} />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </aside>

          <div className="space-y-6 min-w-0">

            {/* ── Identity ─────────────────────────────────────────── */}
            <Section title="Identity" subtitle="Your name, photo and story.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Display name">
                  <input type="text" value={profile.display_name} onChange={set('display_name')}
                    placeholder="e.g. U2C Beatstore" className={inputCls} />
                </Field>
                <Field label="Hero image URL" hint="Paste a link, or click the photo to upload.">
                  <input type="url" value={profile.hero_image_url} onChange={set('hero_image_url')}
                    placeholder="https://…" className={inputCls} />
                </Field>
              </div>
              <Field label="Bio">
                <textarea rows={4} value={profile.bio} onChange={set('bio')}
                  placeholder="Your story. This intro leads your public client landing page…"
                  className={`${areaCls} resize-none leading-relaxed`} />
              </Field>
              <Field label="Credits" hint="One per line. Shown as a list on your public page.">
                <textarea rows={4} value={profile.credits} onChange={set('credits')}
                  placeholder={"Drake — Honestly Nevermind\nLil Baby — It's Only Me\nGunna — DS4EVER"}
                  className={`${areaCls} resize-none font-mono leading-relaxed`} />
              </Field>
            </Section>

            {/* ── Pricing & licensing ──────────────────────────────── */}
            <Section title="Pricing & licensing" subtitle="Defaults for share links, unless a link overrides them.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Lease price (USD)">
                  <input type="number" min="0" step="0.01" value={profile.license_lease_price_usd} onChange={set('license_lease_price_usd')}
                    placeholder="e.g. 150" className={`${inputCls} font-mono`} />
                </Field>
                <Field label="Exclusive price (USD)">
                  <input type="number" min="0" step="0.01" value={profile.license_exclusive_price_usd} onChange={set('license_exclusive_price_usd')}
                    placeholder="e.g. 2500" className={`${inputCls} font-mono`} />
                </Field>
                <Field label="Default discount (%)" hint="Applied to new share links.">
                  <input type="number" min="0" max="100" value={profile.default_discount_percent} onChange={set('default_discount_percent')}
                    placeholder="e.g. 20" className={`${inputCls} font-mono`} />
                </Field>
              </div>
              <Field label="Licensing notes" hint="Short terms shown on the license card.">
                <textarea rows={2} value={profile.license_notes} onChange={set('license_notes')}
                  placeholder="e.g. 50/50 split on master and publishing. Stems sent on full payment."
                  className={`${areaCls} resize-none leading-relaxed`} />
              </Field>
              <Field label="Custom license agreement" hint="Full legal text shown to buyers at checkout.">
                <textarea rows={8} value={profile.license_agreement} onChange={set('license_agreement')}
                  placeholder={"This license grants the purchaser the right to use the beat in one (1) commercial release…\n\nAll rights to the master recording remain with the producer.\n\nThis license is non-exclusive unless otherwise stated."}
                  className={`${areaCls} resize-y font-mono leading-relaxed`} />
              </Field>
            </Section>

            {/* ── Contact & socials ────────────────────────────────── */}
            <Section title="Contact & socials" subtitle="Shown on your public page and share pages.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Contact email">
                  <IconInput icon={<Mail size={12} />}>
                    <input type="email" value={profile.contact_email} onChange={set('contact_email')}
                      placeholder="beats@yourname.com" className={`${inputCls} pl-8`} />
                  </IconInput>
                </Field>
                <Field label="Website">
                  <IconInput icon={<Globe size={12} />}>
                    <input type="url" value={profile.website_url} onChange={set('website_url')}
                      placeholder="https://yourname.com" className={`${inputCls} pl-8`} />
                  </IconInput>
                </Field>
                <Field label="Instagram">
                  <IconInput icon={<AtSign size={12} />}>
                    <input type="text" value={profile.instagram_handle} onChange={set('instagram_handle')}
                      placeholder="username or instagram.com/username" className={`${inputCls} pl-8`} />
                  </IconInput>
                </Field>
                <Field label="Twitter / X">
                  <IconInput icon={<AtSign size={12} />}>
                    <input type="text" value={profile.twitter_handle} onChange={set('twitter_handle')}
                      placeholder="username or x.com/username" className={`${inputCls} pl-8`} />
                  </IconInput>
                </Field>
                <Field label="Spotify">
                  <IconInput icon={<Music size={12} />}>
                    <input type="url" value={profile.spotify_url} onChange={set('spotify_url')}
                      placeholder="https://open.spotify.com/artist/…" className={`${inputCls} pl-8`} />
                  </IconInput>
                </Field>
                <Field label="SoundCloud">
                  <IconInput icon={<Music size={12} />}>
                    <input type="url" value={profile.soundcloud_url} onChange={set('soundcloud_url')}
                      placeholder="https://soundcloud.com/yourname" className={`${inputCls} pl-8`} />
                  </IconInput>
                </Field>
              </div>
            </Section>

            {/* ── Storefront theme ─────────────────────────────────── */}
            <Section title="Storefront theme" subtitle="Accent colour and type style on your public store.">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Field label="Accent colour" hint="Buttons, waveforms and highlights.">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label="Accent colour picker"
                      value={profile.accent_color || '#FFFFFF'}
                      onChange={set('accent_color')}
                      className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
                    />
                    <input
                      type="text"
                      aria-label="Accent colour hex"
                      value={profile.accent_color || '#FFFFFF'}
                      onChange={set('accent_color')}
                      placeholder="#FFFFFF"
                      maxLength={7}
                      className={`${inputCls} flex-1 font-mono uppercase`}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap">
                    {ACCENT_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setValue('accent_color', c)}
                        aria-label={c}
                        aria-pressed={profile.accent_color === c}
                        className="grid h-10 w-10 place-items-center rounded-lg transition-colors hover:bg-white/[0.06]"
                      >
                        <span
                          style={{ background: c }}
                          className={`h-6 w-6 rounded-full border-2 ${profile.accent_color === c ? 'border-white' : 'border-transparent'}`}
                        />
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Font style" hint="Typography for your public storefront.">
                  <div className="grid grid-cols-3 gap-2">
                    {/* The same three styles the storefront draws. `modern` and
                        `minimal` were offered here and mapped to nothing, so
                        they rendered as the default; a saved one reads as that. */}
                    {STORE_FONT_STYLES.map((s) => {
                      const active = normalizeFontStyle(profile.font_style) === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setValue('font_style', s)}
                          aria-pressed={active}
                          className={`h-10 rounded-lg border px-1 text-[10px] font-mono uppercase tracking-[0.2em] transition-colors ${
                            active
                              ? 'border-white/30 bg-white/[0.14] text-white'
                              : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10] hover:text-white'
                          }`}
                        >
                          {STORE_FONT_LABELS[s]}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
            </Section>

          </div>
        </div>
      </PageContainer>

      {/* ── Preview slide-over: what the public page shows, from the form as typed ── */}
      {showPreview && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={() => setShowPreview(false)}
          />
          <div
            ref={previewPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Preview of your public profile"
            tabIndex={-1}
            className="fixed right-0 top-0 bottom-0 z-50 flex w-full flex-col overflow-hidden border-l border-white/10 bg-[#090907] ui-drawer-right duration-300 focus:outline-none sm:w-[420px]"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Preview</p>
                <p className="mt-0.5 text-xs text-white/80">How your page reads</p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                aria-label="Close preview"
                className="grid h-10 w-10 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="rounded-xl border border-white/10 bg-[#0D0D0A] p-6 text-center">
                {profile.hero_image_url ? (
                  <div className="mx-auto h-20 w-20 overflow-hidden rounded-xl border border-white/10">
                    <img loading="lazy" src={profile.hero_image_url} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-white/20 bg-[#090907] text-white/40">
                    <User size={28} />
                  </div>
                )}
                <h4 className="mt-4 font-heading text-lg text-white">{profile.display_name || 'Your name'}</h4>
                <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Producer</p>
              </div>

              {profile.bio && (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Bio</p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/80">{profile.bio}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Lease</p>
                  <p className="mt-1 text-xl font-mono text-white">
                    {profile.license_lease_price_usd ? `$${profile.license_lease_price_usd}` : '—'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Exclusive</p>
                  <p className="mt-1 text-xl font-mono text-white">
                    {profile.license_exclusive_price_usd ? `$${profile.license_exclusive_price_usd}` : '—'}
                  </p>
                </div>
              </div>

              {profile.license_notes && (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Terms</p>
                  <p className="text-xs leading-relaxed text-white/80">{profile.license_notes}</p>
                </div>
              )}

              {creditLines.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Credits</p>
                  <ul className="space-y-1.5">
                    {creditLines.map((c, i) => (
                      <li key={i} className="text-xs leading-snug text-white/80">{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {previewLinks.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                  {profile.contact_email && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-mono text-white/60">
                      <Mail size={10} /> {profile.contact_email}
                    </span>
                  )}
                  {profile.instagram_handle && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-mono text-white/60">
                      <AtSign size={10} /> {profile.instagram_handle}
                    </span>
                  )}
                  {profile.twitter_handle && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-mono text-white/60">
                      <AtSign size={10} /> {profile.twitter_handle}
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
