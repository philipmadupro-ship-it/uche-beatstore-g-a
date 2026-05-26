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
  ShoppingBag, Star,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
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
}

function StorePreview({
  profile,
  featuredPlaylists,
  tracks,
}: {
  profile: ProfileForm;
  featuredPlaylists: PlaylistRow[];
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
        const [profileRes, playlistRes, storeRes, tracksRes, projectsRes] = await Promise.all([
          fetch('/api/profile'),
          fetch('/api/playlists'),
          fetch('/api/store'),
          fetch('/api/tracks'),
          fetch('/api/projects'),
        ]);
        const [pd, pld, sd, td, prd] = await Promise.all([
          profileRes.json(), playlistRes.json(), storeRes.json(), tracksRes.json(), projectsRes.json(),
        ]);
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
              lease_price_usd: t.lease_price_usd ?? null,
              exclusive_price_usd: t.exclusive_price_usd ?? null,
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
                  {allTracks
                    .filter((t) =>
                      !trackSearch.trim() ||
                      t.title.toLowerCase().includes(trackSearch.toLowerCase()) ||
                      (t.key ?? '').toLowerCase().includes(trackSearch.toLowerCase()) ||
                      String(t.bpm ?? '').includes(trackSearch),
                    )
                    .map((t) => (
                      <div
                        key={t.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                          t.store_listed
                            ? 'bg-[#0e140e] border-[#6DC6A4]/20 hover:border-[#6DC6A4]/35'
                            : 'bg-[#0a0907] border-[#1a160f] hover:border-[#1f1a13]'
                        }`}
                      >
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

                        {/* Status badge */}
                        <span className={`hidden sm:block text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                          t.store_listed
                            ? 'text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/20'
                            : 'text-[#4a4338] bg-[#1a160f] border border-[#1f1a13]'
                        }`}>
                          {t.store_listed ? 'Live' : 'Draft'}
                        </span>

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
                    ))}
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
                tracks={previewTracks}
              />
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
