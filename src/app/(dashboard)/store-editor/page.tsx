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
import { PageContainer } from '@/components/layout/PageHeader';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Loader2, Save, ExternalLink, ChevronDown, ChevronRight,
  Image as ImageIcon, Upload, Globe,
  Music, ListMusic, DollarSign, Eye, EyeOff,
  GripVertical, Check, X, Plus, Layers, Search,
  ShoppingBag, Star, Tag, Trash2, Clock, Mic2, Play, Download,
  ArrowUp, ArrowDown,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { DEFAULT_TEMPLATE_MD, VARIABLE_LIST } from '@/lib/contracts/license-template';
import { CARD_STYLE_META, VIDEO_STYLE_META } from '@/lib/share/styles';
import { normalizeThemeColor } from '@/lib/theme/colors';
import { LicenseBuilder } from '@/components/store/LicenseBuilder';
import { ArtistBioBlock } from '@/components/store/ArtistBioBlock';
import { BeatCard } from '@/components/store/BeatCard';
import { TrackLicensePanel } from '@/components/store/TrackLicensePanel';
import type { StoreTrack, CreatorProfile } from '@/components/store/types';

const TRACK_LIST_BATCH_SIZE = 80;

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

interface GlobalLicense {
  id: string;
  name: string;
  price_usd: number | null;
  is_free: boolean;
  is_exclusive: boolean;
  sort_order: number;
}

interface TrackLicenseLink {
  license_id: string;
  enabled: boolean;
  linked: boolean;
  price_override_usd: number | null;
}

function moveArrayItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

const EMPTY_PROFILE: ProfileForm = {
  display_name: '',
  bio: '',
  credits: '',
  hero_image_url: '',
  accent_color: '#E7D7BE',
  font_style: 'default',
  text_color_primary: '#F7EBDD',
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
  '#E7D7BE', '#7F77DD', '#6DC6A4', '#E8C47A',
  '#C47A7A', '#7AC4E8', '#B07AE8',
];

/* ─── Accordion section ──────────────────────────────────────── */

