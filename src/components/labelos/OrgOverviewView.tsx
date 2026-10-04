/**
 * The org Overview's artist table (LABEL-18, 07 §2.1): demos / in development
 * / selected and the next release per artist, as `ListRow`s whose stretched
 * activator opens the artist's workspace. Counts use the mono label style;
 * colour is not used (no state here is a signal yet). A number the member
 * may not see is shown as "restricted", never a title.
 */
import { Lock } from 'lucide-react';
import { ListContainer, ListRow } from '@/components/ui/ListRow';
import type { OrgOverview } from '@/lib/labelos/overview-store';
import type { NextRelease } from '@/lib/labelos/overview';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const NUM = 'w-16 shrink-0 text-right font-mono text-[12px] tabular-nums text-white/80';

function releaseText(r: NextRelease): string {
  return r.targetDate ? `${r.title} · ${r.targetDate}` : r.title;
}

export function OrgOverviewView({ orgSlug, overview, limited }: { orgSlug: string; overview: OrgOverview; limited: boolean }) {
  const { artists, totals } = overview;
  if (artists.length === 0) {
    return (
      <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40" data-testid="overview-empty">
        {limited ? 'You have not been given any artists in this organization yet.' : 'No artists yet. People in this organization’s directory with an artist role appear here.'}
      </p>
    );
  }
  return (
    <section aria-label="Artists" data-testid="overview">
      <p className={`${LABEL} mb-3`} data-testid="overview-totals">
        {totals.artists} {totals.artists === 1 ? 'artist' : 'artists'} · {totals.songs} {totals.songs === 1 ? 'song' : 'songs'}
      </p>
      <ListContainer
        header={
          <>
            <span className={`${LABEL} flex-1`}>Artist</span>
            <span className={`${LABEL} ${NUM} text-white/40`}>Demos</span>
            <span className={`${LABEL} ${NUM} text-white/40`}>Dev</span>
            <span className={`${LABEL} ${NUM} text-white/40`}>Selected</span>
            <span className={`${LABEL} w-56 shrink-0`}>Next release</span>
          </>
        }
      >
        {artists.map((a) => (
          <ListRow
            key={a.id}
            href={`/o/${orgSlug}/artists/${a.id}`}
            label={`Open ${a.name}`}
            title={<span data-testid={`overview-artist-${a.id}`}>{a.name}</span>}
            meta={
              a.restricted > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-white/40" data-testid={`overview-restricted-${a.id}`}>
                  <Lock size={10} aria-hidden="true" />
                  {a.restricted} {a.restricted === 1 ? 'song' : 'songs'} restricted
                </span>
              ) : undefined
            }
            columns={
              <>
                <span className={NUM} data-testid={`overview-demos-${a.id}`}>{a.columns.demos}</span>
                <span className={NUM} data-testid={`overview-dev-${a.id}`}>{a.columns.development}</span>
                <span className={NUM} data-testid={`overview-selected-${a.id}`}>{a.columns.selected}</span>
                <span className="w-56 shrink-0 truncate text-[11px] text-white/60" data-testid={`overview-release-${a.id}`}>
                  {a.nextRelease ? releaseText(a.nextRelease) : overview.releasesReady ? '—' : 'Not available yet'}
                </span>
              </>
            }
          />
        ))}
      </ListContainer>
    </section>
  );
}
