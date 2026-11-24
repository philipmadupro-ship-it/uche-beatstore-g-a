'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Music, Loader2, Globe, Mail, AtSign, X as XIcon,
  Heart, UserPlus, ArrowLeft, Music2,
} from 'lucide-react';
import { PlayGlyph, PauseGlyph } from '@/components/player/TransportIcons';
import { usePlayer } from '@/hooks/usePlayer';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { toast } from '@/hooks/useToast';
import { getBuyerToken } from '@/lib/buyer-session';
import type { Track } from '@/lib/types';
import { storefrontThemeStyle } from '@/lib/store/typography';
import { normalizeLayout } from '@/lib/store-editor/layout';
import { resolveCreatorLink } from '@/lib/store/social-links';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { MusicReactiveBackdrop } from '@/components/ui/MusicReactiveBackdrop';
import { formatSignature, producerSignature } from '@/lib/store/producer-signature';
import { ArtworkThemeProvider } from '@/components/providers/ArtworkThemeProvider';
import type { PublicArtworkTheme } from '@/lib/artwork/public-theme';

/* ─── Types ─────────────────────────────────────────────────── */

interface CreatorProfile {
  user_id: string;
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  credits?: string | null;
  logo_url?: string | null;
  license_notes?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
  accent_color?: string | null;
  font_style?: string | null;
  text_color_primary?: string | null;
  store_layout?: unknown;
}

interface PlaylistItem {
  id: string;
  name: string;
  cover_url: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
  cover_url: string | null;
  description?: string | null;
  price_usd?: number | null;
}

/* ─── Helpers ───────────────────────────────────────────────── */

const TYPE_LABELS: Record<string, string> = {
  beat: 'Beat',
  instrumental: 'Instrumental',
  song: 'Song',
  remix: 'Remix',
};

/* ─── Follow store (localStorage, no auth required) ─────────── */