function Section({
  id, title, icon, open, onToggle, children, badge,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Quiet content summary shown while collapsed, e.g. "12 listed". */
  badge?: string;
}) {
  const panelId = `store-editor-section-${id}`;

  return (
    <section className="overflow-hidden rounded-xl border border-[#2B2821] bg-[#171511] sm:rounded-2xl">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02] sm:px-5 sm:py-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2B2821] bg-[#11100D] text-[#D0C3AF]">
            {icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-[#F7EBDD]">{title}</span>
            {badge && !open && (
              <span className="block truncate text-[10px] font-mono text-[#6E685B]">{badge}</span>
            )}
          </span>
        </div>
        {open
          ? <ChevronDown size={15} className="shrink-0 text-[#9B9282]" />
          : <ChevronRight size={15} className="shrink-0 text-[#9B9282]" />}
      </button>
      {open && (
        <div id={panelId} className="space-y-4 border-t border-[#211F1A] px-4 pb-5 pt-4 sm:px-5">
          {children}
        </div>
      )}
    </section>
  );
}

/* ─── Field helpers ──────────────────────────────────────────── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] block mb-1.5">
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
      <p className="text-[11px] text-[#9B9282]">
        Filled in at every purchase and attached as a PDF to the delivery email. Markdown supported (# heading, ** bold **, - bullet). Leave empty to use the default template.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {VARIABLE_LIST.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => insertVar(v.key)}
            title={`Insert {{${v.key}}} — sample: ${v.sample}`}
            className="px-2 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] border border-[#2B2821] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[#3B372F] transition-colors"
          >
            +{v.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TEMPLATE_MD)}
          className="ml-auto px-3 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] border border-[#3B372F] text-[#D0C3AF] hover:text-[#F7EBDD] transition-colors"
        >
          Use default
        </button>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="px-3 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider border transition-colors"
          style={preview
            ? { backgroundColor: '#E7D7BE', color: '#000', borderColor: '#E7D7BE' }
            : { backgroundColor: 'transparent', color: '#D0C3AF', borderColor: '#3B372F' }}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {preview ? (
        <pre className="bg-[#090907] border border-[#2B2821] rounded-lg p-4 text-[12px] text-[#F7EBDD] leading-relaxed whitespace-pre-wrap font-sans max-h-[480px] overflow-auto">
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
            className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#D0C3AF]"
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
                active ? 'border-[#E7D7BE]' : 'border-[#2B2821] hover:border-[#3B372F]'
              }`}
            >
              <div className="aspect-[9/16] bg-[#090907] overflow-hidden">
                {thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#6E685B] text-[10px] font-mono uppercase tracking-wider">
                    {s.label}
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5 bg-[#171511]">
                <p className="text-[11px] font-medium text-[#F7EBDD]">{s.label}</p>
                <p className="text-[9px] text-[#9B9282] leading-tight line-clamp-2">{s.description}</p>
              </div>
              {active && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#E7D7BE] text-black text-[10px] flex items-center justify-center font-bold">✓</span>
              )}
            </button>
          );
        })}
      </div>
      {!sampleTrack && kind === 'card' && (
        <p className="mt-2 text-[10px] text-[#6E685B] font-mono">
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
        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E7D7BE] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#F3E6D1] transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Music size={12} />}
        {busy ? 'Regenerating…' : 'Regenerate all waveforms'}
      </button>
      {result && (
        <p className="text-[11px] text-[#D0C3AF]">
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
        <p className="-mt-1 mb-1.5 text-[10px] text-[#9B9282]">{hint}</p>
      )}
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-[#11100D] border border-[#2B2821] rounded-lg px-3 py-2 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] transition-colors';
const textareaCls = `${inputCls} resize-none leading-relaxed`;

/* ─── Live preview ───────────────────────────────────────────── */

// PreviewTrack mirrors the fields BeatCard needs from StoreTrack.
type PreviewTrack = TrackRow;

interface TrackRow {
  id: string;
  title: string;
  type: string;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  store_listed: boolean;
  store_featured: boolean;
  store_sort_order: number | null;
  lease_price_usd: number | null;
  exclusive_price_usd: number | null;
  free_download_enabled: boolean;
  exclusive_sold: boolean;
  voice_tag_enabled: boolean;
  scheduled_publish_at: string | null;
}

interface TrackStoreSummary {
  total: number;
  listed: number;
  producerPicks: TrackRow[];
  issues: {
    noCover: { count: number; firstId: string | null };
    noPrice: { count: number; firstId: string | null };
    noBpmKey: { count: number; firstId: string | null };
  };
}

function mapTrackRow(t: any): TrackRow {
  return {
    id: t.id,
    title: t.title,
    type: t.type,
    cover_url: t.cover_url ?? null,
    bpm: t.bpm ?? null,
    key: t.key ?? null,
    scale: t.scale ?? null,
    store_listed: !!t.store_listed,
    store_featured: !!t.store_featured,
    store_sort_order: t.store_sort_order ?? null,
    scheduled_publish_at: t.scheduled_publish_at ?? null,
    lease_price_usd: t.lease_price_usd ?? null,
    exclusive_price_usd: t.exclusive_price_usd ?? null,
    free_download_enabled: !!t.free_download_enabled,
    exclusive_sold: !!t.exclusive_sold,
    voice_tag_enabled: !!t.voice_tag_enabled,
  };
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
  const accent = normalizeThemeColor(profile.accent_color);

  // Map ProfileForm → CreatorProfile so the real ArtistBioBlock can render.
  const creator: CreatorProfile = {
    display_name: profile.display_name || null,
    bio: profile.bio || null,
    credits: profile.credits || null,
    hero_image_url: profile.hero_image_url || null,
    instagram_handle: profile.instagram_handle || null,
    twitter_handle: profile.twitter_handle || null,
    spotify_url: profile.spotify_url || null,
    soundcloud_url: profile.soundcloud_url || null,
    website_url: profile.website_url || null,
    contact_email: profile.contact_email || null,
    accent_color: accent,
    font_style: profile.font_style || 'default',
    text_color_primary: profile.text_color_primary || '#F7EBDD',
  };

  // Map TrackRow → StoreTrack shape for BeatCard.
  const storeNoop = () => {};
  const asTracks = (ts: PreviewTrack[]): StoreTrack[] =>
    ts.map((t) => ({
      id: t.id,
      user_id: '',
      title: t.title,
      type: t.type as StoreTrack['type'],
      audio_url: '',
      cover_url: t.cover_url,
      bpm: t.bpm,
      key: t.key,
      scale: t.scale,
      duration_seconds: null,
      lease_price_usd: t.lease_price_usd,
      exclusive_price_usd: t.exclusive_price_usd,
      store_listed: t.store_listed,
      free_download_enabled: t.free_download_enabled,
      exclusive_sold: t.exclusive_sold,
      stems_status: 'none' as const,
      tags: [],
      store_sort_order: t.store_sort_order,
      created_at: '',
    }));

  const previewStoreTracks = asTracks(tracks);

  return (
    <div
      className="rounded-2xl overflow-hidden border border-[#2B2821] bg-[#090907] text-[#F7EBDD]"
      style={{ '--store-accent': accent } as React.CSSProperties}
    >
      {/* Real ArtistBioBlock — mirrors what buyers see */}
      <ArtistBioBlock creator={creator} accentColor={accent} />

      {/* Featured playlists */}
      {featuredPlaylists.length > 0 && (
        <div className="px-4 py-3 border-t border-[#211F1A]">
          <p className="text-[8px] font-mono uppercase tracking-widest text-[#9B9282] mb-2">Featured Playlists</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {featuredPlaylists.map((pl) => (
              <div key={pl.id} className="shrink-0 w-14">
                <div className="w-14 h-14 rounded-lg bg-[#211F1A] border border-[#3B372F] overflow-hidden flex items-center justify-center mb-1">
                  {pl.cover_url
                    ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                    : <ListMusic size={14} className="text-[#6E685B]" />}
                </div>
                <p className="text-[7px] text-[#B4AA99] truncate leading-tight">{pl.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Featured projects */}
      {featuredProjects.length > 0 && (
        <div className="px-4 py-3 border-t border-[#211F1A]">
          <p className="text-[8px] font-mono uppercase tracking-widest text-[#9B9282] mb-2">Featured Projects</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {featuredProjects.map((pr) => (
              <div key={pr.id} className="shrink-0 w-14">
                <div className="w-14 h-14 rounded-lg bg-[#211F1A] border border-[#3B372F] overflow-hidden flex items-center justify-center mb-1 relative">
                  {pr.cover_url
                    ? <img src={pr.cover_url} alt="" className="w-full h-full object-cover" />
                    : <Layers size={14} className="text-[#6E685B]" />}
                  {pr.price_usd != null && Number(pr.price_usd) > 0 && (
                    <span className="absolute bottom-0 left-0 right-0 text-[7px] font-mono font-bold py-0.5 text-center text-black" style={{ backgroundColor: accent }}>
                      ${pr.price_usd}
                    </span>
                  )}
                </div>
                <p className="text-[7px] text-[#B4AA99] truncate leading-tight">{pr.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Real BeatCard components — exactly what buyers see */}
      <div className="px-4 py-4 border-t border-[#211F1A]">
        <p className="text-[8px] font-mono uppercase tracking-widest text-[#9B9282] mb-3">
          Beats listed ({tracks.length})
        </p>
        {previewStoreTracks.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {previewStoreTracks.slice(0, 2).map((t) => (
              <BeatCard
                key={t.id}
                track={t}
                allTracks={previewStoreTracks}
                priceLease={t.lease_price_usd ?? null}
                priceExclusive={t.exclusive_price_usd ?? null}
                isCurrent={false}
                isPlaying={false}
                isPreview={false}
                onPlay={storeNoop}
                onPreview={storeNoop}
                onAddLease={storeNoop}
                onAddExclusive={storeNoop}
                onFreeDownload={storeNoop}
                accentColor={accent}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="aspect-square rounded-xl bg-[#171511] border border-dashed border-[#2B2821] flex flex-col items-center justify-center gap-2">
                <Music size={16} className="text-[#3B372F]" />
                <p className="text-[8px] font-mono text-[#3B372F]">No beats listed</p>
              </div>
            ))}
          </div>
        )}
      </div>
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
  const [trackSummary, setTrackSummary] = useState<TrackStoreSummary | null>(null);
  const [trackSearch, setTrackSearch] = useState('');
  const [visibleTrackRows, setVisibleTrackRows] = useState(TRACK_LIST_BATCH_SIZE);
  const [trackNextCursor, setTrackNextCursor] = useState<string | null>(null);
  const [trackHasMore, setTrackHasMore] = useState(false);
  const [trackLoadingMore, setTrackLoadingMore] = useState(false);
  const [producerPickSearch, setProducerPickSearch] = useState('');
  const [producerPickCandidates, setProducerPickCandidates] = useState<TrackRow[]>([]);
  const [producerPickNextCursor, setProducerPickNextCursor] = useState<string | null>(null);
  const [producerPickHasMore, setProducerPickHasMore] = useState(false);
  const [producerPickLoading, setProducerPickLoading] = useState(false);
  const [togglingTrack, setTogglingTrack] = useState<string | null>(null);
  // Global license tiers (for per-track license panel)
  const [globalLicenses, setGlobalLicenses] = useState<GlobalLicense[]>([]);
  const [trackLicenseLinks, setTrackLicenseLinks] = useState<Record<string, TrackLicenseLink[]>>({});
  // Which beat rows have their license panel expanded
  const [licenseExpandedFor, setLicenseExpandedFor] = useState<Set<string>>(new Set());

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
  // Store Editor starts as a section index on every viewport. The user
  // opens the exact area they mean to edit, starting with Hero.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [previewOpen, setPreviewOpen] = useState(false);

  const heroFileRef = useRef<HTMLInputElement>(null);

  // Drag state for playlist reorder
  const dragIdx = useRef<number | null>(null);
  // Drag state for project reorder
  const projectDragIdx = useRef<number | null>(null);
  const trackSearchRequestRef = useRef(0);
  const loadedTrackSearchRef = useRef<string | null>(null);
  const producerPickRequestRef = useRef(0);

  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openSection = (id: string) =>
    setOpenSections((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const producerPicksOpen = openSections.has('producer-picks');

  useEffect(() => {
    setVisibleTrackRows(TRACK_LIST_BATCH_SIZE);
  }, [trackSearch, allTracks.length]);

  const filteredTrackRows = useMemo(() => {
    const search = trackSearch.trim().toLowerCase();
    if (!search) return allTracks;
    return allTracks.filter((t) =>
      t.title.toLowerCase().includes(search) ||
      (t.key ?? '').toLowerCase().includes(search) ||
      String(t.bpm ?? '').includes(search)
    );
  }, [allTracks, trackSearch]);

  const renderedTrackRows = useMemo(
    () => filteredTrackRows.slice(0, visibleTrackRows),
    [filteredTrackRows, visibleTrackRows],
  );

  const loadTrackPage = useCallback(async ({ cursor = null, append = false, search = '' }: {
    cursor?: string | null;
    append?: boolean;
    search?: string;
  } = {}) => {
    const normalizedSearch = search.trim();
    const requestId = append ? trackSearchRequestRef.current : ++trackSearchRequestRef.current;
    if (append) setTrackLoadingMore(true);
    try {
      const params = new URLSearchParams({
        paged: '1',
        lean: '1',
        limit: '100',
      });
      if (cursor) params.set('cursor', cursor);
      if (normalizedSearch) params.set('q', normalizedSearch);
      const res = await fetch(`/api/tracks?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      if (requestId !== trackSearchRequestRef.current) return [];
      const rows = ((data.tracks ?? []) as any[]).map(mapTrackRow).sort((a, b) => {
        if (a.store_listed && !b.store_listed) return -1;
        if (!a.store_listed && b.store_listed) return 1;
        if (a.store_sort_order != null && b.store_sort_order != null) return a.store_sort_order - b.store_sort_order;
        return a.title.localeCompare(b.title);
      });
      setAllTracks((prev) => {
        if (!append) return rows;
        const seen = new Set(prev.map((track) => track.id));
        return [...prev, ...rows.filter((track) => !seen.has(track.id))];
      });
      setTrackHasMore(Boolean(data.pageInfo?.hasMore));
      setTrackNextCursor(data.pageInfo?.nextCursor ?? null);
      loadedTrackSearchRef.current = normalizedSearch;
      return rows;
    } finally {
      if (append) setTrackLoadingMore(false);
    }
  }, []);

  const loadProducerPickPage = useCallback(async ({ cursor = null, append = false, search = '' }: {
    cursor?: string | null;
    append?: boolean;
    search?: string;
  } = {}) => {
    const requestId = append ? producerPickRequestRef.current : ++producerPickRequestRef.current;
    setProducerPickLoading(true);
    try {
      const params = new URLSearchParams({
        paged: '1',
        lean: '1',
        limit: '40',
        store_listed: '1',
      });
      if (cursor) params.set('cursor', cursor);
      if (search.trim()) params.set('q', search.trim());
      const res = await fetch(`/api/tracks?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      if (requestId !== producerPickRequestRef.current) return;
      const rows = ((data.tracks ?? []) as any[]).map(mapTrackRow);
      setProducerPickCandidates((prev) => {
        if (!append) return rows;
        const seen = new Set(prev.map((track) => track.id));
        return [...prev, ...rows.filter((track) => !seen.has(track.id))];
      });
      setProducerPickHasMore(Boolean(data.pageInfo?.hasMore));
      setProducerPickNextCursor(data.pageInfo?.nextCursor ?? null);
    } finally {
      if (requestId === producerPickRequestRef.current) setProducerPickLoading(false);
    }
  }, []);

  const refreshTrackSummary = useCallback(async () => {
    const res = await fetch('/api/tracks/store-summary');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
    const nextSummary: TrackStoreSummary = {
      ...data,
      producerPicks: ((data.producerPicks ?? []) as any[]).map(mapTrackRow),
    };
    setTrackSummary(nextSummary);
    return nextSummary;
  }, []);

  const patchTrackSummaryVisibility = useCallback((before: TrackRow, after: TrackRow) => {
    setTrackSummary((prev) => {
      if (!prev) return prev;
      const listedDelta = (after.store_listed ? 1 : 0) - (before.store_listed ? 1 : 0);
      const producerPicks = prev.producerPicks
        .filter((track) => track.id !== after.id)
        .concat(after.store_listed && after.store_featured ? [after] : [])
        .sort((a, b) => (a.store_sort_order ?? 9999) - (b.store_sort_order ?? 9999) || a.title.localeCompare(b.title))
        .slice(0, 12);
      return {
        ...prev,
        listed: Math.max(0, prev.listed + listedDelta),
        producerPicks,
      };
    });
  }, []);

  useEffect(() => {
    if (loading) return;
    const normalizedSearch = trackSearch.trim();
    if (loadedTrackSearchRef.current === normalizedSearch) return;
    const timer = setTimeout(() => {
      loadTrackPage({ search: trackSearch }).catch((err) => {
        toast.error('Could not search beats', err instanceof Error ? err.message : 'try again');
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [loadTrackPage, loading, trackSearch]);

  useEffect(() => {
    if (!producerPicksOpen) return;
    const timer = setTimeout(() => {
      loadProducerPickPage({ search: producerPickSearch }).catch((err) => {
        toast.error('Could not load listed beats', err instanceof Error ? err.message : 'try again');
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [loadProducerPickPage, producerPickSearch, producerPicksOpen]);

  const set = useCallback(
    (field: keyof ProfileForm) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setForm((f) => ({ ...f, [field]: e.target.value })),
    [],
  );

  const loadTrackLicenseLinks = useCallback(async (trackIds: string[]) => {
    if (trackIds.length === 0) return;
    const entries = await Promise.all(
      trackIds.map(async (trackId) => {
        try {
          const res = await fetch(`/api/track-licenses?track_id=${trackId}`);
          if (!res.ok) return [trackId, []] as const;
          const data = await res.json();
          const rows = (Array.isArray(data) ? data : data.licenses ?? []) as Array<TrackLicenseLink & { id?: string }>;
          return [
            trackId,
            rows.map((row) => ({
              license_id: row.license_id ?? row.id ?? '',
              enabled: row.enabled !== false,
              linked: !!row.linked,
              price_override_usd: row.price_override_usd ?? null,
            })).filter((row) => row.license_id),
          ] as const;
        } catch {
          return [trackId, []] as const;
        }
      }),
    );
    setTrackLicenseLinks((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }, []);

  /* ── Load ── */
  useEffect(() => {
    (async () => {
      try {
        const [profileRes, playlistRes, storeRes, trackSummaryRes, projectsRes, promoRes, licensesRes] = await Promise.all([
          fetch('/api/profile'),
          fetch('/api/playlists'),
          fetch('/api/store'),
          fetch('/api/tracks/store-summary'),
          fetch('/api/projects'),
          fetch('/api/promo-codes'),
          fetch('/api/licenses'),
        ]);
        const [pd, pld, sd, summaryData, prd, promod, ld] = await Promise.all([
          profileRes.json(), playlistRes.json(), storeRes.json(), trackSummaryRes.json(), projectsRes.json(), promoRes.json(), licensesRes.json(),
        ]);
        const loadedGlobalLicenses = ((ld.licenses ?? []) as GlobalLicense[])
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        setGlobalLicenses(loadedGlobalLicenses);
        setPromoCodes(promod.codes ?? []);
        setTrackSummary({
          ...summaryData,
          producerPicks: ((summaryData.producerPicks ?? []) as any[]).map(mapTrackRow),
        });
        const firstTrackPage = await loadTrackPage({ search: '' });
        void loadTrackLicenseLinks(firstTrackPage.filter((t) => t.store_listed).map((t) => t.id));
        setPreviewTracks((summaryData.producerPicks ?? []).slice(0, 3).map(mapTrackRow));
        const p = pd.profile ?? {};
        setForm({
          display_name: p.display_name ?? '',
          bio: p.bio ?? '',
          credits: p.credits ?? '',
          hero_image_url: p.hero_image_url ?? '',
          accent_color: p.accent_color ?? '#E7D7BE',
          font_style: p.font_style ?? 'default',
          text_color_primary: p.text_color_primary ?? '#F7EBDD',
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
  }, [loadTrackLicenseLinks, loadTrackPage]);

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
  const moveFeaturedPlaylist = (idx: number, direction: -1 | 1) =>
    setFeatured((prev) => moveArrayItem(prev, idx, direction));

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
  const moveFeaturedProject = (idx: number, direction: -1 | 1) =>
    setFeaturedProjects((prev) => moveArrayItem(prev, idx, direction));

  /* ── Drag-reorder for listed beats (writes tracks.store_sort_order) ──
     Only the live (store_listed=true) rows are draggable. Drafts keep
     their position. After a drag ends, one bulk PATCH writes the 0-based
     store_sort_order so /store picks it up without a request storm. */
  const trackDragIdx = useRef<number | null>(null);
  const persistListedTrackOrder = async (listed: TrackRow[]) => {
    try {
      const res = await fetch('/api/tracks/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: listed.map((t, index) => ({
            id: t.id,
            store_sort_order: t.store_sort_order ?? index,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Order could not be saved');
      toast.success('Beat order saved');
    } catch (err) {
      toast.error('Order save failed', err instanceof Error ? err.message : 'try again');
    }
  };
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
    await persistListedTrackOrder(allTracks.filter((t) => t.store_listed));
  };

  const moveListedTrack = (idx: number, direction: -1 | 1) => {
    const listed = allTracks.filter((t) => t.store_listed);
    const moved = moveArrayItem(listed, idx, direction);
    if (moved === listed) return;
    const reordered = moved.map((track, order) => ({ ...track, store_sort_order: order }));
    setAllTracks([...reordered, ...allTracks.filter((t) => !t.store_listed)]);
    setPreviewTracks(reordered.slice(0, 3));
    void persistListedTrackOrder(reordered);
  };

  /* ── Track listing toggle ── */
  const toggleTrackListed = async (trackId: string, currentlyListed: boolean) => {
    setTogglingTrack(trackId);
    const nextState = !currentlyListed;
    const before = allTracks.find((track) => track.id === trackId);
    const after = before ? { ...before, store_listed: nextState } : null;
    if (before && after) patchTrackSummaryVisibility(before, after);
    setAllTracks((prev) => {
      const updated = prev.map((t) => t.id === trackId ? { ...t, store_listed: nextState } : t);
      setPreviewTracks(updated.filter((t) => t.store_listed).slice(0, 3));
      return updated;
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
      if (nextState) void loadTrackLicenseLinks([trackId]);
      void refreshTrackSummary().catch(() => {});
      // Followers are notified by the hourly digest cron (one email covering
      // everything newly listed) instead of one email per beat — so listing a
      // batch never spams. drop_notified_at (NULL = pending) is the queue;
      // the cron stamps it after the digest sends.
    } catch (err: any) {
      // Rollback
      if (before && after) patchTrackSummaryVisibility(after, before);
      setAllTracks((prev) =>
        prev.map((t) => t.id === trackId ? { ...t, store_listed: currentlyListed } : t),
      );
      const restored = allTracks.map((t) => t.id === trackId ? { ...t, store_listed: currentlyListed } : t);
      setPreviewTracks(restored.filter((t) => t.store_listed).slice(0, 3));
      toast.error('Failed to update', err.message);
    } finally {
      setTogglingTrack(null);
    }
  };

  /* ── Track featured toggle (migration 054) ── */
  const toggleTrackFeatured = async (trackId: string, currentlyFeatured: boolean) => {
    const nextState = !currentlyFeatured;
    const currentPickCount = trackSummary?.producerPicks.length ?? allTracks.filter((t) => t.store_listed && t.store_featured).length;
    if (nextState && currentPickCount >= 12) {
      toast.error("Producer's Picks is full", 'Remove one pick before adding another.');
      return;
    }
    const before = allTracks.find((track) => track.id === trackId)
      ?? producerPickCandidates.find((track) => track.id === trackId)
      ?? trackSummary?.producerPicks.find((track) => track.id === trackId);
    const after = before ? { ...before, store_featured: nextState } : null;
    if (before && after) patchTrackSummaryVisibility(before, after);
    if (before) {
      setProducerPickCandidates((prev) => nextState
        ? prev.filter((track) => track.id !== trackId)
        : [...prev.filter((track) => track.id !== trackId), { ...before, store_featured: false }]);
    }
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
      void refreshTrackSummary().catch(() => {});
    } catch (err: any) {
      // Rollback
      if (before && after) patchTrackSummaryVisibility(after, before);
      setAllTracks((prev) =>
        prev.map((t) => t.id === trackId ? { ...t, store_featured: currentlyFeatured } : t),
      );
      if (before) {
        setProducerPickCandidates((prev) => currentlyFeatured
          ? prev.filter((track) => track.id !== trackId)
          : [...prev.filter((track) => track.id !== trackId), before]);
      }
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

  const toggleFreeDownload = async (trackId: string, currentlyOn: boolean) => {
    const nextState = !currentlyOn;
    setAllTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, free_download_enabled: nextState } : t));
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ free_download_enabled: nextState }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      toast.success(nextState ? 'Free download on' : 'Free download off');
    } catch (err: any) {
      setAllTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, free_download_enabled: currentlyOn } : t));
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
        accent_color: form.accent_color || '#E7D7BE',
        font_style: form.font_style || 'default',
        text_color_primary: form.text_color_primary || '#F7EBDD',
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
  const producerPicks = trackSummary?.producerPicks ?? allTracks.filter((t) => t.store_listed && t.store_featured).slice(0, 12);
  const producerPickIds = new Set(producerPicks.map((track) => track.id));
  const availableProducerPicks = producerPickCandidates.filter((track) => !producerPickIds.has(track.id));

  const hasReadyPrice = (track: TrackRow): boolean => {
    const legacyReady = (
      (track.lease_price_usd != null && track.lease_price_usd > 0)
      || (track.exclusive_price_usd != null && track.exclusive_price_usd > 0)
      || Number(form.license_lease_price_usd) > 0
      || Number(form.license_exclusive_price_usd) > 0
    );
    if (globalLicenses.length === 0) return legacyReady;

    const links = trackLicenseLinks[track.id] ?? [];
    const useLinked = links.some((link) => link.linked);
    const activeTiers = globalLicenses.filter((license) => {
      if (!useLinked) return true;
      const link = links.find((row) => row.license_id === license.id);
      return !!link?.linked && link.enabled;
    });
    const tierReady = activeTiers.some((license) => {
      if (license.is_free) return true;
      const override = links.find((row) => row.license_id === license.id)?.price_override_usd;
      return Number(override ?? license.price_usd) > 0;
    });
    return tierReady || (activeTiers.length === 0 && legacyReady);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 size={20} className="animate-spin text-[#837B6D]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer className="md:pt-10 pb-32">

        {/* ── Page header ── */}
        <div className="mb-5 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF] mb-1">Dashboard</p>
            <h1 className="text-[28px] sm:text-[36px] font-bold tracking-tight text-white leading-none font-heading">
              Store Editor
            </h1>
            <p className="mt-1.5 max-w-[58ch] text-[12px] leading-relaxed text-[#B4AA99]">
              Customise your public beatstore — changes go live instantly on save.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto pb-1 sm:mt-1 sm:justify-end sm:pb-0">
            {/* Mobile preview toggle */}
            <button
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-[11px] text-[#D0C3AF] transition-colors hover:bg-white/[0.08] hover:text-white lg:hidden"
            >
              {previewOpen ? <EyeOff size={12} /> : <Eye size={12} />}
              Preview
            </button>
            <a
              href="/store"
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-[11px] text-[#D0C3AF] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <ExternalLink size={12} />
              View Store
            </a>
            {/* Save — button-in-button island architecture */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex shrink-0 items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-[12px] font-semibold text-black active:scale-[0.97] disabled:opacity-60"
              style={{
                backgroundColor: '#E7D7BE',
                transition: 'all 400ms cubic-bezier(0.32,0.72,0,1)',
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
              <span className="w-7 h-7 rounded-full bg-black/15 flex items-center justify-center shrink-0">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              </span>
            </button>
          </div>
        </div>

        {/* ── Two-column layout ── */}
        <div className="flex gap-6 lg:gap-8 items-start">

          {/* ── Left: editor panels ── */}
          <div className={`flex-1 min-w-0 space-y-3 ${previewOpen ? 'hidden lg:block' : ''}`}>
            <div className="rounded-2xl border border-[#2B2821] bg-[#11100D] p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#D0C3AF]">Start with Hero</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#837B6D]">
                    Sections stay closed until you open them, keeping the editor calm on mobile.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openSection('hero')}
                  className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#E7D7BE] px-4 py-2 text-[11px] font-semibold text-black transition-colors hover:bg-[#F3E6D1] active:scale-[0.98]"
                >
                  Open Hero
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { id: 'playlists', label: 'Playlists', value: `${featured.length}/5` },
                  { id: 'projects', label: 'Projects', value: `${featuredProjects.length}/5` },
                  { id: 'producer-picks', label: 'Picks', value: `${producerPicks.length}/12` },
                  { id: 'tracks', label: 'Beats live', value: String(trackSummary?.listed ?? allTracks.filter((t) => t.store_listed).length) },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openSection(item.id)}
                    className="rounded-xl border border-[#211F1A] bg-[#090907] px-3 py-2 text-left transition-colors hover:border-[#3B372F] hover:bg-[#171511]"
                  >
                    <span className="block text-[15px] font-semibold text-[#F7EBDD]">{item.value}</span>
                    <span className="mt-0.5 block truncate text-[9px] font-mono uppercase tracking-[0.16em] text-[#6E685B]">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ① Hero Section */}
            <Section
              id="hero"
              title="Hero Section"
              icon={<ImageIcon size={15} />}
              open={openSections.has('hero')}
              onToggle={() => toggleSection('hero')}
              badge={form.display_name || 'identity, hero image, colors'}
            >
              {/* Hero image */}
              <Field label="Hero Background Image">
                <div className="flex items-start gap-3">
                  <div
                    className="w-24 h-16 rounded-lg border border-[#2B2821] overflow-hidden bg-[#11100D] shrink-0 cursor-pointer hover:border-[#E7D7BE]/40 transition-colors relative group"
                    onClick={() => heroFileRef.current?.click()}
                  >
                    {form.hero_image_url ? (
                      <img src={form.hero_image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#6E685B]">
                        <ImageIcon size={18} />
                      </div>
                    )}
                    {heroUploading ? (
                      <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                        <Loader2 size={14} className="animate-spin text-[#E7D7BE]" />
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
                    <p className="text-[9px] font-mono text-[#6E685B] mt-1">
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
                  <div className="flex items-center gap-2 bg-[#11100D] border border-[#2B2821] rounded-lg px-3 py-1.5">
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
                      placeholder="#E7D7BE"
                      className="w-20 bg-transparent text-[12px] text-[#F7EBDD] focus:outline-none font-mono"
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
                          ? 'bg-[#342F27] border-[#C9BCA8]/40 text-[#F3E6D1]'
                          : 'bg-[#11100D] border-[#2B2821] text-[#B4AA99] hover:text-[#F7EBDD] hover:border-[#3B372F]'
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
                  <div className="flex items-center gap-2 bg-[#11100D] border border-[#2B2821] rounded-lg px-3 py-1.5">
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
                      placeholder="#F7EBDD"
                      className="w-20 bg-transparent text-[12px] text-[#F7EBDD] focus:outline-none font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, text_color_primary: '#F7EBDD' }))}
                    className="text-[10px] font-mono text-[#9B9282] hover:text-[#F7EBDD] transition-colors"
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
              badge={`${[
                form.instagram_handle,
                form.twitter_handle,
                form.spotify_url,
                form.soundcloud_url,
                form.website_url,
                form.contact_email,
              ].filter(Boolean).length} connected`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Instagram Handle">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#9B9282]">@</span>
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
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#9B9282]">@</span>
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
              badge={`${featured.length}/5 featured`}
            >
              <p className="text-[11px] text-[#9B9282]">
                Up to 5 playlists shown in your store hero. Drag or use the arrow controls to reorder.
              </p>

              {/* Featured list (drag-sortable) */}
              {featured.length > 0 ? (
                <div className="max-h-[300px] space-y-1 overflow-y-auto overscroll-contain pr-1">
                  {featured.map((pl, idx) => (
                    <div
                      key={pl.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                      className="group flex min-w-0 select-none items-center gap-3 rounded-xl border border-[#2B2821] bg-[#11100D] px-3 py-2.5 transition-colors hover:border-[#3B372F] sm:cursor-grab sm:active:cursor-grabbing"
                    >
                      <GripVertical size={13} className="text-[#6E685B] group-hover:text-[#9B9282] shrink-0" />
                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#211F1A] border border-[#3B372F] shrink-0">
                        {pl.cover_url
                          ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><ListMusic size={12} className="text-[#6E685B]" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#F7EBDD] truncate">{pl.name}</p>
                        <p className="text-[10px] font-mono text-[#9B9282]">{pl.track_count} track{pl.track_count !== 1 ? 's' : ''}</p>
                      </div>
                      <span className="hidden shrink-0 rounded border border-[#6DC6A4]/20 bg-[#6DC6A4]/10 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider text-[#6DC6A4] sm:inline-flex">
                        Featured
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveFeaturedPlaylist(idx, -1)}
                          disabled={idx === 0}
                          aria-label={`Move ${pl.name} up`}
                          className="grid h-9 w-9 place-items-center rounded-md border border-[#2B2821] bg-white/[0.03] text-[#B4AA99] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD] disabled:cursor-not-allowed disabled:opacity-25 sm:h-7 sm:w-7"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFeaturedPlaylist(idx, 1)}
                          disabled={idx === featured.length - 1}
                          aria-label={`Move ${pl.name} down`}
                          className="grid h-9 w-9 place-items-center rounded-md border border-[#2B2821] bg-white/[0.03] text-[#B4AA99] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD] disabled:cursor-not-allowed disabled:opacity-25 sm:h-7 sm:w-7"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromFeatured(pl.id)}
                        aria-label={`Remove ${pl.name} from featured playlists`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#2B2821] bg-white/[0.04] text-[#9B9282] transition-colors hover:border-red-900/40 hover:text-red-400 sm:h-7 sm:w-7"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#2B2821] py-8 text-center text-[#9B9282] text-[12px]">
                  No featured playlists yet. Add one below.
                </div>
              )}

              {/* Available playlists to add */}
              {unfeatured.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#6E685B] mb-2">
                    Add to featured {featured.length}/5
                  </p>
                  <div className="max-h-[300px] space-y-1 overflow-y-auto overscroll-contain pr-1">
                    {unfeatured.map((pl) => (
                      <div
                        key={pl.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#090907] border border-[#211F1A] hover:border-[#3B372F] transition-colors"
                      >
                        <div className="w-8 h-8 rounded-md overflow-hidden bg-[#211F1A] border border-[#3B372F] shrink-0">
                          {pl.cover_url
                            ? <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center"><ListMusic size={10} className="text-[#6E685B]" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-[#D0C3AF] truncate">{pl.name}</p>
                          <p className="text-[9px] font-mono text-[#6E685B]">{pl.track_count} tracks</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addToFeatured(pl)}
                          disabled={featured.length >= 5}
                          className="w-6 h-6 rounded-full bg-white/[0.04] border border-[#2B2821] flex items-center justify-center text-[#9B9282] hover:text-[#6DC6A4] hover:border-[#6DC6A4]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {playlists.length === 0 && (
                <p className="text-[11px] text-[#6E685B]">
                  No playlists yet — create some in{' '}
                  <a href="/playlists" className="text-[#D0C3AF] underline underline-offset-2 hover:text-[#E7D7BE] transition-colors">
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
              badge={`${featuredProjects.length}/5 featured`}
            >
              <p className="text-[11px] text-[#9B9282]">
                Up to 5 projects shown in your store. Drag or use the arrow controls to reorder.
              </p>

              {featuredProjects.length > 0 ? (
                <div className="max-h-[300px] space-y-1 overflow-y-auto overscroll-contain pr-1">
                  {featuredProjects.map((pr, idx) => (
                    <div
                      key={pr.id}
                      draggable
                      onDragStart={() => handleProjectDragStart(idx)}
                      onDragOver={(e) => handleProjectDragOver(e, idx)}
                      onDragEnd={handleProjectDragEnd}
                      className="group flex min-w-0 select-none items-center gap-3 rounded-xl border border-[#2B2821] bg-[#11100D] px-3 py-2.5 transition-colors hover:border-[#3B372F] sm:cursor-grab sm:active:cursor-grabbing"
                    >
                      <GripVertical size={13} className="text-[#6E685B] group-hover:text-[#9B9282] shrink-0" />
                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#211F1A] border border-[#3B372F] shrink-0">
                        {pr.cover_url
                          ? <img src={pr.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><Layers size={12} className="text-[#6E685B]" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#F7EBDD] truncate">{pr.name}</p>
                        {pr.price_usd != null && (
                          <p className="text-[10px] font-mono text-[#9B9282]">${pr.price_usd}</p>
                        )}
                      </div>
                      <span className="hidden shrink-0 rounded border border-[#6DC6A4]/20 bg-[#6DC6A4]/10 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider text-[#6DC6A4] sm:inline-flex">
                        Featured
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveFeaturedProject(idx, -1)}
                          disabled={idx === 0}
                          aria-label={`Move ${pr.name} up`}
                          className="grid h-9 w-9 place-items-center rounded-md border border-[#2B2821] bg-white/[0.03] text-[#B4AA99] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD] disabled:cursor-not-allowed disabled:opacity-25 sm:h-7 sm:w-7"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFeaturedProject(idx, 1)}
                          disabled={idx === featuredProjects.length - 1}
                          aria-label={`Move ${pr.name} down`}
                          className="grid h-9 w-9 place-items-center rounded-md border border-[#2B2821] bg-white/[0.03] text-[#B4AA99] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD] disabled:cursor-not-allowed disabled:opacity-25 sm:h-7 sm:w-7"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeProjectFromFeatured(pr.id)}
                        aria-label={`Remove ${pr.name} from featured projects`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#2B2821] bg-white/[0.04] text-[#9B9282] transition-colors hover:border-red-900/40 hover:text-red-400 sm:h-7 sm:w-7"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#2B2821] py-8 text-center text-[#9B9282] text-[12px]">
                  No featured projects yet. Add one below.
                </div>
              )}

              {unfeaturedProjects.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#6E685B] mb-2">
                    Add to featured {featuredProjects.length}/5
                  </p>
                  <div className="max-h-[300px] space-y-1 overflow-y-auto overscroll-contain pr-1">
                    {unfeaturedProjects.map((pr) => (
                      <div
                        key={pr.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#090907] border border-[#211F1A] hover:border-[#3B372F] transition-colors"
                      >
                        <div className="w-8 h-8 rounded-md overflow-hidden bg-[#211F1A] border border-[#3B372F] shrink-0">
                          {pr.cover_url
                            ? <img src={pr.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center"><Layers size={10} className="text-[#6E685B]" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-[#D0C3AF] truncate">{pr.name}</p>
                          {pr.price_usd != null && (
                            <p className="text-[9px] font-mono text-[#6E685B]">${pr.price_usd}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => addProjectToFeatured(pr)}
                          disabled={featuredProjects.length >= 5}
                          className="w-6 h-6 rounded-full bg-white/[0.04] border border-[#2B2821] flex items-center justify-center text-[#9B9282] hover:text-[#6DC6A4] hover:border-[#6DC6A4]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {projects.length === 0 && (
                <p className="text-[11px] text-[#6E685B]">
                  No projects yet — create some in{' '}
                  <a href="/projects" className="text-[#D0C3AF] underline underline-offset-2 hover:text-[#E7D7BE] transition-colors">
                    Projects
                  </a>.
                </p>
              )}
            </Section>

            <Section
              id="producer-picks"
              title="Producer's Picks"
              icon={<Star size={15} />}
              open={producerPicksOpen}
              onToggle={() => toggleSection('producer-picks')}
              badge={`${producerPicks.length}/12 selected`}
            >
              <div className="rounded-xl border border-[#2B2821] bg-[#090907] p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] text-[#D0C3AF]">
                      These beats appear in the Producer&apos;s Picks strip on the public store.
                    </p>
                    <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.16em] text-[#6E685B]">
                      Listed beats only · max 12
                    </p>
                  </div>
                  <a
                    href="/store"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-[#2B2821] px-3 text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD]"
                  >
                    <ExternalLink size={11} />
                    View store
                  </a>
                </div>
              </div>

              {producerPicks.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {producerPicks.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 rounded-xl border border-[#D6BE7A]/25 bg-[#D6BE7A]/[0.06] px-3 py-2">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-[#D6BE7A]/20 bg-[#11100D]">
                        {t.cover_url
                          ? <img src={t.cover_url} alt="" className="h-full w-full object-cover" />
                          : <div className="flex h-full w-full items-center justify-center text-[#6E685B]"><Music size={13} /></div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-[#F7EBDD]">{t.title}</p>
                        <p className="truncate text-[9px] font-mono uppercase tracking-wider text-[#9B9282]">
                          {[t.type, t.bpm ? `${t.bpm} BPM` : null, t.key].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleTrackFeatured(t.id, true)}
                        title="Remove from Producer's Picks"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#D6BE7A]/25 text-[#D6BE7A] transition-colors hover:bg-[#D6BE7A]/10"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#2B2821] py-8 text-center">
                  <Star size={18} className="mx-auto mb-2 text-[#3B372F]" />
                  <p className="text-[12px] text-[#9B9282]">No producer picks selected yet.</p>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-[#6E685B]">
                    Add from listed beats
                  </p>
                  <span className="text-[9px] font-mono text-[#6E685B]">Searches all listed beats</span>
                </div>
                <div className="relative mb-2">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6E685B]" />
                  <input
                    type="search"
                    value={producerPickSearch}
                    onChange={(event) => setProducerPickSearch(event.target.value)}
                    placeholder="Search by title, key, or BPM"
                    className={`${inputCls} pl-8`}
                  />
                </div>
                {producerPickLoading && availableProducerPicks.length === 0 ? (
                  <div className="flex min-h-20 items-center justify-center rounded-xl border border-[#211F1A] bg-[#090907]">
                    <Loader2 size={15} className="animate-spin text-[#837B6D]" />
                  </div>
                ) : availableProducerPicks.length > 0 ? (
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {availableProducerPicks
                      .map((t) => (
                        <div key={t.id} className="flex items-center gap-3 rounded-xl border border-[#211F1A] bg-[#090907] px-3 py-2">
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-[#2B2821] bg-[#11100D]">
                            {t.cover_url
                              ? <img src={t.cover_url} alt="" className="h-full w-full object-cover" />
                              : <div className="flex h-full w-full items-center justify-center text-[#6E685B]"><Music size={12} /></div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] text-[#F7EBDD]">{t.title}</p>
                            <p className="truncate text-[9px] font-mono uppercase tracking-wider text-[#837B6D]">
                              {[t.type, t.bpm ? `${t.bpm} BPM` : null, t.key].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleTrackFeatured(t.id, false)}
                            disabled={producerPicks.length >= 12}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#2B2821] text-[#D0C3AF] transition-colors hover:border-[#D6BE7A]/40 hover:text-[#D6BE7A] disabled:cursor-not-allowed disabled:opacity-30"
                            title="Add to Producer's Picks"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      ))}
                    {producerPickHasMore && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!producerPickNextCursor || producerPickLoading) return;
                          loadProducerPickPage({
                            cursor: producerPickNextCursor,
                            append: true,
                            search: producerPickSearch,
                          }).catch((err) => {
                            toast.error('Could not load more listed beats', err instanceof Error ? err.message : 'try again');
                          });
                        }}
                        disabled={producerPickLoading}
                        className="mt-2 w-full rounded-xl border border-[#2B2821] bg-[#11100D] px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[#D0C3AF] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD] disabled:cursor-wait disabled:opacity-60"
                      >
                        {producerPickLoading ? 'Loading beats...' : 'Load more listed beats'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#2B2821] py-6 text-center">
                    <p className="text-[11px] text-[#837B6D]">
                      {producerPickSearch.trim() ? 'No listed beats match this search.' : 'Every listed beat is already selected.'}
                    </p>
                  </div>
                )}
              </div>
            </Section>

            {/* ④ Track Listing — publish tracks to the store */}
            <Section
              id="tracks"
              title="Beat Listing"
              icon={<ShoppingBag size={15} />}
              open={openSections.has('tracks')}
              onToggle={() => toggleSection('tracks')}
              badge={`${trackSummary?.listed ?? allTracks.filter((t) => t.store_listed).length} listed`}
            >
              <p className="text-[11px] text-[#9B9282]">
                Toggle beats on or off to control what appears in your public store. To set prices and cover art, open the beat in your{' '}
                <a href="/library" className="text-[#D0C3AF] underline underline-offset-2 hover:text-[#E7D7BE] transition-colors">Library</a>.
              </p>

              {/* Search */}
              {(trackSummary?.total ?? allTracks.length) > 4 && (
                <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6E685B]" />
                  <input
                    type="text"
                    value={trackSearch}
                    onChange={(e) => setTrackSearch(e.target.value)}
                    placeholder="Search beats…"
                    className="w-full bg-[#11100D] border border-[#2B2821] rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] transition-colors"
                  />
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-3 text-[10px] font-mono text-[#9B9282]">
                <span className="px-2 py-0.5 rounded bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 text-[#6DC6A4] font-bold">
                  {trackSummary?.listed ?? allTracks.filter((t) => t.store_listed).length} listed
                </span>
                <span>{trackSummary?.total ?? allTracks.length} total beats</span>
                {trackSearch.trim() && <span>{filteredTrackRows.length} matching</span>}
              </div>

              {/* Needs attention — surfaces listed beats with quality
                  issues that hurt conversion (no cover, no price set, no
                  BPM/key metadata). Producer can fix in /library. */}
              {(() => {
                const listed = allTracks.filter((t) => t.store_listed);
                const noCover = trackSummary?.issues.noCover ?? { count: listed.filter((t) => !t.cover_url).length, firstId: listed.find((t) => !t.cover_url)?.id ?? null };
                const noPrice = trackSummary?.issues.noPrice ?? { count: listed.filter((t) => !hasReadyPrice(t)).length, firstId: listed.find((t) => !hasReadyPrice(t))?.id ?? null };
                const noBpmKey = trackSummary?.issues.noBpmKey ?? { count: listed.filter((t) => t.bpm == null && !t.key).length, firstId: listed.find((t) => t.bpm == null && !t.key)?.id ?? null };
                const issues = [
                  noCover.count > 0 && noCover.firstId && { label: 'no cover art', count: noCover.count, firstId: noCover.firstId },
                  noPrice.count > 0 && noPrice.firstId && { label: 'no price set', count: noPrice.count, firstId: noPrice.firstId },
                  noBpmKey.count > 0 && noBpmKey.firstId && { label: 'no BPM or key', count: noBpmKey.count, firstId: noBpmKey.firstId },
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
                            className="text-[11px] text-[#D0C3AF] hover:text-amber-300 flex items-center gap-2 group"
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
              {(trackSummary?.total ?? allTracks.length) === 0 ? (
                <div className="rounded-xl border border-dashed border-[#2B2821] py-10 text-center">
                  <Music size={20} className="text-[#3B372F] mx-auto mb-2" />
                  <p className="text-[12px] text-[#9B9282]">No beats in your library yet.</p>
                  <a href="/library" className="mt-2 inline-block text-[10px] font-mono text-[#D0C3AF] hover:text-[#E7D7BE] underline underline-offset-2 transition-colors">
                    Upload your first beat →
                  </a>
                </div>
              ) : (
                <div className="max-h-[60dvh] space-y-1 overflow-y-auto overscroll-contain pr-1 sm:max-h-[480px]">
                  {(() => {
                    // Index map (within the *listed* subset) so the drag
                    // handlers know which slot a row occupies. Drafts are
                    // appended below and not draggable.
                    const listedIds: string[] = allTracks
                      .filter((x) => x.store_listed)
                      .map((x) => x.id);
                    return renderedTrackRows
                      .map((t) => {
                        const listedIdx = listedIds.indexOf(t.id);
                        const isListed = listedIdx >= 0;
                        return (
                      <div key={t.id}>
                      <div
                        draggable={isListed}
                        onDragStart={() => { if (isListed) handleTrackDragStart(listedIdx); }}
                        onDragOver={(e) => { if (isListed) handleTrackDragOver(e, listedIdx); }}
                        onDragEnd={handleTrackDragEnd}
                        className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 transition-all sm:flex-nowrap sm:gap-3 ${
                          t.store_listed
                            ? 'bg-[#0e140e] border-[#6DC6A4]/20 hover:border-[#6DC6A4]/35 cursor-grab active:cursor-grabbing'
                            : 'bg-[#090907] border-[#211F1A] hover:border-[#2B2821]'
                        }`}
                      >
                        {/* Drag handle — only on listed rows */}
                        {isListed && (
                          <GripVertical size={13} className="hidden shrink-0 text-[#6E685B] hover:text-[#B4AA99] sm:block" />
                        )}
                        {/* Cover art */}
                        <div className="w-9 h-9 rounded-md overflow-hidden bg-[#211F1A] border border-[#3B372F] shrink-0">
                          {t.cover_url
                            ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={12} /></div>}
                        </div>

                        {/* Info */}
                        <div className="min-w-[120px] flex-1">
                          <p className={`text-[12px] font-medium truncate ${t.store_listed ? 'text-[#F7EBDD]' : 'text-[#D0C3AF]'}`}>
                            {t.title}
                          </p>
                          <p className="text-[9px] font-mono text-[#9B9282] uppercase tracking-wider">
                            {t.type}
                            {t.bpm ? ` · ${t.bpm} BPM` : ''}
                            {t.key ? ` · ${t.key}` : ''}
                          </p>
                        </div>

                        {/* Price badge (if set) */}
                        {t.lease_price_usd != null && (
                          <span className="hidden sm:block text-[9px] font-mono text-[#D0C3AF] tabular-nums shrink-0">
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
                          <span className="hidden sm:block text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 text-[#837B6D] bg-[#211F1A] border border-[#2B2821]">
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
                                  : 'bg-white/[0.03] border-[#2B2821] text-[#9B9282] hover:text-amber-300 hover:border-amber-500/30'
                              }`}
                            >
                              <Clock size={12} />
                            </button>
                            {scheduleOpenFor === t.id && (
                              <div className="absolute right-0 top-9 z-30 w-64 rounded-xl bg-[#11100D] border border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.6)] p-3">
                                <p className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282] mb-2">
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
                                    className="flex-1 px-3 py-2 rounded-md bg-[#E7D7BE] text-black text-[10px] font-bold uppercase tracking-wider hover:bg-[#F3E6D1] transition-colors disabled:opacity-40"
                                  >
                                    Schedule
                                  </button>
                                  {t.scheduled_publish_at && (
                                    <button
                                      onClick={async () => {
                                        await setSchedule(t.id, null);
                                        setScheduleOpenFor(null);
                                      }}
                                      className="px-3 py-2 rounded-md border border-[#3B372F] text-[#D0C3AF] text-[10px] font-mono uppercase tracking-wider hover:text-white hover:border-[#6E685B] transition-colors"
                                    >
                                      Clear
                                    </button>
                                  )}
                                </div>
                                {t.scheduled_publish_at && (
                                  <p className="mt-2 text-[10px] text-[#9B9282]">
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
                                ? 'bg-[#D6BE7A]/15 border-[#D6BE7A]/40 text-[#D6BE7A]'
                                : 'bg-white/[0.03] border-[#2B2821] text-[#9B9282] hover:text-[#D6BE7A] hover:border-[#D6BE7A]/30'
                            }`}
                          >
                            <Star size={12} fill={t.store_featured ? 'currentColor' : 'none'} />
                          </button>
                        )}

                        {/* License tier panel toggle — listed tracks only */}
                        {t.store_listed && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveListedTrack(listedIdx, -1)}
                              disabled={listedIdx === 0}
                              aria-label={`Move ${t.title} up`}
                              className="grid h-9 w-9 place-items-center rounded-md border border-[#2B2821] bg-white/[0.03] text-[#B4AA99] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD] disabled:cursor-not-allowed disabled:opacity-25 sm:h-7 sm:w-7"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveListedTrack(listedIdx, 1)}
                              disabled={listedIdx === listedIds.length - 1}
                              aria-label={`Move ${t.title} down`}
                              className="grid h-9 w-9 place-items-center rounded-md border border-[#2B2821] bg-white/[0.03] text-[#B4AA99] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD] disabled:cursor-not-allowed disabled:opacity-25 sm:h-7 sm:w-7"
                            >
                              <ArrowDown size={12} />
                            </button>
                          </div>
                        )}

                        {t.store_listed && (
                          <button
                            onClick={() => {
                              if (licenseExpandedFor.has(t.id)) void loadTrackLicenseLinks([t.id]);
                              setLicenseExpandedFor((prev) => {
                                const next = new Set(prev);
                                if (next.has(t.id)) next.delete(t.id);
                                else next.add(t.id);
                                return next;
                              });
                            }}
                            title="Configure license tiers for this beat"
                            className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center border transition-colors ${
                              licenseExpandedFor.has(t.id)
                                ? 'bg-[#E7D7BE]/15 border-[#E7D7BE]/40 text-[#E7D7BE]'
                                : 'bg-white/[0.03] border-[#2B2821] text-[#9B9282] hover:text-[#E7D7BE] hover:border-[#E7D7BE]/30'
                            }`}
                          >
                            <Layers size={12} />
                          </button>
                        )}

                        {/* Free-download toggle — listed tracks only. Green when on. */}
                        {t.store_listed && (
                          <button
                            onClick={() => toggleFreeDownload(t.id, t.free_download_enabled)}
                            title={t.free_download_enabled ? 'Free download on — click to disable' : 'Enable free download (email-gated)'}
                            className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center border transition-colors ${
                              t.free_download_enabled
                                ? 'bg-[#6DC6A4]/15 border-[#6DC6A4]/40 text-[#6DC6A4]'
                                : 'bg-white/[0.03] border-[#2B2821] text-[#9B9282] hover:text-[#6DC6A4] hover:border-[#6DC6A4]/30'
                            }`}
                          >
                            <Download size={12} />
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
                                : 'bg-white/[0.03] border-[#2B2821] text-[#9B9282] hover:text-[#9d95e8] hover:border-[#9d95e8]/30'
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
                            t.store_listed ? 'bg-[#6DC6A4]' : 'bg-[#2B2821]'
                          }`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            t.store_listed ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                      {/* Per-track license panel — expands below the row */}
                      {licenseExpandedFor.has(t.id) && (
                        <div className="mx-3 mb-1 px-3 py-3 rounded-xl bg-[#090907] border border-[#E7D7BE]/20">
                          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#E7D7BE] mb-2">License tiers for this beat</p>
                          <TrackLicensePanel trackId={t.id} globalLicenses={globalLicenses} />
                        </div>
                      )}
                      </div>
                        );
                      });
                  })()}
                  {visibleTrackRows < filteredTrackRows.length && (
                    <button
                      type="button"
                      onClick={() => setVisibleTrackRows((count) => count + TRACK_LIST_BATCH_SIZE)}
                      className="mt-2 w-full rounded-xl border border-[#2B2821] bg-[#11100D] px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-[#D0C3AF] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD]"
                    >
                      Load more beats · {Math.min(TRACK_LIST_BATCH_SIZE, filteredTrackRows.length - visibleTrackRows)} more
                    </button>
                  )}
                  {trackHasMore && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!trackNextCursor || trackLoadingMore) return;
                        loadTrackPage({ cursor: trackNextCursor, append: true }).catch((err) => {
                          toast.error('Could not load more beats', err instanceof Error ? err.message : 'try again');
                        });
                      }}
                      disabled={trackLoadingMore}
                      className="mt-2 w-full rounded-xl border border-[#2B2821] bg-[#11100D] px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-[#D0C3AF] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD] disabled:cursor-wait disabled:opacity-60"
                    >
                      {trackLoadingMore ? 'Loading beats...' : 'Load next 100 beats'}
                    </button>
                  )}
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
              badge={form.bundle_discount_threshold && form.bundle_discount_percent ? 'bundle discount on' : 'defaults & notes'}
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
                    <span className="text-[11px] text-[#B4AA99]">items →</span>
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
                    <span className="text-[11px] text-[#B4AA99]">% off</span>
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
              badge={form.seo_title || form.seo_description || form.og_image_url ? 'custom share data' : 'uses store defaults'}
            >
              <p className="text-[11px] text-[#9B9282]">
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
                <p className="mt-1 text-[9px] font-mono text-[#6E685B] tabular-nums">{form.seo_title.length}/70</p>
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
                <p className="mt-1 text-[9px] font-mono text-[#6E685B] tabular-nums">{form.seo_description.length}/180</p>
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
                  <div className="mt-2 rounded-lg overflow-hidden border border-[#2B2821] max-w-md">
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
              badge={`${form.share_card_style || 'default'} card · ${form.share_video_style || 'default'} video`}
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
              badge={form.voice_tag_url ? `every ${form.voice_tag_interval_seconds || '20'}s` : 'not uploaded'}
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
              badge={form.license_template_md.trim() ? 'custom contract' : 'default contract'}
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
              badge="batch tool"
            >
              <p className="text-[11px] text-[#9B9282]">
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
              badge={promoCodes.length > 0 ? `${promoCodes.length} code${promoCodes.length === 1 ? '' : 's'}` : undefined}
            >
              <p className="text-[11px] text-[#9B9282]">
                Create codes buyers can enter at checkout. Share them in DMs or auto-fill via <code className="font-mono text-[#D0C3AF]">/store/checkout?promo=YOUR_CODE</code>.
              </p>

              {/* Create form */}
              <div className="rounded-xl border border-[#2B2821] bg-[#11100D] p-4 space-y-3">
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E7D7BE] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#F3E6D1] transition-colors disabled:opacity-50"
                >
                  {promoCreating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Create code
                </button>
              </div>

              {/* Existing codes */}
              {promoCodes.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#6E685B]">Active &amp; recent ({promoCodes.length})</p>
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
                          dead ? 'bg-[#090907]/60 border-[#211F1A] opacity-65' : 'bg-[#0e140e] border-[#6DC6A4]/20'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-[13px] font-mono font-bold text-[#F7EBDD] tracking-wide">{c.code}</code>
                            <span className="text-[10px] font-mono text-[#D0C3AF]">{discountLabel}</span>
                            {expired && <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-300">Expired</span>}
                            {capped && <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">Used up</span>}
                            {!c.active && !expired && !capped && <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#211F1A] border border-[#3B372F] text-[#9B9282]">Paused</span>}
                          </div>
                          <p className="text-[10px] font-mono text-[#9B9282] mt-0.5">
                            {c.uses_count} / {c.max_uses ?? '∞'} uses
                            {c.expires_at && ` · expires ${new Date(c.expires_at).toLocaleDateString()}`}
                          </p>
                        </div>
                        <button
                          onClick={() => togglePromoActive(c.code, !c.active)}
                          disabled={!!expired || !!capped}
                          title={c.active ? 'Pause this code' : 'Reactivate'}
                          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                            c.active && !expired && !capped ? 'bg-[#6DC6A4]' : 'bg-[#2B2821]'
                          } disabled:opacity-40`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                            c.active && !expired && !capped ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                        <button
                          onClick={() => deletePromoCode(c.code)}
                          title="Delete"
                          className="w-7 h-7 rounded-md border border-[#2B2821] flex items-center justify-center text-[#9B9282] hover:text-red-400 hover:border-red-900/40 transition-colors"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#2B2821] py-6 text-center text-[#9B9282] text-[12px]">
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
              badge={`${globalLicenses.length} tier${globalLicenses.length === 1 ? '' : 's'}`}
            >
              <LicenseBuilder />
            </Section>

            {/* Mobile save shortcut */}
            <div className="pt-4 lg:hidden flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#E7D7BE] hover:bg-[#F3E6D1] disabled:opacity-60 text-black text-[12px] font-semibold transition-all"
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
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">Live Preview</p>
                <a
                  href="/store"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] font-mono text-[#B4AA99] hover:text-[#D0C3AF] flex items-center gap-1 transition-colors"
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
      </PageContainer>
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
      <p className="text-[11px] text-[#B4AA99] leading-relaxed">
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
            <p className="text-[12px] font-medium text-[#F7EBDD]">Voice tag set</p>
            <p className="text-[10px] font-mono text-[#9B9282] truncate">{value.split('/').pop()}</p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-[10px] font-mono uppercase tracking-wider text-[#D0C3AF] hover:text-[#F7EBDD] transition-colors"
          >Replace</button>
          <button
            type="button"
            onClick={onRemove}
            className="text-[#9B9282] hover:text-red-400 transition-colors"
            title="Remove tag"
          ><Trash2 size={13} /></button>
          <audio ref={audioRef} src={value} preload="none" crossOrigin="anonymous" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[#3B372F] text-[#D0C3AF] hover:text-[#F7EBDD] hover:border-[#9d95e8]/40 transition-all text-[12px] font-medium disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? 'Uploading…' : 'Upload voice tag (MP3/WAV, <5 MB)'}
        </button>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#9B9282]">Repeat every</span>
        <input
          type="number" min={5} max={120} value={interval}
          onChange={(e) => onIntervalChange(e.target.value)}
          className="w-16 bg-[#090907] border border-[#2B2821] rounded-lg px-2 py-1.5 text-[12px] text-[#F7EBDD] focus:outline-none focus:border-[#3B372F] tabular-nums"
        />
        <span className="text-[10px] font-mono text-[#9B9282]">seconds (saved with the profile)</span>
      </div>

      <input ref={inputRef} type="file" accept="audio/*" onChange={handleFile} className="hidden" />
    </div>
  );
}
