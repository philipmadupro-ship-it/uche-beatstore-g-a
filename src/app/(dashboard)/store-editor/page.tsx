'use client';

/**
 * /store-editor — Dashboard-side WYSIWYG editor for the public /store page.
 *
 * Sections (each collapsible):
 *   1. Hero — display_name, bio, credits, hero_image_url, accent_color
 *   2. Social Links — instagram, twitter, spotify, soundcloud, website, email
 *   3. Featured Playlists — drag-to-reorder, toggle featured (max 5)
 *   4. Track Listing Controls — default prices, license_notes
 *
 * Live preview: a read-only sidebar component that mirrors the unsaved
 * form state in real time. On mobile it's behind a "Preview" toggle.
 *
 * Persistence: PATCH /api/profile for all profile fields;
 *              PATCH /api/playlists/[id] per playlist for store_featured + store_order.
 */

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Loader2, Save, ExternalLink, ChevronDown, ChevronRight,
  Image as ImageIcon, Upload, Globe,
  Music, ListMusic, DollarSign, Eye, EyeOff,
  GripVertical, Check, X, Plus, Layers, Search,
  ShoppingBag, Star, Tag, Trash2, Clock, Mic2, Play,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { DEFAULT_TEMPLATE_MD, VARIABLE_LIST } from '@/lib/contracts/license-template';
import { CARD_STYLE_META, VIDEO_STYLE_META } from '@/lib/share/styles';
import { LicenseBuilder } from '@/components/store/LicenseBuilder';

/* ─── Types ─────────────────────────────────────────────────── */

interface ProfileForm {
  display_name: string;
  bio: string;
  credits: string;
  hero_image_url: string;
  accent_color: string;
  font_style: string;
  text_color_primary: string;
  instagram_handle: string;
  twitter_handle: string;
  spotify_url: string;
  soundcloud_url: string;
  website_url: string;
  contact_email: string;
  license_lease_price_usd: string;
  license_exclusive_price_usd: string;
  license_notes: string;
  // Migration 077 — automatic bundle/quantity discount
  bundle_discount_threshold: string;
  bundle_discount_percent: string;
  // Migration 055 — storefront-root SEO + social share card
  seo_title: string;
  seo_description: string;
  og_image_url: string;
  // Migration 057 — per-producer license-agreement template
  license_template_md: string;
  // Migration 062 — share-card + 9:16 video template
  share_card_style: string;
  share_video_style: string;
  // Migration 072 — producer voice tag for store previews
  voice_tag_url: string;
  voice_tag_interval_seconds: string;
}

interface PlaylistRow {
  id: string;
  name: string;
  cover_url?: string | null;
  track_count: number;
  store_featured?: boolean;
  store_order?: number | null;
}

interface ProjectRow {
  id: string;
  name: string;
  cover_url?: string | null;
  price_usd?: number | null;
  store_featured?: boolean;
  store_order?: number | null;
}

const EMPTY_PROFILE: ProfileForm = {
  display_name: '',
  bio: '',
  credits: '',
  hero_image_url: '',
  accent_color: '#D4BFA0',
  font_style: 'default',
  text_color_primary: '#E8DCC8',
  instagram_handle: '',
  twitter_handle: '',
  spotify_url: '',
  soundcloud_url: '',
  website_url: '',
  contact_email: '',
  license_lease_price_usd: '',
  license_exclusive_price_usd: '',
  license_notes: '',
  bundle_discount_threshold: '',
  bundle_discount_percent: '',
  seo_title: '',
  seo_description: '',
  og_image_url: '',
  license_template_md: '',
  share_card_style: '',
  share_video_style: '',
  voice_tag_url: '',
  voice_tag_interval_seconds: '20',
};

const ACCENT_PRESETS = [
  '#D4BFA0', '#7F77DD', '#6DC6A4', '#E8C47A',
  '#C47A7A', '#7AC4E8', '#B07AE8',
];

/* ─── Accordion section ──────────────────────────────────────── */