function getFollowedProducers(): Set<string> {
  try {
    const raw = localStorage.getItem('antigravity-followed-producers');
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function setFollowedProducers(ids: Set<string>) {
  localStorage.setItem('antigravity-followed-producers', JSON.stringify([...ids]));
}

/* ─── Page ──────────────────────────────────────────────────── */

export default function ProducerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  // Supplied by the API because /api/profile is session-gated and a visitor
  // to a producer page has no session.
  const [artworkTheme, setArtworkTheme] = useState<PublicArtworkTheme | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);

  const { currentTrack, isPlaying, setTrack, togglePlay, setQueue } = usePlayer();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/store/producer/${encodeURIComponent(slug)}`);
        if (res.status === 404) { setNotFound(true); return; }
        const data = await res.json();
        if (data.error) { setNotFound(true); return; }
        setCreator(data.creator ?? null);
        setArtworkTheme(data.artworkTheme ?? null);
        setTracks(data.tracks ?? []);
        setPlaylists(data.playlists ?? []);
        setProjects(data.projects ?? []);
        // Check follow status
        if (data.creator?.user_id) {
          setIsFollowing(getFollowedProducers().has(data.creator.user_id));
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const handleFollow = () => {
    if (!creator?.user_id) return;
    const followed = getFollowedProducers();
    const willFollow = !followed.has(creator.user_id);
    // Instant optimistic localStorage feedback (works anonymous too).
    if (willFollow) {
      followed.add(creator.user_id);
      setIsFollowing(true);
      toast.success('Following', `You'll be notified when ${creator.display_name || 'this producer'} drops new beats.`);
    } else {
      followed.delete(creator.user_id);
      setIsFollowing(false);
      toast.info('Unfollowed', `You unfollowed ${creator.display_name || 'this producer'}`);
    }
    setFollowedProducers(followed);

    // Best-effort DB persistence so the producer can see + notify followers.
    // The API takes a signed-in buyer's session cookie first, then this
    // legacy token. With neither it returns needsSignIn and we silently keep
    // the localStorage follow — no friction.
    const token = getBuyerToken();
    fetch('/api/store/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        producer_user_id: creator.user_id,
        action: willFollow ? 'follow' : 'unfollow',
        token: token ?? undefined,
      }),
    }).catch(() => undefined);
  };

  const handlePlayTrack = (t: Track) => {
    if (currentTrack?.id === t.id) { togglePlay(); return; }
    setQueue(tracks);
    setTrack(t);
  };

  // Same rule as /store: profile colours, overridden by any theme colour
  // changed in the Store Editor's Design mode. This page used to apply the
  // font and ignore the text colour.
  const themeStyle = storefrontThemeStyle(creator, normalizeLayout(creator?.store_layout).theme);
  const signatureLine = formatSignature(producerSignature(tracks));
  const socialRows = ([
    ['instagram', resolveCreatorLink('instagram', creator?.instagram_handle), <AtSign key="i" size={12} />],
    ['x', resolveCreatorLink('x', creator?.twitter_handle), <XIcon key="x" size={12} />],
    ['spotify', resolveCreatorLink('spotify', creator?.spotify_url), <Music key="s" size={12} />],
    ['soundcloud', resolveCreatorLink('soundcloud', creator?.soundcloud_url), <Music2 key="c" size={12} />],
    ['website', resolveCreatorLink('website', creator?.website_url), <Globe key="w" size={12} />],
    ['email', resolveCreatorLink('email', creator?.contact_email), <Mail key="m" size={12} />],
  ] as const).flatMap(([key, link, icon]) => (link ? [{ key, link, icon }] : []));
  const collectionCount = playlists.length + projects.length;
  const creditLines = (creator?.credits ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (notFound || !creator) {
    return (
      <div className="min-h-screen bg-[#090907] flex flex-col items-center justify-center gap-4 text-white/40">
        <Music size={36} />
        <p className="text-[14px]">Producer not found.</p>
        <Link href="/store" className="text-[11px] underline hover:text-white">← Back to store</Link>
      </div>
    );
  }

  return (
    <ArtworkThemeProvider theme={artworkTheme}>
    <div
      className="store-ui min-h-screen bg-[#090907]"
      style={themeStyle}
    >
      {/* ── Hero ── */}
      <div className="relative isolate">
        <MusicReactiveBackdrop className="inset-0 z-[1]" />
        {creator.hero_image_url ? (
          <div className="relative h-[160px] w-full overflow-hidden md:h-[240px]">
            <img
              src={creator.hero_image_url}
              alt=""
              className="h-full w-full object-cover opacity-40"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#090907]/60 to-[#090907]" />
          </div>
        ) : (
          <div className="h-[104px] w-full bg-gradient-to-b from-[#0D0D0A] to-[#090907] md:h-[128px]" />
        )}

        {/* Scrim under the back link so it reads over any hero image. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-20 bg-gradient-to-b from-[#090907]/80 to-transparent" />
        <div className="absolute left-2 top-2 z-10 md:left-6">
          <Link
            href="/store"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft size={11} />
            Store
          </Link>
        </div>

        {/* Identity: logo + Follow on one row on a phone, all inline from md up. */}
        <div className="relative z-10 mx-auto -mt-10 max-w-6xl px-4 md:-mt-12 md:px-10">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 md:flex md:items-end md:gap-6">
            {/* The producer's mark — the logo from Settings → Brand artwork. */}
            <div className="row-start-1 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[20px] border border-white/10 bg-[#0D0D0A] md:h-24 md:w-24">
              {creator.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={creator.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-heading text-[28px] text-white/80 md:text-[36px]">
                  {(creator.display_name || 'P').trim().charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <div className="col-span-2 row-start-2 min-w-0 flex-1 md:col-auto md:row-auto">
              <h1 className="font-heading text-[28px] leading-[1.05] text-white md:text-[40px]">
                {creator.display_name || 'Producer'}
              </h1>
              <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60">
                {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
                {collectionCount > 0 && ` · ${collectionCount} ${collectionCount === 1 ? 'collection' : 'collections'}`}
              </p>
              {signatureLine && (
                <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">{signatureLine}</p>
              )}
            </div>

            <div className="col-start-2 row-start-1 flex items-end justify-self-end md:col-auto md:row-auto md:shrink-0">
              <button
                onClick={handleFollow}
                aria-pressed={isFollowing}
                className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                  isFollowing
                    ? 'border-white/30 bg-white/[0.14] text-white hover:bg-white/[0.10]'
                    : 'border-transparent bg-white text-black hover:bg-white/90'
                }`}
              >
                {isFollowing ? <Heart size={12} fill="currentColor" /> : <UserPlus size={12} />}
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-10 md:py-12">
        <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-[280px_1fr] md:gap-12">

          {/* About: bio, credits and links in one card. Rendered only when the
              producer has set any of them. */}
          {(creator.bio || creditLines.length > 0 || socialRows.length > 0) && (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] md:sticky md:top-24">
              {creator.bio && (
                <div className="p-5">
                  <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">About</p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/80">{creator.bio}</p>
                </div>
              )}

              {/* Credits are stored one per line (the profile field says so). */}
              {creditLines.length > 0 && (
                <div className={`p-5 ${creator.bio ? 'border-t border-white/10' : ''}`}>
                  <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Credits</p>
                  <ul className="space-y-1.5">
                    {creditLines.map((line) => (
                      <li key={line} className="text-[11px] leading-snug text-white/80">{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Social links — resolved, never interpolated: see resolveCreatorLink. */}
              {socialRows.length > 0 && (
                <div className={`flex flex-wrap gap-1 px-3 py-2 ${creator.bio || creditLines.length > 0 ? 'border-t border-white/10' : ''}`}>
                  {socialRows.map(({ key, link, icon }) => (
                    <a
                      key={key}
                      href={link.href}
                      target={link.href.startsWith('mailto:') ? undefined : '_blank'}
                      rel="noopener noreferrer"
                      aria-label={link.label}
                      title={link.label}
                      className="grid h-10 w-10 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      {icon}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tracks + collections */}
          <div className={`flex min-w-0 flex-col gap-10 ${creator.bio || creditLines.length > 0 || socialRows.length > 0 ? '' : 'md:col-span-2'}`}>
            {tracks.length > 0 && (
              <section>
                <SectionLabel>All tracks</SectionLabel>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {tracks.map((t) => (
                    <TrackCard
                      key={t.id}
                      track={t}
                      isCurrent={currentTrack?.id === t.id}
                      isPlaying={isPlaying && currentTrack?.id === t.id}
                      onPlay={() => handlePlayTrack(t)}
                    />
                  ))}
                </div>
              </section>
            )}

            {playlists.length > 0 && (
              <section>
                <SectionLabel count={playlists.length}>Playlists</SectionLabel>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                  {playlists.map((pl) => (
                    <CollectionCard key={pl.id} href={`/store/playlists/${pl.id}`} id={pl.id} name={pl.name} cover={pl.cover_url} kind="playlist" />
                  ))}
                </div>
              </section>
            )}

            {projects.length > 0 && (
              <section>
                <SectionLabel count={projects.length}>Projects</SectionLabel>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                  {projects.map((proj) => (
                    <CollectionCard
                      key={proj.id}
                      href={`/store/projects/${proj.id}`}
                      id={proj.id}
                      name={proj.name}
                      cover={proj.cover_url}
                      kind="project"
                      note={proj.price_usd != null && Number(proj.price_usd) > 0 ? `$${Number(proj.price_usd)} bundle` : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {tracks.length === 0 && playlists.length === 0 && projects.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-6 py-14 text-center">
                <Music size={20} className="text-white/40" aria-hidden="true" />
                <p className="text-xs text-white/80">Nothing public yet</p>
                <p className="text-[11px] text-white/40">New releases from {creator.display_name || 'this producer'} will show up here.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </ArtworkThemeProvider>
  );
}

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <p className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
      {children}
      {count != null && <span className="ml-2 text-white/30">{count}</span>}
    </p>
  );
}

/* ─── Collection card (playlist / project) ─────────────────── */

function CollectionCard({
  href, id, name, cover, kind, note,
}: {
  href: string; id: string; name: string; cover: string | null; kind: 'playlist' | 'project'; note?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] transition-colors hover:border-white/20"
    >
      <div className="relative aspect-square w-full bg-[#090907]">
        <ArtworkFallback src={cover} seed={id} kind={kind} alt={name} sizes="160px" className="h-full w-full object-cover">
          <Music size={18} aria-hidden="true" />
        </ArtworkFallback>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-[11px] font-medium text-white">{name}</p>
        {note && <p className="mt-0.5 truncate text-[10px] font-mono text-white/40">{note}</p>}
      </div>
    </Link>
  );
}

/* ─── Track Card ───────────────────────────────────────────── */

function TrackCard({
  track,
  isCurrent,
  isPlaying,
  onPlay,
}: {
  track: Track;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const playingNow = isCurrent && isPlaying;
  // The card is a plain element with a stretched link behind its content, so
  // the play button is a SIBLING of the link, never nested inside an anchor
  // (see ui/ListRow and the rule in CLAUDE.md).
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] transition-colors hover:border-white/20">
      <Link href={`/store/${track.id}`} aria-label={track.title} className="absolute inset-0 z-0" />
      <div className="pointer-events-none relative aspect-square w-full bg-[#090907]">
        <ArtworkFallback
          src={track.cover_url}
          seed={track.id}
          kind="track"
          alt=""
          sizes="220px"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        >
          <Music size={20} aria-hidden="true" />
        </ArtworkFallback>
        <button
          type="button"
          onClick={onPlay}
          aria-label={`${playingNow ? 'Pause' : 'Play'} ${track.title}`}
          className="pointer-events-auto absolute bottom-2 right-2 z-10 opacity-100 transition-opacity focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          <span className="glass-play-surface flex h-10 w-10 items-center justify-center rounded-full" data-playing={playingNow ? 'true' : 'false'}>
            {playingNow ? <PauseGlyph size={16} /> : <PlayGlyph size={16} className="ml-0.5" />}
          </span>
        </button>
        {isCurrent && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white backdrop-blur">
            <span className={`h-1.5 w-1.5 rounded-full bg-[#6DC6A4] ${reducedMotion ? '' : 'animate-pulse'}`} />
            {isPlaying ? 'Playing' : 'Paused'}
          </div>
        )}
      </div>
      <div className="pointer-events-none p-2.5">
        <p className="truncate text-[11px] font-medium text-white">{track.title}</p>
        <p className="mt-1 flex flex-wrap gap-x-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
          <span>{TYPE_LABELS[track.type] ?? track.type}</span>
          {track.bpm ? <span className="whitespace-nowrap">{track.bpm} BPM</span> : null}
        </p>
      </div>
    </div>
  );
}
