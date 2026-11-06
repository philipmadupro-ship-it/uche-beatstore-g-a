'use client';

/**
 * The artistic direction workspace (LABEL-68): ONE place for the creative side — where each artist's direction stands,
 * how many songs wait for a creative eye, and, when the org asked for it, which releases still need a creative approval.
 * It reads `GET /api/org/[orgId]/creative` and shows what it is sent; it stores nothing. Every card links to the screen
 * where the thing is actually edited (the artist's Direction tab, the A&R inbox, the release page), so there is exactly
 * one editor per property.
 *
 * Words, not red: a gap is "No direction written yet", an open approval is "Awaiting creative approval". Colour only
 * signals state (mint for done, tan for needs a look).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { creativeOpen, creativeStatusWord, type ArtistCard, type CreativeRelease, type CreativeWorkspace } from '@/lib/labelos/creative-workspace';
import { fetchCreativeWorkspace } from '@/lib/labelos/creative-client';
import { SONG_STAGES, SONG_STAGE_LABEL } from '@/lib/labelos/song-stage';
import { cn } from '@/lib/utils';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-4 sm:p-5';
const LINK = 'inline-flex items-center gap-1 text-[11px] text-white/60 underline decoration-white/20 underline-offset-2 transition-colors hover:text-white hover:decoration-white/60';
const CHIP = 'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]';

function statusTone(c: NonNullable<CreativeRelease['creative']>): string {
  if (c.stale || c.status === 'blocked') return 'border-[#c8a47a]/40 text-[#c8a47a]';
  if (c.status === 'approved' || c.status === 'satisfied') return 'border-[#6DC6A4]/40 text-[#6DC6A4]';
  if (c.status === 'awaiting_approval') return 'border-white/20 text-white/80';
  return 'border-white/10 text-white/50';
}

function Stat({ id, label, value, hint }: { id: string; label: string; value: number | string; hint?: string }) {
  return (
    <div className={CARD} data-testid={`creative-stat-${id}`}>
      <p className={LABEL}>{label}</p>
      <p className="mt-2 font-heading text-[28px] leading-none text-white" data-testid={`creative-stat-${id}-value`}>{value}</p>
      {hint && <p className="mt-2 text-[11px] text-white/50">{hint}</p>}
    </div>
  );
}

function ArtistTile({ a, orgSlug, canReview, canWrite }: { a: ArtistCard; orgSlug: string; canReview: boolean; canWrite: boolean }) {
  const stages = SONG_STAGES.filter((s) => (a.stages.byStage[s] ?? 0) > 0);
  return (
    <li className={CARD} data-testid={`creative-artist-${a.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="truncate text-[16px] text-white">{a.name}</h3>
          <p className={`${LABEL} mt-1`}>
            Direction {a.brief.filled} of {a.brief.total}
          </p>
        </div>
        <Link href={`/o/${orgSlug}/artists/${a.id}?tab=direction`} className={LINK} data-testid={`creative-open-direction-${a.id}`}>
          {a.brief.filled === 0 && canWrite ? 'Write the direction' : 'Open direction'}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {a.brief.filled === 0 ? (
        <p className="mt-3 text-[11px] text-white/50" data-testid={`creative-nodirection-${a.id}`}>No direction written yet.</p>
      ) : (
        <dl className="mt-3 space-y-2 text-[11px]">
          {a.brief.sound && (
            <div>
              <dt className={LABEL}>Sound</dt>
              <dd className="mt-0.5 text-white/80">{a.brief.sound}</dd>
            </div>
          )}
          {a.brief.next && (
            <div>
              <dt className={LABEL}>Next move</dt>
              <dd className="mt-0.5 text-white/80">{a.brief.next}</dd>
            </div>
          )}
        </dl>
      )}
      {a.brief.keywords.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Keywords">
          {a.brief.keywords.map((k) => (
            <li key={k} className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/60">{k}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-[11px] text-white/60">
        <span data-testid={`creative-refs-${a.id}`}>{a.references} {a.references === 1 ? 'reference' : 'references'}</span>
        <span data-testid={`creative-songs-${a.id}`}>{a.stages.total} {a.stages.total === 1 ? 'song' : 'songs'}</span>
        {a.waiting > 0 &&
          (canReview ? (
            <Link href={`/o/${orgSlug}/ar`} className={LINK} data-testid={`creative-waiting-${a.id}`}>
              {a.waiting} waiting for review
            </Link>
          ) : (
            <span data-testid={`creative-waiting-${a.id}`}>{a.waiting} waiting for review</span>
          ))}
        {a.draftReleases > 0 && <span>{a.draftReleases} {a.draftReleases === 1 ? 'release' : 'releases'} in progress</span>}
      </div>
      {stages.length > 0 && (
        <p className="mt-2 text-[11px] text-white/40" data-testid={`creative-stages-${a.id}`}>
          {stages.map((s) => `${SONG_STAGE_LABEL[s]} ${a.stages.byStage[s]}`).join(' · ')}
        </p>
      )}
    </li>
  );
}

function ReleaseRow({ r, orgSlug }: { r: CreativeRelease; orgSlug: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`creative-release-${r.id}`}>
      <div className="min-w-0">
        <Link href={`/o/${orgSlug}/releases/${r.id}`} className="text-[13px] text-white/80 underline-offset-2 hover:underline">
          {r.title}
        </Link>
        {r.artistName && <span className="ml-2 text-[11px] text-white/40">{r.artistName}</span>}
        {(r.releaseDate ?? r.targetDate) && <span className="ml-2 text-[11px] text-white/40">{r.releaseDate ?? r.targetDate}</span>}
      </div>
      {r.creative && (
        <span className={cn(CHIP, statusTone(r.creative))} data-testid={`creative-release-status-${r.id}`} data-status={r.creative.stale ? 'stale' : r.creative.status}>
          {creativeStatusWord(r.creative)}
        </span>
      )}
    </li>
  );
}

export function CreativeWorkspaceView({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const shell = useOrgShell();
  const isOwner = shell?.role === 'owner';
  const canReview = shell?.capabilities.includes('review.write') ?? false;
  const [data, setData] = useState<CreativeWorkspace | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchCreativeWorkspace(orgId).then((w) => {
      if (!alive) return;
      if (!w) setFailed(true);
      else setData(w);
    });
    return () => {
      alive = false;
    };
  }, [orgId]);

  if (failed) return <p className="text-[11px] text-white/70" role="alert">The creative workspace could not be loaded. Try again in a moment.</p>;
  if (!data) return <p className="text-[11px] text-white/60" role="status">Loading the creative workspace…</p>;

  const open = data.releases.filter((r) => creativeOpen(r.creative));
  return (
    <div className="space-y-8" data-testid="creative-workspace">
      {!data.schemaReady && (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-3 text-[11px] text-white/60" data-testid="creative-not-ready">
          Artist direction and references are not set up yet, so they are empty here. Songs and releases are shown as usual.
        </p>
      )}

      <section aria-label="Overview" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat id="artists" label="Artists" value={data.totals.artists} />
        <Stat id="direction" label="With a direction" value={`${data.totals.withDirection} of ${data.totals.artists}`} />
        <Stat id="waiting" label="Songs waiting" value={data.totals.songsWaiting} hint="No review yet" />
        {data.gate ? <Stat id="open" label="Creative approvals open" value={data.totals.creativeOpen} /> : <Stat id="releases" label="Releases in progress" value={data.releases.length} />}
      </section>

      <section aria-labelledby="creative-artists-h">
        <h2 id="creative-artists-h" className={`${LABEL} mb-3 text-white/60`}>Artists</h2>
        {data.artists.length === 0 ? (
          <p className={`${CARD} text-center text-[11px] text-white/40`} data-testid="creative-empty">No artists on the roster yet.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.artists.map((a) => (
              <ArtistTile key={a.id} a={a} orgSlug={orgSlug} canReview={canReview} canWrite={data.canWrite} />
            ))}
          </ul>
        )}
        {data.restricted > 0 && (
          <p className="mt-3 text-[11px] text-white/40" data-testid="creative-restricted">
            {data.restricted} {data.restricted === 1 ? 'song is' : 'songs are'} still in development and not shown to your role.
          </p>
        )}
      </section>

      <section aria-labelledby="creative-releases-h">
        <h2 id="creative-releases-h" className={`${LABEL} mb-3 text-white/60`}>
          Releases in progress <span className="ml-1.5 text-white/40">{data.releases.length}</span>
        </h2>
        {data.gate ? (
          <p className="mb-2 text-[11px] text-white/60" data-testid="creative-gate-on">
            Creative approval is required before a release can be delivered.{' '}
            {data.canApprove ? 'You can ask for and give it on the release page.' : open.length > 0 ? `${open.length} still open.` : 'Nothing is waiting.'}
          </p>
        ) : (
          <p className="mb-2 text-[11px] text-white/50" data-testid="creative-gate-off">
            Creative approval is not required for releases.
            {isOwner && (
              <>
                {' '}
                <Link href={`/o/${orgSlug}/settings/organization`} className={LINK}>Switch it on in settings</Link>.
              </>
            )}
          </p>
        )}
        {data.releases.length === 0 ? (
          <p className={`${CARD} text-center text-[11px] text-white/40`} data-testid="creative-no-releases">No releases in progress.</p>
        ) : (
          <ul className={`${CARD} divide-y divide-white/10 !py-1`}>
            {data.releases.map((r) => (
              <ReleaseRow key={r.id} r={r} orgSlug={orgSlug} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