function Section({
  id, title, icon, open, onToggle, children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[#a08a6a]">{icon}</span>
          <span className="text-[13px] font-semibold text-[#E8DCC8]">{title}</span>
        </div>
        {open
          ? <ChevronDown size={15} className="text-[#5a5142]" />
          : <ChevronRight size={15} className="text-[#5a5142]" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-[#1a160f] space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Field helpers ──────────────────────────────────────────── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] block mb-1.5">
      {children}
    </label>
  );
}

/**
 * Markdown editor for the producer's license-contract template.
 * Click any variable chip to insert {{key}} at the cursor. Hit
 * "Use default" to populate with the system template — useful as
 * a starting point or to recover if the producer wiped their copy.
 * Preview toggles between the raw template and a sample-filled
 * version using a fake buyer so producers can sanity-check the
 * substitution.
 */
function LicenseTemplateEditor({
  value,
  onChange,
}: { value: string; onChange: (v: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [preview, setPreview] = useState(false);

  const insertVar = (key: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange((value ?? '') + ` {{${key}}}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}{{${key}}}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + `{{${key}}}`.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const filledPreview = (() => {
    const sample = Object.fromEntries(VARIABLE_LIST.map((v) => [v.key, v.sample])) as Record<string, string>;
    const tpl = (value && value.trim()) || DEFAULT_TEMPLATE_MD;
    return tpl.replace(/\{\{([a-z_]+)\}\}/g, (m, k) => sample[k] ?? m);
  })();

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[#5a5142]">
        Filled in at every purchase and attached as a PDF to the delivery email. Markdown supported (# heading, ** bold **, - bullet). Leave empty to use the default template.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {VARIABLE_LIST.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => insertVar(v.key)}
            title={`Insert {{${v.key}}} — sample: ${v.sample}`}
            className="px-2 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] border border-[#1f1a13] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#2d2620] transition-colors"
          >
            +{v.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TEMPLATE_MD)}
          className="ml-auto px-3 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] border border-[#2d2620] text-[#a08a6a] hover:text-[#E8DCC8] transition-colors"
        >
          Use default
        </button>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="px-3 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider border transition-colors"
          style={preview
            ? { backgroundColor: '#D4BFA0', color: '#000', borderColor: '#D4BFA0' }
            : { backgroundColor: 'transparent', color: '#a08a6a', borderColor: '#2d2620' }}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {preview ? (
        <pre className="bg-[#0a0907] border border-[#1f1a13] rounded-lg p-4 text-[12px] text-[#E8DCC8] leading-relaxed whitespace-pre-wrap font-sans max-h-[480px] overflow-auto">
          {filledPreview}
        </pre>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={20}
          placeholder="Leave empty to use the default template."
          className={`${textareaCls} font-mono text-[11px] leading-relaxed`}
        />
      )}
    </div>
  );
}

/**
 * Visual style picker for the IG share card (1080×1920) and the 9:16
 * vertical preview. Renders one thumbnail per style using a real track
 * from the producer's catalogue so what they see is what buyers get.
 */
function ShareStylePicker({
  kind, value, onChange, tracks,
}: {
  kind: 'card' | 'video';
  value: string;
  onChange: (v: string) => void;
  tracks: TrackRow[];
}) {
  const sampleTrack = tracks.find((t) => t.store_listed) ?? tracks[0];
  const styles = kind === 'card' ? CARD_STYLE_META : VIDEO_STYLE_META;

  return (
    <div className="mb-6 last:mb-0">
      <div className="flex items-center justify-between mb-3">
        <Label>{kind === 'card' ? 'IG share card (1080×1920)' : '9:16 vertical preview'}</Label>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] hover:text-[#a08a6a]"
          >
            Use default
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {styles.map((s) => {
          const active = (value || (kind === 'card' ? 'minimal' : 'vinyl')) === s.id;
          const thumbUrl = kind === 'card' && sampleTrack
            ? `/api/store/share-card?track_id=${sampleTrack.id}&style=${s.id}&kind=playing`
            : null;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id)}
              title={s.description}
              className={`relative rounded-xl overflow-hidden border-2 transition-all text-left ${
                active ? 'border-[#D4BFA0]' : 'border-[#1f1a13] hover:border-[#2d2620]'
              }`}
            >
              <div className="aspect-[9/16] bg-[#0a0907] overflow-hidden">
                {thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#3a3328] text-[10px] font-mono uppercase tracking-wider">
                    {s.label}
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5 bg-[#14110d]">
                <p className="text-[11px] font-medium text-[#E8DCC8]">{s.label}</p>
                <p className="text-[9px] text-[#5a5142] leading-tight line-clamp-2">{s.description}</p>
              </div>
              {active && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#D4BFA0] text-black text-[10px] flex items-center justify-center font-bold">✓</span>
              )}
            </button>
          );
        })}
      </div>
      {!sampleTrack && kind === 'card' && (
        <p className="mt-2 text-[10px] text-[#3a3328] font-mono">
          List a beat to see real previews.
        </p>
      )}
    </div>
  );
}

function BackfillPeaksButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ succeeded: number; failed: number; total_needed: number } | null>(null);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/tracks/peaks/backfill-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
      if (data.total_needed === 0) {
        toast.success('All tracks already have peaks');
      } else if (data.failed === 0) {
        toast.success(`Regenerated ${data.succeeded} waveforms`);
      } else {
        toast.warning(`${data.succeeded}/${data.total_needed} done`, `${data.failed} failed`);
      }
    } catch (err: any) {
      toast.error('Backfill failed', err?.message ?? 'try again');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#D4BFA0] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#E8D8B8] transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Music size={12} />}
        {busy ? 'Regenerating…' : 'Regenerate all waveforms'}
      </button>
      {result && (
        <p className="text-[11px] text-[#a08a6a]">
          {result.total_needed === 0
            ? 'Nothing needed — every track already has its peaks.'
            : `${result.succeeded}/${result.total_needed} succeeded${result.failed > 0 ? ` · ${result.failed} failed` : ''}.`}
        </p>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {hint && (
        <p className="-mt-1 mb-1.5 text-[10px] text-[#5a5142]">{hint}</p>
      )}
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-[#0c0a08] border border-[#1f1a13] rounded-lg px-3 py-2 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors';
const textareaCls = `${inputCls} resize-none leading-relaxed`;

/* ─── Live preview ───────────────────────────────────────────── */

interface PreviewTrack {
  id: string;
  title: string;
  type: string;
  cover_url: string | null;
  bpm: number | null;
}

interface TrackRow {
  id: string;
  title: string;
  type: string;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  store_listed: boolean;
  store_featured: boolean;
  store_sort_order: number | null;
  lease_price_usd: number | null;
  exclusive_price_usd: number | null;
  voice_tag_enabled: boolean;
  // Migration 056 — when set on a draft, the cron flips
  // store_listed=true at that time and clears this field.
  scheduled_publish_at: string | null;
}

function StorePreview({
  profile,
  featuredPlaylists,
  featuredProjects,
  tracks,
}: {
  profile: ProfileForm;
  featuredPlaylists: PlaylistRow[];
  featuredProjects: ProjectRow[];
  tracks: PreviewTrack[];
}) {
  const accent = profile.accent_color || '#D4BFA0';

  // Social link presence badges (bottom of preview)
  const socialLinks = [
    profile.instagram_handle && { label: 'IG', value: `@${profile.instagram_handle.replace(/^@/, '')}` },
    profile.twitter_handle   && { label: 'X',  value: `@${profile.twitter_handle.replace(/^@/, '')}` },
    profile.spotify_url      && { label: 'Spotify', value: '↗' },
    profile.soundcloud_url   && { label: 'SoundCloud', value: '↗' },
    profile.website_url      && { label: 'Site', value: '↗' },
    profile.contact_email    && { label: 'Email', value: profile.contact_email },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div
      className="rounded-2xl overflow-hidden border border-[#1f1a13] bg-[#0a0907] text-[#E8DCC8]"
      style={{ '--store-accent': accent } as React.CSSProperties}
    >
      {/* Hero strip */}
      <div className="relative min-h-[140px] flex flex-col justify-end p-5">
        {profile.hero_image_url ? (
          <img
            src={profile.hero_image_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-40"
          />
        ) : (
          <div
            className="absolute inset-0 opacity-25"
            style={{ background: `radial-gradient(ellipse at 30% 50%, ${accent} 0%, transparent 65%)` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0907]/90 to-transparent" />
        <div className="relative z-10">
          <p className="text-[8px] font-mono uppercase tracking-widest mb-1" style={{ color: accent }}>
            {profile.credits || 'Beat store'}
          </p>
          <h2
            className={`text-[20px] font-black uppercase tracking-tight text-white leading-none ${
              profile.font_style === 'serif' ? 'font-serif' : ''
            }`}
          >
            {profile.display_name || 'Your Name'}
          </h2>
          {profile.bio && (
            <p className="text-[10px] text-[#a08a6a] mt-1.5 leading-relaxed line-clamp-2">
              {profile.bio}
            </p>
          )}
        </div>
      </div>

      {/* Featured playlists */}
      {featuredPlaylists.length > 0 && (
        <div className="px-4 py-3 border-t border-[#1a160f]">
          <p className="text-[8px] font-mono uppercase tracking-widest text-[#5a5142] mb-2">Featured Playlists</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {featuredPlaylists.map((pl) => (
              <div key={pl.id} className="shrink-0 w-14">
                <div className="w-14 h-14 rounded-lg bg-[#1a160f] border border-[#2d2620] overflow-hidden flex items-center justify-center mb-1">
                  {pl.cover_url
                    ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                    : <ListMusic size={14} className="text-[#3a3328]" />}
                </div>
                <p className="text-[7px] text-[#6a5d4a] truncate leading-tight">{pl.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Featured projects — bundle tiles with their price */}
      {featuredProjects.length > 0 && (
        <div className="px-4 py-3 border-t border-[#1a160f]">
          <p className="text-[8px] font-mono uppercase tracking-widest text-[#5a5142] mb-2">Featured Projects</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {featuredProjects.map((pr) => (
              <div key={pr.id} className="shrink-0 w-14">
                <div className="w-14 h-14 rounded-lg bg-[#1a160f] border border-[#2d2620] overflow-hidden flex items-center justify-center mb-1 relative">
                  {pr.cover_url
                    ? <img src={pr.cover_url} alt="" className="w-full h-full object-cover" />
                    : <Layers size={14} className="text-[#3a3328]" />}
                  {pr.price_usd != null && Number(pr.price_usd) > 0 && (
                    <span
                      className="absolute bottom-0 left-0 right-0 text-[7px] font-mono font-bold py-0.5 text-center text-black"
                      style={{ backgroundColor: accent }}
                    >
                      ${pr.price_usd}
                    </span>
                  )}
                </div>
                <p className="text-[7px] text-[#6a5d4a] truncate leading-tight">{pr.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Beat grid — real published tracks */}
      <div className="px-4 py-3 border-t border-[#1a160f]">
        <p className="text-[8px] font-mono uppercase tracking-widest text-[#5a5142] mb-2">
          Beats ({tracks.length} published)
        </p>
        {tracks.length > 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            {tracks.slice(0, 6).map((t) => (
              <div key={t.id} className="aspect-square rounded-lg bg-[#1a160f] border border-[#1f1a13] overflow-hidden flex items-center justify-center relative">
                {t.cover_url
                  ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                  : <Music size={12} className="text-[#2d2620]" />}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="aspect-square rounded-lg bg-[#1a160f] border border-dashed border-[#1f1a13] flex items-center justify-center">
                <Music size={10} className="text-[#1f1a13]" />
              </div>
            ))}
          </div>
        )}
        {tracks.length === 0 && (
          <p className="text-[8px] text-[#3a3328] mt-1.5 font-mono">
            List beats in store to see them here.
          </p>
        )}
      </div>

      {/* Social links at bottom */}
      {socialLinks.length > 0 && (
        <div className="px-4 py-3 border-t border-[#1a160f]">
          <p className="text-[8px] font-mono uppercase tracking-widest text-[#5a5142] mb-2">Links</p>
          <div className="flex flex-wrap gap-1.5">
            {socialLinks.map(({ label, value }) => (
              <span key={label} className="text-[8px] font-mono text-[#6a5d4a] bg-white/[0.03] border border-[#1f1a13] px-2 py-0.5 rounded">
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function StoreEditorPage() {
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [featured, setFeatured] = useState<PlaylistRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [featuredProjects, setFeaturedProjects] = useState<ProjectRow[]>([]);
  const [previewTracks, setPreviewTracks] = useState<PreviewTrack[]>([]);
  const [allTracks, setAllTracks] = useState<TrackRow[]>([]);
  const [trackSearch, setTrackSearch] = useState('');
  const [togglingTrack, setTogglingTrack] = useState<string | null>(null);

  /* Promo codes (mig 047) */
  interface PromoCode {
    code: string;
    discount_percent: number;
    discount_amount: number;
    max_uses: number | null;
    uses_count: number;
    active: boolean;
    expires_at: string | null;
    created_at: string;
  }
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [promoForm, setPromoForm] = useState({
    code: '',
    kind: 'percent' as 'percent' | 'amount',
    value: '',
    max_uses: '',
    expires_at: '',
  });
  const [promoCreating, setPromoCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [heroUploading, setHeroUploading] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(['hero', 'social', 'playlists', 'projects', 'tracks', 'track-controls', 'licenses']),
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  const heroFileRef = useRef<HTMLInputElement>(null);

  // Drag state for playlist reorder
  const dragIdx = useRef<number | null>(null);
  // Drag state for project reorder
  const projectDragIdx = useRef<number | null>(null);

  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const set = useCallback(
    (field: keyof ProfileForm) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setForm((f) => ({ ...f, [field]: e.target.value })),
    [],
  );

  /* ── Load ── */
  useEffect(() => {
    (async () => {
      try {
        const [profileRes, playlistRes, storeRes, tracksRes, projectsRes, promoRes] = await Promise.all([
          fetch('/api/profile'),
          fetch('/api/playlists'),
          fetch('/api/store'),
          fetch('/api/tracks'),
          fetch('/api/projects'),
          fetch('/api/promo-codes'),
        ]);
        const [pd, pld, sd, td, prd, promod] = await Promise.all([
          profileRes.json(), playlistRes.json(), storeRes.json(), tracksRes.json(), projectsRes.json(), promoRes.json(),
        ]);
        setPromoCodes(promod.codes ?? []);
        // Real published beats for the live preview
        setPreviewTracks((sd.tracks ?? []).slice(0, 6) as PreviewTrack[]);

        // All tracks for the listing manager (array response from /api/tracks)
        const rawTracks: TrackRow[] = Array.isArray(td)
          ? td.map((t: any) => ({
              id: t.id,
              title: t.title,
              type: t.type,
              cover_url: t.cover_url ?? null,
              bpm: t.bpm ?? null,
              key: t.key ?? null,
              store_listed: !!t.store_listed,
              store_featured: !!t.store_featured,
              store_sort_order: t.store_sort_order ?? null,
              scheduled_publish_at: t.scheduled_publish_at ?? null,
              lease_price_usd: t.lease_price_usd ?? null,
              exclusive_price_usd: t.exclusive_price_usd ?? null,
              voice_tag_enabled: !!t.voice_tag_enabled,
            }))
          : [];
        setAllTracks(rawTracks.sort((a, b) => {
          // Listed first (by sort order), then unlisted alphabetically
          if (a.store_listed && !b.store_listed) return -1;
          if (!a.store_listed && b.store_listed) return 1;
          if (a.store_sort_order != null && b.store_sort_order != null) return a.store_sort_order - b.store_sort_order;
          return a.title.localeCompare(b.title);
        }));
        const p = pd.profile ?? {};
        setForm({
          display_name: p.display_name ?? '',
          bio: p.bio ?? '',
          credits: p.credits ?? '',
          hero_image_url: p.hero_image_url ?? '',
          accent_color: p.accent_color ?? '#D4BFA0',
          font_style: p.font_style ?? 'default',
          text_color_primary: p.text_color_primary ?? '#E8DCC8',
          instagram_handle: p.instagram_handle ?? '',
          twitter_handle: p.twitter_handle ?? '',
          spotify_url: p.spotify_url ?? '',
          soundcloud_url: p.soundcloud_url ?? '',
          website_url: p.website_url ?? '',
          contact_email: p.contact_email ?? '',
          license_lease_price_usd: p.license_lease_price_usd != null ? String(p.license_lease_price_usd) : '',
          license_exclusive_price_usd: p.license_exclusive_price_usd != null ? String(p.license_exclusive_price_usd) : '',
          license_notes: p.license_notes ?? '',
          bundle_discount_threshold: p.bundle_discount_threshold ? String(p.bundle_discount_threshold) : '',
          bundle_discount_percent: p.bundle_discount_percent ? String(p.bundle_discount_percent) : '',
          seo_title: p.seo_title ?? '',
          seo_description: p.seo_description ?? '',
          og_image_url: p.og_image_url ?? '',
          license_template_md: p.license_template_md ?? '',
          share_card_style: p.share_card_style ?? '',
          share_video_style: p.share_video_style ?? '',
          voice_tag_url: p.voice_tag_url ?? '',
          voice_tag_interval_seconds: String(p.voice_tag_interval_seconds ?? 20),
        });

        const allPlaylists: PlaylistRow[] = pld.playlists ?? [];
        setPlaylists(allPlaylists);

        // Build featured list: playlists with store_featured=true, sorted by store_order
        const feat = allPlaylists
          .filter((pl) => pl.store_featured)
          .sort((a, b) => (a.store_order ?? 999) - (b.store_order ?? 999));
        setFeatured(feat);

        const allProjects: ProjectRow[] = (prd.projects ?? []).map((p: any) => ({
          id: p.id,
          name: p.name,
          cover_url: p.cover_url ?? null,
          price_usd: p.price_usd ?? null,
          store_featured: !!p.store_featured,
          store_order: p.store_order ?? null,
        }));
        setProjects(allProjects);
        const featProjects = allProjects
          .filter((p) => p.store_featured)
          .sort((a, b) => (a.store_order ?? 999) - (b.store_order ?? 999));
        setFeaturedProjects(featProjects);
      } catch {
        toast.error('Failed to load store settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ── Hero image upload ── */
  const handleHeroUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHeroUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setForm((f) => ({ ...f, hero_image_url: data.url }));
      toast.success('Hero image uploaded');
    } catch (err: any) {
      toast.error('Upload failed', err.message);
    } finally {
      setHeroUploading(false);
      if (heroFileRef.current) heroFileRef.current.value = '';
    }
  };

  /* ── Featured playlist helpers ── */
  const addToFeatured = (pl: PlaylistRow) => {
    if (featured.length >= 5) {
      toast.error('Max 5 featured playlists');
      return;
    }
    if (featured.find((f) => f.id === pl.id)) return;
    setFeatured((prev) => [...prev, pl]);
  };

  const removeFromFeatured = (id: string) =>
    setFeatured((prev) => prev.filter((f) => f.id !== id));

  /* HTML5 drag-and-drop for featured list */
  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = dragIdx.current;
    if (from == null || from === idx) return;
    setFeatured((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(idx, 0, item);
      dragIdx.current = idx;
      return next;
    });
  };
  const handleDragEnd = () => { dragIdx.current = null; };

  /* ── Featured project helpers ── */
  const addProjectToFeatured = (pr: ProjectRow) => {
    if (featuredProjects.length >= 5) {
      toast.error('Max 5 featured projects');
      return;
    }
    if (featuredProjects.find((f) => f.id === pr.id)) return;
    setFeaturedProjects((prev) => [...prev, pr]);
  };

  const removeProjectFromFeatured = (id: string) =>
    setFeaturedProjects((prev) => prev.filter((f) => f.id !== id));

  const handleProjectDragStart = (idx: number) => { projectDragIdx.current = idx; };
  const handleProjectDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = projectDragIdx.current;
    if (from == null || from === idx) return;
    setFeaturedProjects((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(idx, 0, item);
      projectDragIdx.current = idx;
      return next;
    });
  };
  const handleProjectDragEnd = () => { projectDragIdx.current = null; };

  /* ── Drag-reorder for listed beats (writes tracks.store_sort_order) ──
     Only the live (store_listed=true) rows are draggable. Drafts keep
     their position. After a drag ends, we PATCH every reordered row
     with a 0-based store_sort_order so /store picks them up. */
  const trackDragIdx = useRef<number | null>(null);
  const handleTrackDragStart = (idx: number) => { trackDragIdx.current = idx; };
  const handleTrackDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = trackDragIdx.current;
    if (from == null || from === idx) return;
    setAllTracks((prev) => {
      // Only reorder within the listed-track subset visible at top of the list.
      const listed = prev.filter((t) => t.store_listed);
      const drafts = prev.filter((t) => !t.store_listed);
      if (from >= listed.length || idx >= listed.length) return prev;
      const next = [...listed];
      const [item] = next.splice(from, 1);
      next.splice(idx, 0, item);
      trackDragIdx.current = idx;
      return [
        ...next.map((t, i) => ({ ...t, store_sort_order: i })),
        ...drafts,
      ];
    });
  };
  const handleTrackDragEnd = async () => {
    const idx = trackDragIdx.current;
    trackDragIdx.current = null;
    if (idx == null) return;
    // Persist the new order. We send a small PATCH per row — listed
    // beats only — so the store_sort_order column on /store is the
    // single source of truth.
    const listed = allTracks.filter((t) => t.store_listed);
    try {
      await Promise.all(
        listed.map((t) =>
          fetch(`/api/tracks/${t.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store_sort_order: t.store_sort_order }),
          }),
        ),
      );
      toast.success('Beat order saved');
    } catch (err: any) {
      toast.error('Order save failed', err?.message ?? 'try again');
    }
  };

  /* ── Track listing toggle ── */
  const toggleTrackListed = async (trackId: string, currentlyListed: boolean) => {
    setTogglingTrack(trackId);
    const nextState = !currentlyListed;
    // Optimistic update
    setAllTracks((prev) =>
      prev.map((t) => t.id === trackId ? { ...t, store_listed: nextState } : t),
    );
    // Update preview tracks
    setPreviewTracks((prev) => {
      if (!nextState) return prev.filter((t) => t.id !== trackId);
      // Don't add back — just re-fetch on save
      return prev;
    });
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_listed: nextState }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      toast.success(nextState ? 'Added to store ✓' : 'Removed from store');
      // Followers are notified by the hourly digest cron (one email covering
      // everything newly listed) instead of one email per beat — so listing a
      // batch never spams. drop_notified_at (NULL = pending) is the queue;
      // the cron stamps it after the digest sends.
    } catch (err: any) {
      // Rollback
      setAllTracks((prev) =>
        prev.map((t) => t.id === trackId ? { ...t, store_listed: currentlyListed } : t),
      );
      toast.error('Failed to update', err.message);
    } finally {
      setTogglingTrack(null);
    }
  };

  /* ── Track featured toggle (migration 054) ── */
  const toggleTrackFeatured = async (trackId: string, currentlyFeatured: boolean) => {
    const nextState = !currentlyFeatured;
    // Optimistic
    setAllTracks((prev) =>
      prev.map((t) => t.id === trackId ? { ...t, store_featured: nextState } : t),
    );
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_featured: nextState }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      toast.success(nextState ? "Pinned to Producer's Picks" : "Removed from picks");
    } catch (err: any) {
      // Rollback
      setAllTracks((prev) =>
        prev.map((t) => t.id === trackId ? { ...t, store_featured: currentlyFeatured } : t),
      );
      toast.error('Failed to update', err.message);
    }
  };

  /* ── Voice-tag toggle (per beat) ── */
  const toggleTrackTag = async (trackId: string, currentlyOn: boolean) => {
    const nextState = !currentlyOn;
    setAllTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, voice_tag_enabled: nextState } : t));
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_tag_enabled: nextState }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      toast.success(nextState ? 'Voice tag on for this beat' : 'Voice tag off');
    } catch (err: any) {
      setAllTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, voice_tag_enabled: currentlyOn } : t));
      toast.error('Failed to update', err.message);
    }
  };

  /* ── Scheduled-publish action ──
     Drafts can be given a future timestamp. The cron route at
     /api/cron/publish-scheduled flips them live when due. */
  const [scheduleOpenFor, setScheduleOpenFor] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<string>('');
  const setSchedule = async (trackId: string, isoOrNull: string | null) => {
    const prev = allTracks;
    setAllTracks((p) => p.map((t) => t.id === trackId ? { ...t, scheduled_publish_at: isoOrNull } : t));
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_publish_at: isoOrNull }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(isoOrNull ? 'Scheduled' : 'Schedule cleared');
    } catch (err: any) {
      setAllTracks(prev);
      toast.error('Could not schedule', err?.message ?? 'try again');
    }
  };

  /* ── Promo code actions ── */
  const createPromoCode = async () => {
    if (!promoForm.code.trim()) {
      toast.error('Pick a code');
      return;
    }
    const value = parseFloat(promoForm.value);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Set a positive discount');
      return;
    }
    setPromoCreating(true);
    try {
      const body: Record<string, unknown> = {
        code: promoForm.code.trim().toUpperCase(),
        [promoForm.kind === 'percent' ? 'discount_percent' : 'discount_amount']: value,
      };
      if (promoForm.max_uses) body.max_uses = parseInt(promoForm.max_uses, 10);
      if (promoForm.expires_at) body.expires_at = new Date(promoForm.expires_at).toISOString();
      const res = await fetch('/api/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPromoCodes((prev) => [data.code, ...prev]);
      setPromoForm({ code: '', kind: 'percent', value: '', max_uses: '', expires_at: '' });
      toast.success(`Code ${data.code.code} created`);
    } catch (err: any) {
      toast.error('Could not create code', err?.message ?? 'try again');
    } finally {
      setPromoCreating(false);
    }
  };
  const togglePromoActive = async (code: string, nextActive: boolean) => {
    // optimistic
    setPromoCodes((prev) => prev.map((c) => c.code === code ? { ...c, active: nextActive } : c));
    try {
      const res = await fetch(`/api/promo-codes/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: nextActive }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setPromoCodes((prev) => prev.map((c) => c.code === code ? { ...c, active: !nextActive } : c));
      toast.error('Could not update', err?.message ?? 'try again');
    }
  };
  const deletePromoCode = async (code: string) => {
    if (!confirm(`Delete promo code "${code}"? This can't be undone.`)) return;
    const prev = promoCodes;
    setPromoCodes((p) => p.filter((c) => c.code !== code));
    try {
      const res = await fetch(`/api/promo-codes/${encodeURIComponent(code)}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Deleted ${code}`);
    } catch (err: any) {
      setPromoCodes(prev);
      toast.error('Could not delete', err?.message ?? 'try again');
    }
  };

  /* ── Save ── */
  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Profile fields
      const profilePayload = {
        display_name: form.display_name || null,
        bio: form.bio || null,
        credits: form.credits || null,
        hero_image_url: form.hero_image_url || null,
        accent_color: form.accent_color || '#D4BFA0',
        font_style: form.font_style || 'default',
        text_color_primary: form.text_color_primary || '#E8DCC8',
        instagram_handle: form.instagram_handle || null,
        twitter_handle: form.twitter_handle || null,
        spotify_url: form.spotify_url || null,
        soundcloud_url: form.soundcloud_url || null,
        website_url: form.website_url || null,
        contact_email: form.contact_email || null,
        license_lease_price_usd: form.license_lease_price_usd !== '' ? parseFloat(form.license_lease_price_usd) : null,
        license_exclusive_price_usd: form.license_exclusive_price_usd !== '' ? parseFloat(form.license_exclusive_price_usd) : null,
        license_notes: form.license_notes || null,
        bundle_discount_threshold: form.bundle_discount_threshold !== '' ? parseInt(form.bundle_discount_threshold, 10) : 0,
        bundle_discount_percent: form.bundle_discount_percent !== '' ? parseFloat(form.bundle_discount_percent) : 0,
        seo_title: form.seo_title || null,
        seo_description: form.seo_description || null,
        og_image_url: form.og_image_url || null,
        license_template_md: form.license_template_md || null,
        share_card_style: form.share_card_style || null,
        share_video_style: form.share_video_style || null,
        voice_tag_url: form.voice_tag_url || null,
        voice_tag_interval_seconds: Number(form.voice_tag_interval_seconds) || 20,
      };

      const profileRes = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profilePayload),
      });
      if (!profileRes.ok) {
        const j = await profileRes.json().catch(() => ({}));
        throw new Error(j.error || `Profile save failed (HTTP ${profileRes.status})`);
      }

      // 2. Persist each featured playlist's order + featured flag
      const featuredIds = new Set(featured.map((f) => f.id));
      const patchOps: Array<{ id: string; body: Record<string, unknown> }> = [
        // Featured in order
        ...featured.map((pl, i) => ({ id: pl.id, body: { store_featured: true, store_order: i } })),
        // Un-featured (was featured before, no longer in list)
        ...playlists
          .filter((pl) => pl.store_featured && !featuredIds.has(pl.id))
          .map((pl) => ({ id: pl.id, body: { store_featured: false, store_order: null } })),
      ];
      const responses = await Promise.all(
        patchOps.map(({ id, body }) =>
          fetch(`/api/playlists/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
      );
      const failed = responses.filter((r) => !r.ok).length;
      if (failed > 0) {
        // Surface any error detail from the first failed response
        const firstFailed = responses.find((r) => !r.ok)!;
        const detail = await firstFailed.json().catch(() => ({}));
        toast.warning('Store saved', `${failed} playlist update(s) failed: ${detail.error ?? `HTTP ${firstFailed.status}`}`);
      } else {
        toast.success('Store updated');
      }

      // Update local playlist state so re-saves are idempotent
      setPlaylists((prev) =>
        prev.map((pl) => ({
          ...pl,
          store_featured: featuredIds.has(pl.id),
          store_order: featured.findIndex((f) => f.id === pl.id),
        })),
      );

      // 3. Persist each featured project's order + featured flag (resilient per-call, allSettled, refetch on partial failure)
      const featuredProjectIds = new Set(featuredProjects.map((f) => f.id));
      const projectPatchOps: Array<{ id: string; body: Record<string, unknown> }> = [
        ...featuredProjects.map((pr, i) => ({ id: pr.id, body: { store_featured: true, store_order: i } })),
        ...projects
          .filter((pr) => pr.store_featured && !featuredProjectIds.has(pr.id))
          .map((pr) => ({ id: pr.id, body: { store_featured: false, store_order: null } })),
      ];
      let projectFailed = 0;
      if (projectPatchOps.length > 0) {
        const projectResults = await Promise.allSettled(
          projectPatchOps.map(async ({ id, body }) => {
            try {
              const res = await fetch(`/api/projects/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                return { ok: false, status: res.status, error: j.error || `HTTP ${res.status}` };
              }
              return { ok: true };
            } catch (err: any) {
              return { ok: false, error: err?.message || 'Network error' };
            }
          }),
        );
        projectFailed = projectResults.filter((r) => r.status !== 'fulfilled' || !r.value.ok).length;
        const succeeded = projectPatchOps.length - projectFailed;
        if (projectFailed > 0) {
          toast.warning('Store saved', `${succeeded}/${projectPatchOps.length} project updates succeeded, ${projectFailed} failed`);
        }
      }

      // Update local project state so re-saves are idempotent; refetch on any failure to keep truth
      if (projectFailed > 0) {
        try {
          const prRes = await fetch('/api/projects');
          const prd = await prRes.json();
          const allP: ProjectRow[] = (prd.projects ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            cover_url: p.cover_url ?? null,
            price_usd: p.price_usd ?? null,
            store_featured: !!p.store_featured,
            store_order: p.store_order ?? null,
          }));
          setProjects(allP);
          const featP = allP
            .filter((p) => p.store_featured)
            .sort((a, b) => (a.store_order ?? 999) - (b.store_order ?? 999));
          setFeaturedProjects(featP);
        } catch {}
      } else {
        setProjects((prev) =>
          prev.map((pr) => ({
            ...pr,
            store_featured: featuredProjectIds.has(pr.id),
            store_order: featuredProjects.findIndex((f) => f.id === pr.id),
          })),
        );
      }
    } catch (err: any) {
      toast.error('Save failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── unfeatured playlists (available to add) ── */
  const unfeatured = playlists.filter((pl) => !featured.find((f) => f.id === pl.id));
  /* ── unfeatured projects (available to add) ── */
  const unfeaturedProjects = projects.filter((pr) => !featuredProjects.find((f) => f.id === pr.id));

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 size={20} className="animate-spin text-[#4a4338]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-10 pb-32">

        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-1">Dashboard</p>
            <h1 className="text-[28px] sm:text-[36px] font-bold tracking-tight text-white leading-none font-heading">
              Store Editor
            </h1>
            <p className="text-[12px] text-[#6a5d4a] mt-1.5">
              Customise your public beatstore — changes go live instantly on save.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {/* Mobile preview toggle */}
            <button
              onClick={() => setPreviewOpen((v) => !v)}
              className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-[#a08a6a] hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              {previewOpen ? <EyeOff size={12} /> : <Eye size={12} />}
              Preview
            </button>
            <a
              href="/store"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-[#a08a6a] hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <ExternalLink size={12} />
              View Store
            </a>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-[#D4BFA0] hover:bg-[#E8D8B8] disabled:opacity-60 text-black text-[12px] font-semibold transition-all"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* ── Two-column layout ── */}
        <div className="flex gap-6 lg:gap-8 items-start">

          {/* ── Left: editor panels ── */}
          <div className={`flex-1 min-w-0 space-y-3 ${previewOpen ? 'hidden lg:block' : ''}`}>

            {/* ① Hero Section */}
            <Section
              id="hero"
              title="Hero Section"
              icon={<ImageIcon size={15} />}
              open={openSections.has('hero')}
              onToggle={() => toggleSection('hero')}
            >
              {/* Hero image */}
              <Field label="Hero Background Image">
                <div className="flex items-start gap-3">
                  <div
                    className="w-24 h-16 rounded-lg border border-[#1f1a13] overflow-hidden bg-[#0c0a08] shrink-0 cursor-pointer hover:border-[#D4BFA0]/40 transition-colors relative group"
                    onClick={() => heroFileRef.current?.click()}
                  >
                    {form.hero_image_url ? (
                      <img src={form.hero_image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                        <ImageIcon size={18} />
                      </div>
                    )}
                    {heroUploading ? (
                      <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                        <Loader2 size={14} className="animate-spin text-[#D4BFA0]" />
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Upload size={12} className="text-white" />
                      </div>
                    )}
                  </div>
                  <input
                    ref={heroFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleHeroUpload}
                  />
                  <div className="flex-1 min-w-0">
                    <input
                      type="url"
                      value={form.hero_image_url}
                      onChange={set('hero_image_url')}
                      placeholder="Paste image URL or click thumbnail to upload…"
                      className={inputCls}
                    />
                    <p className="text-[9px] font-mono text-[#3a3328] mt-1">
                      Recommended: 1600×900px JPEG. Used as full-bleed hero background.
                    </p>
                  </div>
                </div>
              </Field>

              {/* Display name */}
              <Field label="Display Name">
                <input
                  type="text"
                  value={form.display_name}
                  onChange={set('display_name')}
                  placeholder="e.g. Uche Beats"
                  maxLength={80}
                  className={inputCls}
                />
              </Field>

              {/* Bio */}
              <Field label={`Bio (${form.bio.length}/280)`}>
                <textarea
                  value={form.bio}
                  onChange={set('bio')}
                  maxLength={280}
                  rows={3}
                  placeholder="Tell artists what you're about…"
                  className={textareaCls}
                />
              </Field>

              {/* Credits */}
              <Field label="Credits Line">
                <input
                  type="text"
                  value={form.credits}
                  onChange={set('credits')}
                  placeholder='e.g. "Produced by Uche"'
                  maxLength={120}
                  className={inputCls}
                />
              </Field>

              {/* Accent color */}
              <Field label="Accent Color">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 bg-[#0c0a08] border border-[#1f1a13] rounded-lg px-3 py-1.5">
                    <input
                      type="color"
                      value={form.accent_color}
                      onChange={set('accent_color')}
                      className="w-6 h-6 rounded cursor-pointer border-none bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={form.accent_color}
                      onChange={set('accent_color')}
                      maxLength={7}
                      placeholder="#D4BFA0"
                      className="w-20 bg-transparent text-[12px] text-[#E8DCC8] focus:outline-none font-mono"
                    />
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {ACCENT_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, accent_color: c }))}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          form.accent_color === c ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                        }`}
                        style={{ background: c }}
                        title={c}
                      />
                    ))}
                  </div>
                  {/* Live swatch */}
                  <div
                    className="px-3 py-1 rounded-full text-[10px] font-mono font-bold text-black"
                    style={{ background: form.accent_color }}
                  >
                    Preview
                  </div>
                </div>
              </Field>

              {/* Font style */}
              <Field label="Font Style">
                <div className="flex gap-2">
                  {(['default', 'serif', 'mono'] as const).map((fs) => (
                    <button
                      key={fs}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, font_style: fs }))}
                      className={`px-4 py-2 rounded-lg text-[11px] font-medium border transition-colors capitalize ${
                        form.font_style === fs
                          ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]'
                          : 'bg-[#0c0a08] border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620]'
                      }`}
                    >
                      {fs === 'default' ? 'Sans (default)' : fs === 'serif' ? 'Serif' : 'Mono'}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Primary text color */}
              <Field label="Text Color">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-[#0c0a08] border border-[#1f1a13] rounded-lg px-3 py-1.5">
                    <input
                      type="color"
                      value={form.text_color_primary}
                      onChange={set('text_color_primary')}
                      className="w-6 h-6 rounded cursor-pointer border-none bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={form.text_color_primary}
                      onChange={set('text_color_primary')}
                      maxLength={7}
                      placeholder="#E8DCC8"
                      className="w-20 bg-transparent text-[12px] text-[#E8DCC8] focus:outline-none font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, text_color_primary: '#E8DCC8' }))}
                    className="text-[10px] font-mono text-[#5a5142] hover:text-[#E8DCC8] transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </Field>
            </Section>

            {/* ② Social Links */}
            <Section
              id="social"
              title="Social Links"
              icon={<Globe size={15} />}
              open={openSections.has('social')}
              onToggle={() => toggleSection('social')}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Instagram Handle">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#5a5142]">@</span>
                    <input
                      type="text"
                      value={form.instagram_handle}
                      onChange={set('instagram_handle')}
                      placeholder="username"
                      className={`${inputCls} pl-7`}
                    />
                  </div>
                </Field>
                <Field label="Twitter / 𝕏 Handle">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#5a5142]">@</span>
                    <input
                      type="text"
                      value={form.twitter_handle}
                      onChange={set('twitter_handle')}
                      placeholder="username"
                      className={`${inputCls} pl-7`}
                    />
                  </div>
                </Field>
                <Field label="Spotify Artist URL">
                  <input
                    type="url"
                    value={form.spotify_url}
                    onChange={set('spotify_url')}
                    placeholder="https://open.spotify.com/artist/…"
                    className={inputCls}
                  />
                </Field>
                <Field label="SoundCloud URL">
                  <input
                    type="url"
                    value={form.soundcloud_url}
                    onChange={set('soundcloud_url')}
                    placeholder="https://soundcloud.com/…"
                    className={inputCls}
                  />
                </Field>
                <Field label="Website URL">
                  <input
                    type="url"
                    value={form.website_url}
                    onChange={set('website_url')}
                    placeholder="https://…"
                    className={inputCls}
                  />
                </Field>
                <Field label="Contact Email">
                  <input
                    type="email"
                    value={form.contact_email}
                    onChange={set('contact_email')}
                    placeholder="you@example.com"
                    className={inputCls}
                  />
                </Field>
              </div>
            </Section>

            {/* ③ Featured Playlists */}
            <Section
              id="playlists"
              title="Featured Playlists"
              icon={<ListMusic size={15} />}
              open={openSections.has('playlists')}
              onToggle={() => toggleSection('playlists')}
            >
              <p className="text-[11px] text-[#5a5142]">
                Up to 5 playlists shown in your store hero. Drag to reorder.
              </p>

              {/* Featured list (drag-sortable) */}
              {featured.length > 0 ? (
                <div className="space-y-1">
                  {featured.map((pl, idx) => (
                    <div
                      key={pl.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0c0a08] border border-[#1f1a13] cursor-grab active:cursor-grabbing hover:border-[#2d2620] transition-colors group"
                    >
                      <GripVertical size={13} className="text-[#3a3328] group-hover:text-[#5a5142] shrink-0" />
                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#1a160f] border border-[#2d2620] shrink-0">
                        {pl.cover_url
                          ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><ListMusic size={12} className="text-[#3a3328]" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#E8DCC8] truncate">{pl.name}</p>
                        <p className="text-[10px] font-mono text-[#5a5142]">{pl.track_count} track{pl.track_count !== 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-[8px] font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 px-1.5 py-0.5 rounded shrink-0">
                        Featured
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFromFeatured(pl.id)}
                        className="w-6 h-6 rounded-full bg-white/[0.04] border border-[#1f1a13] flex items-center justify-center text-[#5a5142] hover:text-red-400 hover:border-red-900/40 transition-colors shrink-0"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#1f1a13] py-8 text-center text-[#5a5142] text-[12px]">
                  No featured playlists yet. Add one below.
                </div>
              )}

              {/* Available playlists to add */}
              {unfeatured.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#3a3328] mb-2">
                    Add to featured {featured.length}/5
                  </p>
                  <div className="space-y-1">
                    {unfeatured.map((pl) => (
                      <div
                        key={pl.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0a0907] border border-[#1a160f] hover:border-[#2d2620] transition-colors"
                      >
                        <div className="w-8 h-8 rounded-md overflow-hidden bg-[#1a160f] border border-[#2d2620] shrink-0">
                          {pl.cover_url
                            ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center"><ListMusic size={10} className="text-[#3a3328]" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-[#a08a6a] truncate">{pl.name}</p>
                          <p className="text-[9px] font-mono text-[#3a3328]">{pl.track_count} tracks</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addToFeatured(pl)}
                          disabled={featured.length >= 5}
                          className="w-6 h-6 rounded-full bg-white/[0.04] border border-[#1f1a13] flex items-center justify-center text-[#5a5142] hover:text-[#6DC6A4] hover:border-[#6DC6A4]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {playlists.length === 0 && (
                <p className="text-[11px] text-[#3a3328]">
                  No playlists yet — create some in{' '}
                  <a href="/playlists" className="text-[#a08a6a] underline underline-offset-2 hover:text-[#D4BFA0] transition-colors">
                    Playlists
                  </a>.
                </p>
              )}
            </Section>

            {/* ③b Featured Projects */}
            <Section
              id="projects"
              title="Featured Projects"
              icon={<Layers size={15} />}
              open={openSections.has('projects')}
              onToggle={() => toggleSection('projects')}
            >
              <p className="text-[11px] text-[#5a5142]">
                Up to 5 projects shown in your store. Drag to reorder.
              </p>

              {featuredProjects.length > 0 ? (
                <div className="space-y-1">
                  {featuredProjects.map((pr, idx) => (
                    <div
                      key={pr.id}
                      draggable
                      onDragStart={() => handleProjectDragStart(idx)}
                      onDragOver={(e) => handleProjectDragOver(e, idx)}
                      onDragEnd={handleProjectDragEnd}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0c0a08] border border-[#1f1a13] cursor-grab active:cursor-grabbing hover:border-[#2d2620] transition-colors group"
                    >
                      <GripVertical size={13} className="text-[#3a3328] group-hover:text-[#5a5142] shrink-0" />
                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#1a160f] border border-[#2d2620] shrink-0">
                        {pr.cover_url
                          ? <img src={pr.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><Layers size={12} className="text-[#3a3328]" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#E8DCC8] truncate">{pr.name}</p>
                        {pr.price_usd != null && (
                          <p className="text-[10px] font-mono text-[#5a5142]">${pr.price_usd}</p>
                        )}
                      </div>
                      <span className="text-[8px] font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 px-1.5 py-0.5 rounded shrink-0">
                        Featured
                      </span>
                      <button
                        type="button"
                        onClick={() => removeProjectFromFeatured(pr.id)}
                        className="w-6 h-6 rounded-full bg-white/[0.04] border border-[#1f1a13] flex items-center justify-center text-[#5a5142] hover:text-red-400 hover:border-red-900/40 transition-colors shrink-0"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#1f1a13] py-8 text-center text-[#5a5142] text-[12px]">
                  No featured projects yet. Add one below.
                </div>
              )}

              {unfeaturedProjects.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#3a3328] mb-2">
                    Add to featured {featuredProjects.length}/5
                  </p>
                  <div className="space-y-1">
                    {unfeaturedProjects.map((pr) => (
                      <div
                        key={pr.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0a0907] border border-[#1a160f] hover:border-[#2d2620] transition-colors"
                      >
                        <div className="w-8 h-8 rounded-md overflow-hidden bg-[#1a160f] border border-[#2d2620] shrink-0">
                          {pr.cover_url
                            ? <img src={pr.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center"><Layers size={10} className="text-[#3a3328]" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-[#a08a6a] truncate">{pr.name}</p>
                          {pr.price_usd != null && (
                            <p className="text-[9px] font-mono text-[#3a3328]">${pr.price_usd}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => addProjectToFeatured(pr)}
                          disabled={featuredProjects.length >= 5}
                          className="w-6 h-6 rounded-full bg-white/[0.04] border border-[#1f1a13] flex items-center justify-center text-[#5a5142] hover:text-[#6DC6A4] hover:border-[#6DC6A4]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {projects.length === 0 && (
                <p className="text-[11px] text-[#3a3328]">
                  No projects yet — create some in{' '}
                  <a href="/projects" className="text-[#a08a6a] underline underline-offset-2 hover:text-[#D4BFA0] transition-colors">
                    Projects
                  </a>.
                </p>
              )}
            </Section>

            {/* ④ Track Listing — publish tracks to the store */}
            <Section
              id="tracks"
              title="Beat Listing"
              icon={<ShoppingBag size={15} />}
              open={openSections.has('tracks')}
              onToggle={() => toggleSection('tracks')}
            >
              <p className="text-[11px] text-[#5a5142]">
                Toggle beats on or off to control what appears in your public store. To set prices and cover art, open the beat in your{' '}
                <a href="/library" className="text-[#a08a6a] underline underline-offset-2 hover:text-[#D4BFA0] transition-colors">Library</a>.
              </p>

              {/* Search */}
              {allTracks.length > 4 && (
                <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328]" />
                  <input
                    type="text"
                    value={trackSearch}
                    onChange={(e) => setTrackSearch(e.target.value)}
                    placeholder="Search beats…"
                    className="w-full bg-[#0c0a08] border border-[#1f1a13] rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors"
                  />
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-3 text-[10px] font-mono text-[#5a5142]">
                <span className="px-2 py-0.5 rounded bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 text-[#6DC6A4] font-bold">
                  {allTracks.filter((t) => t.store_listed).length} listed
                </span>
                <span>{allTracks.length} total beats</span>
              </div>

              {/* Needs attention — surfaces listed beats with quality
                  issues that hurt conversion (no cover, no price set, no
                  BPM/key metadata). Producer can fix in /library. */}
              {(() => {
                const listed = allTracks.filter((t) => t.store_listed);
                const noCover = listed.filter((t) => !t.cover_url);
                const noPrice = listed.filter(
                  (t) => (t.lease_price_usd == null || t.lease_price_usd <= 0)
                    && (t.exclusive_price_usd == null || t.exclusive_price_usd <= 0),
                );
                const noBpmKey = listed.filter((t) => t.bpm == null && !t.key);
                const issues = [
                  noCover.length > 0 && { label: 'no cover art', count: noCover.length, firstId: noCover[0].id },
                  noPrice.length > 0 && { label: 'no price set', count: noPrice.length, firstId: noPrice[0].id },
                  noBpmKey.length > 0 && { label: 'no BPM or key', count: noBpmKey.length, firstId: noBpmKey[0].id },
                ].filter(Boolean) as Array<{ label: string; count: number; firstId: string }>;
                if (issues.length === 0) return null;
                return (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
                    <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-amber-400/80 mb-2">
                      Needs attention · {issues.reduce((s, i) => s + i.count, 0)} issue{issues.reduce((s, i) => s + i.count, 0) === 1 ? '' : 's'}
                    </p>
                    <ul className="space-y-1">
                      {issues.map((i) => (
                        <li key={i.label}>
                          <a
                            href={`/library/${i.firstId}`}
                            className="text-[11px] text-[#a08a6a] hover:text-amber-300 flex items-center gap-2 group"
                          >
                            <span className="w-1 h-1 rounded-full bg-amber-400/60" />
                            <span className="tabular-nums font-mono text-amber-400/90">{i.count}</span>
                            <span>listed beat{i.count === 1 ? '' : 's'} {i.label}</span>
                            <span className="opacity-0 group-hover:opacity-100 text-amber-400/80 ml-auto">→</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {/* Track rows */}
              {allTracks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#1f1a13] py-10 text-center">
                  <Music size={20} className="text-[#2d2620] mx-auto mb-2" />
                  <p className="text-[12px] text-[#5a5142]">No beats in your library yet.</p>
                  <a href="/library" className="mt-2 inline-block text-[10px] font-mono text-[#a08a6a] hover:text-[#D4BFA0] underline underline-offset-2 transition-colors">
                    Upload your first beat →
                  </a>
                </div>
              ) : (
                <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
                  {(() => {
                    // Index map (within the *listed* subset) so the drag
                    // handlers know which slot a row occupies. Drafts are
                    // appended below and not draggable.
                    const listedIds: string[] = allTracks
                      .filter((x) => x.store_listed)
                      .map((x) => x.id);
                    return allTracks
                      .filter((t) =>
                        !trackSearch.trim() ||
                        t.title.toLowerCase().includes(trackSearch.toLowerCase()) ||
                        (t.key ?? '').toLowerCase().includes(trackSearch.toLowerCase()) ||
                        String(t.bpm ?? '').includes(trackSearch),
                      )
                      .map((t) => {
                        const listedIdx = listedIds.indexOf(t.id);
                        const isListed = listedIdx >= 0;
                        return (
                      <div
                        key={t.id}
                        draggable={isListed}
                        onDragStart={() => { if (isListed) handleTrackDragStart(listedIdx); }}
                        onDragOver={(e) => { if (isListed) handleTrackDragOver(e, listedIdx); }}
                        onDragEnd={handleTrackDragEnd}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                          t.store_listed
                            ? 'bg-[#0e140e] border-[#6DC6A4]/20 hover:border-[#6DC6A4]/35 cursor-grab active:cursor-grabbing'
                            : 'bg-[#0a0907] border-[#1a160f] hover:border-[#1f1a13]'
                        }`}
                      >
                        {/* Drag handle — only on listed rows */}
                        {isListed && (
                          <GripVertical size={13} className="text-[#3a3328] hover:text-[#6a5d4a] shrink-0" />
                        )}
                        {/* Cover art */}
                        <div className="w-9 h-9 rounded-md overflow-hidden bg-[#1a160f] border border-[#2d2620] shrink-0">
                          {t.cover_url
                            ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={12} /></div>}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] font-medium truncate ${t.store_listed ? 'text-[#E8DCC8]' : 'text-[#a08a6a]'}`}>
                            {t.title}
                          </p>
                          <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider">
                            {t.type}
                            {t.bpm ? ` · ${t.bpm} BPM` : ''}
                            {t.key ? ` · ${t.key}` : ''}
                          </p>
                        </div>

                        {/* Price badge (if set) */}
                        {t.lease_price_usd != null && (
                          <span className="hidden sm:block text-[9px] font-mono text-[#a08a6a] tabular-nums shrink-0">
                            ${t.lease_price_usd}
                          </span>
                        )}

                        {/* Status badge — Live / Draft / Scheduled */}
                        {t.store_listed ? (
                          <span className="hidden sm:block text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/20">
                            Live
                          </span>
                        ) : t.scheduled_publish_at ? (
                          <span
                            className="hidden sm:flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 text-amber-300 bg-amber-500/10 border border-amber-500/30"
                            title={`Auto-publishes ${new Date(t.scheduled_publish_at).toLocaleString()}`}
                          >
                            <ChevronRight size={9} className="-mr-0.5" />
                            Scheduled
                          </span>
                        ) : (
                          <span className="hidden sm:block text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 text-[#4a4338] bg-[#1a160f] border border-[#1f1a13]">
                            Draft
                          </span>
                        )}

                        {/* Schedule button — only on drafts; opens an
                            inline datetime picker. Clearing the input
                            cancels any pending schedule. */}
                        {!t.store_listed && (
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (scheduleOpenFor === t.id) {
                                  setScheduleOpenFor(null);
                                } else {
                                  setScheduleOpenFor(t.id);
                                  setScheduleDraft(t.scheduled_publish_at
                                    ? new Date(t.scheduled_publish_at).toISOString().slice(0, 16)
                                    : '');
                                }
                              }}
                              title={t.scheduled_publish_at
                                ? `Edit schedule (${new Date(t.scheduled_publish_at).toLocaleString()})`
                                : 'Schedule auto-publish'}
                              className={`w-7 h-7 rounded-md flex items-center justify-center border transition-colors ${
                                t.scheduled_publish_at
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                  : 'bg-white/[0.03] border-[#1f1a13] text-[#5a5142] hover:text-amber-300 hover:border-amber-500/30'
                              }`}
                            >
                              <Clock size={12} />
                            </button>
                            {scheduleOpenFor === t.id && (
                              <div className="absolute right-0 top-9 z-30 w-64 rounded-xl bg-[#0c0a08] border border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.6)] p-3">
                                <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142] mb-2">
                                  Auto-publish at
                                </p>
                                <input
                                  type="datetime-local"
                                  value={scheduleDraft}
                                  onChange={(e) => setScheduleDraft(e.target.value)}
                                  className={inputCls}
                                />
                                <div className="flex items-center gap-2 mt-3">
                                  <button
                                    onClick={async () => {
                                      if (!scheduleDraft) return;
                                      const iso = new Date(scheduleDraft).toISOString();
                                      await setSchedule(t.id, iso);
                                      setScheduleOpenFor(null);
                                    }}
                                    disabled={!scheduleDraft}
                                    className="flex-1 px-3 py-2 rounded-md bg-[#D4BFA0] text-black text-[10px] font-bold uppercase tracking-wider hover:bg-[#E8D8B8] transition-colors disabled:opacity-40"
                                  >
                                    Schedule
                                  </button>
                                  {t.scheduled_publish_at && (
                                    <button
                                      onClick={async () => {
                                        await setSchedule(t.id, null);
                                        setScheduleOpenFor(null);
                                      }}
                                      className="px-3 py-2 rounded-md border border-[#2d2620] text-[#a08a6a] text-[10px] font-mono uppercase tracking-wider hover:text-white hover:border-[#3a3328] transition-colors"
                                    >
                                      Clear
                                    </button>
                                  )}
                                </div>
                                {t.scheduled_publish_at && (
                                  <p className="mt-2 text-[10px] text-[#5a5142]">
                                    Currently set for {new Date(t.scheduled_publish_at).toLocaleString()}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Producer's-Picks toggle — only available on listed
                            tracks. Star fills with the accent gold when active. */}
                        {t.store_listed && (
                          <button
                            onClick={() => toggleTrackFeatured(t.id, t.store_featured)}
                            title={t.store_featured ? "Unpin from Producer's Picks" : "Pin to Producer's Picks"}
                            className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center border transition-colors ${
                              t.store_featured
                                ? 'bg-[#c8a84b]/15 border-[#c8a84b]/40 text-[#c8a84b]'
                                : 'bg-white/[0.03] border-[#1f1a13] text-[#5a5142] hover:text-[#c8a84b] hover:border-[#c8a84b]/30'
                            }`}
                          >
                            <Star size={12} fill={t.store_featured ? 'currentColor' : 'none'} />
                          </button>
                        )}

                        {/* Voice-tag toggle — only on listed tracks, and only
                            useful once a tag is uploaded (button hints when not). */}
                        {t.store_listed && (
                          <button
                            onClick={() => {
                              if (!form.voice_tag_url) { toast.info('Upload a voice tag first', 'Find it in the Voice Tag section above.'); return; }
                              toggleTrackTag(t.id, t.voice_tag_enabled);
                            }}
                            title={t.voice_tag_enabled ? 'Voice tag on (preview only)' : 'Add voice tag to preview'}
                            className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center border transition-colors ${
                              t.voice_tag_enabled
                                ? 'bg-[#9d95e8]/15 border-[#9d95e8]/40 text-[#9d95e8]'
                                : 'bg-white/[0.03] border-[#1f1a13] text-[#5a5142] hover:text-[#9d95e8] hover:border-[#9d95e8]/30'
                            }`}
                          >
                            <Mic2 size={12} />
                          </button>
                        )}

                        {/* Toggle */}
                        <button
                          onClick={() => toggleTrackListed(t.id, t.store_listed)}
                          disabled={togglingTrack === t.id}
                          title={t.store_listed ? 'Remove from store' : 'Add to store'}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none disabled:opacity-60 ${
                            t.store_listed ? 'bg-[#6DC6A4]' : 'bg-[#1f1a13]'
                          }`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            t.store_listed ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                        );
                      });
                  })()}
                </div>
              )}
            </Section>

            {/* ⑤ Track Listing Controls */}
            <Section
              id="track-controls"
              title="Store Settings"
              icon={<DollarSign size={15} />}
              open={openSections.has('track-controls')}
              onToggle={() => toggleSection('track-controls')}
            >
              {/* License notes */}
              <Field label="License Notes">
                <textarea
                  value={form.license_notes}
                  onChange={set('license_notes')}
                  rows={3}
                  placeholder="Shown to buyers on the checkout page — usage terms, credit requirements, etc."
                  className={textareaCls}
                />
              </Field>

              {/* Bundle / quantity discount (mig 077) */}
              <Field
                label="Bundle Discount"
                hint="Automatic cart discount — no promo code needed. e.g. 3 items → 15% off. Leave at 0 to disable."
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={form.bundle_discount_threshold}
                      onChange={set('bundle_discount_threshold')}
                      placeholder="3"
                      className={`${inputCls} w-20`}
                    />
                    <span className="text-[11px] text-[#6a5d4a]">items →</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={90}
                      step="0.5"
                      value={form.bundle_discount_percent}
                      onChange={set('bundle_discount_percent')}
                      placeholder="15"
                      className={`${inputCls} w-20`}
                    />
                    <span className="text-[11px] text-[#6a5d4a]">% off</span>
                  </div>
                </div>
              </Field>
            </Section>

            {/* SEO + share card — what shows when /store is shared on
                social. Mig 055; consumed by /store/layout.tsx. */}
            <Section
              id="seo"
              title="SEO &amp; Share Card"
              icon={<ImageIcon size={15} />}
              open={openSections.has('seo')}
              onToggle={() => toggleSection('seo')}
            >
              <p className="text-[11px] text-[#5a5142]">
                Controls how /store renders in iMessage, Twitter, Discord, and Google search results. All fields optional — if you leave them blank we use your display name + bio + hero image.
              </p>
              <Field label="Page title" hint="Shows in browser tabs + search results. Aim for 50–60 chars.">
                <input
                  type="text"
                  value={form.seo_title}
                  onChange={set('seo_title')}
                  maxLength={70}
                  placeholder={`${form.display_name || 'Producer'} — Beat store`}
                  className={inputCls}
                />
                <p className="mt-1 text-[9px] font-mono text-[#3a3328] tabular-nums">{form.seo_title.length}/70</p>
              </Field>
              <Field label="Meta description" hint="One paragraph buyers see in social previews. 120–160 chars works best.">
                <textarea
                  value={form.seo_description}
                  onChange={set('seo_description')}
                  rows={3}
                  maxLength={180}
                  placeholder="Modern trap, afrobeats, and remix beats. License lease + exclusive direct, with bundle deals for full projects."
                  className={textareaCls}
                />
                <p className="mt-1 text-[9px] font-mono text-[#3a3328] tabular-nums">{form.seo_description.length}/180</p>
              </Field>
              <Field label="Social share image (OG image)" hint="1200×630 PNG/JPG works best. Falls back to your hero image when blank.">
                <input
                  type="url"
                  value={form.og_image_url}
                  onChange={set('og_image_url')}
                  placeholder="https://…/your-share-card.png"
                  className={inputCls}
                />
                {form.og_image_url && (
                  <div className="mt-2 rounded-lg overflow-hidden border border-[#1f1a13] max-w-md">
                    <img src={form.og_image_url} alt="Share card preview" className="w-full h-auto" />
                  </div>
                )}
              </Field>
            </Section>

            {/* Share templates (mig 062) — IG card + 9:16 video styles */}
            <Section
              id="share-templates"
              title="Share Templates"
              icon={<Layers size={15} />}
              open={openSections.has('share-templates')}
              onToggle={() => toggleSection('share-templates')}
            >
              <ShareStylePicker
                kind="card"
                value={form.share_card_style}
                onChange={(v) => setForm((f) => ({ ...f, share_card_style: v }))}
                tracks={allTracks}
              />
              <ShareStylePicker
                kind="video"
                value={form.share_video_style}
                onChange={(v) => setForm((f) => ({ ...f, share_video_style: v }))}
                tracks={allTracks}
              />
            </Section>

            {/* Voice tag (mig 072) — upload once, toggle per beat in the
                listing manager. Overlays on store previews only. */}
            <Section
              id="voice-tag"
              title="Voice Tag"
              icon={<Mic2 size={15} />}
              open={openSections.has('voice-tag')}
              onToggle={() => toggleSection('voice-tag')}
            >
              <VoiceTagSection
                value={form.voice_tag_url}
                interval={form.voice_tag_interval_seconds}
                onUploaded={(url) => setForm((f) => ({ ...f, voice_tag_url: url }))}
                onIntervalChange={(v) => setForm((f) => ({ ...f, voice_tag_interval_seconds: v }))}
                onRemove={() => setForm((f) => ({ ...f, voice_tag_url: '' }))}
              />
            </Section>

            {/* License contract — markdown template (mig 057) */}
            <Section
              id="license-template"
              title="License Contract"
              icon={<Layers size={15} />}
              open={openSections.has('license-template')}
              onToggle={() => toggleSection('license-template')}
            >
              <LicenseTemplateEditor
                value={form.license_template_md}
                onChange={(v) => setForm((f) => ({ ...f, license_template_md: v }))}
              />
            </Section>

            {/* Waveform backfill — owner-only batch tool. Useful for
                tracks uploaded before the peaks pipeline existed. */}
            <Section
              id="waveforms"
              title="Waveforms"
              icon={<Music size={15} />}
              open={openSections.has('waveforms')}
              onToggle={() => toggleSection('waveforms')}
            >
              <p className="text-[11px] text-[#5a5142]">
                If your beats' waveforms in /store look generic, that's because the original peaks weren't computed at upload. Regenerate them now — the player will then draw the real shape of every file.
              </p>
              <BackfillPeaksButton />
            </Section>

            {/* Discount codes — promo_codes (mig 047) */}
            <Section
              id="promo"
              title="Discount Codes"
              icon={<Tag size={15} />}
              open={openSections.has('promo')}
              onToggle={() => toggleSection('promo')}
            >
              <p className="text-[11px] text-[#5a5142]">
                Create codes buyers can enter at checkout. Share them in DMs or auto-fill via <code className="font-mono text-[#a08a6a]">/store/checkout?promo=YOUR_CODE</code>.
              </p>

              {/* Create form */}
              <div className="rounded-xl border border-[#1f1a13] bg-[#0c0a08] p-4 space-y-3">
                <Field label="Code">
                  <input
                    type="text"
                    value={promoForm.code}
                    onChange={(e) => setPromoForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="SUMMER10"
                    maxLength={40}
                    className={inputCls}
                  />
                </Field>
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <Field label="Type">
                    <select
                      value={promoForm.kind}
                      onChange={(e) => setPromoForm((f) => ({ ...f, kind: e.target.value as 'percent' | 'amount' }))}
                      className={inputCls}
                    >
                      <option value="percent">Percent off</option>
                      <option value="amount">Flat amount off</option>
                    </select>
                  </Field>
                  <Field label={promoForm.kind === 'percent' ? 'Percent (0–100)' : 'Amount (USD)'}>
                    <input
                      type="number"
                      step={promoForm.kind === 'percent' ? '1' : '0.01'}
                      min="0"
                      max={promoForm.kind === 'percent' ? '100' : undefined}
                      value={promoForm.value}
                      onChange={(e) => setPromoForm((f) => ({ ...f, value: e.target.value }))}
                      placeholder={promoForm.kind === 'percent' ? '10' : '5.00'}
                      className={inputCls}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Max uses" hint="Leave blank for unlimited.">
                    <input
                      type="number"
                      min="1"
                      value={promoForm.max_uses}
                      onChange={(e) => setPromoForm((f) => ({ ...f, max_uses: e.target.value }))}
                      placeholder="∞"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Expires" hint="Optional cut-off.">
                    <input
                      type="datetime-local"
                      value={promoForm.expires_at}
                      onChange={(e) => setPromoForm((f) => ({ ...f, expires_at: e.target.value }))}
                      className={inputCls}
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={createPromoCode}
                  disabled={promoCreating}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#D4BFA0] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#E8D8B8] transition-colors disabled:opacity-50"
                >
                  {promoCreating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Create code
                </button>
              </div>

              {/* Existing codes */}
              {promoCodes.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#3a3328]">Active &amp; recent ({promoCodes.length})</p>
                  {promoCodes.map((c) => {
                    const expired = c.expires_at && new Date(c.expires_at).getTime() < Date.now();
                    const capped = c.max_uses != null && c.uses_count >= c.max_uses;
                    const dead = expired || capped || !c.active;
                    const discountLabel = c.discount_percent > 0
                      ? `${c.discount_percent}% off`
                      : `$${c.discount_amount} off`;
                    return (
                      <div
                        key={c.code}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                          dead ? 'bg-[#0a0907]/60 border-[#1a160f] opacity-65' : 'bg-[#0e140e] border-[#6DC6A4]/20'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-[13px] font-mono font-bold text-[#E8DCC8] tracking-wide">{c.code}</code>
                            <span className="text-[10px] font-mono text-[#a08a6a]">{discountLabel}</span>
                            {expired && <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-300">Expired</span>}
                            {capped && <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">Used up</span>}
                            {!c.active && !expired && !capped && <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#1a160f] border border-[#2d2620] text-[#5a5142]">Paused</span>}
                          </div>
                          <p className="text-[10px] font-mono text-[#5a5142] mt-0.5">
                            {c.uses_count} / {c.max_uses ?? '∞'} uses
                            {c.expires_at && ` · expires ${new Date(c.expires_at).toLocaleDateString()}`}
                          </p>
                        </div>
                        <button
                          onClick={() => togglePromoActive(c.code, !c.active)}
                          disabled={!!expired || !!capped}
                          title={c.active ? 'Pause this code' : 'Reactivate'}
                          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                            c.active && !expired && !capped ? 'bg-[#6DC6A4]' : 'bg-[#1f1a13]'
                          } disabled:opacity-40`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                            c.active && !expired && !capped ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                        <button
                          onClick={() => deletePromoCode(c.code)}
                          title="Delete"
                          className="w-7 h-7 rounded-md border border-[#1f1a13] flex items-center justify-center text-[#5a5142] hover:text-red-400 hover:border-red-900/40 transition-colors"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#1f1a13] py-6 text-center text-[#5a5142] text-[12px]">
                  No codes yet — make one above.
                </div>
              )}
            </Section>

            {/* ⑤ License Tiers */}
            <Section
              id="licenses"
              title="License Tiers"
              icon={<Layers size={13} />}
              open={openSections.has('licenses')}
              onToggle={() =>
                setOpenSections((prev) => {
                  const next = new Set(prev);
                  next.has('licenses') ? next.delete('licenses') : next.add('licenses');
                  return next;
                })
              }
            >
              <LicenseBuilder />
            </Section>

            {/* Mobile save shortcut */}
            <div className="pt-4 lg:hidden flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#D4BFA0] hover:bg-[#E8D8B8] disabled:opacity-60 text-black text-[12px] font-semibold transition-all"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Saving…' : 'Save Store'}
              </button>
            </div>
          </div>

          {/* ── Right: live preview ── */}
          <div className={`w-full lg:w-[380px] xl:w-[420px] shrink-0 ${previewOpen ? '' : 'hidden lg:block'}`}>
            <div className="sticky top-20">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142]">Live Preview</p>
                <a
                  href="/store"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] font-mono text-[#6a5d4a] hover:text-[#a08a6a] flex items-center gap-1 transition-colors"
                >
                  open store <ExternalLink size={9} />
                </a>
              </div>
              <StorePreview
                profile={form}
                featuredPlaylists={featured}
                featuredProjects={featuredProjects}
                tracks={previewTracks}
              />
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

/* ─── Voice Tag section ─────────────────────────────────────── */

function VoiceTagSection({
  value,
  interval,
  onUploaded,
  onIntervalChange,
  onRemove,
}: {
  value: string;
  interval: string;
  onUploaded: (url: string) => void;
  onIntervalChange: (v: string) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Tag too large', 'Keep it under 5 MB.'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/profile/voice-tag', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onUploaded(data.voice_tag_url);
      toast.success('Voice tag uploaded', 'Now toggle it on per beat in the listing manager.');
    } catch (err: any) {
      toast.error('Upload failed', err.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[#6a5d4a] leading-relaxed">
        Upload your producer tag once, then switch it on per beat (the mic icon in the
        listing manager). It overlays on store previews every {interval || 20}s — buyers
        hear it on the preview, but the file they download after purchase is always clean.
      </p>

      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#9d95e8]/25 bg-[#9d95e8]/[0.05] px-4 py-3">
          <button
            type="button"
            onClick={() => { audioRef.current?.play().catch(() => undefined); }}
            className="w-9 h-9 rounded-full bg-[#9d95e8]/15 border border-[#9d95e8]/30 text-[#9d95e8] flex items-center justify-center hover:bg-[#9d95e8]/25 transition-colors shrink-0"
            title="Preview tag"
          >
            <Play size={13} fill="currentColor" className="ml-0.5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-[#E8DCC8]">Voice tag set</p>
            <p className="text-[10px] font-mono text-[#5a5142] truncate">{value.split('/').pop()}</p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-[10px] font-mono uppercase tracking-wider text-[#a08a6a] hover:text-[#E8DCC8] transition-colors"
          >Replace</button>
          <button
            type="button"
            onClick={onRemove}
            className="text-[#5a5142] hover:text-red-400 transition-colors"
            title="Remove tag"
          ><Trash2 size={13} /></button>
          <audio ref={audioRef} src={value} preload="none" crossOrigin="anonymous" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[#2d2620] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#9d95e8]/40 transition-all text-[12px] font-medium disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Uploading…' : 'Upload voice tag (MP3/WAV, <5 MB)'}
        </button>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142]">Repeat every</span>
        <input
          type="number" min={5} max={120} value={interval}
          onChange={(e) => onIntervalChange(e.target.value)}
          className="w-16 bg-[#0a0907] border border-[#1f1a13] rounded-lg px-2 py-1.5 text-[12px] text-[#E8DCC8] focus:outline-none focus:border-[#2d2620] tabular-nums"
        />
        <span className="text-[10px] font-mono text-[#5a5142]">seconds (saved with the profile)</span>
      </div>

      <input ref={inputRef} type="file" accept="audio/*" onChange={handleFile} className="hidden" />
    </div>
  );
}
