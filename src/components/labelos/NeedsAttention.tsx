/**
 * "Needs attention" on the org Overview (LABEL-35, 07 §2.1 / §3.2): the hero
 * of the page. One `ListRow` per item — a blocked release near its date, a
 * song stalled in a stage, someone's overdue tasks — each naming the person
 * accountable and one next action; the stretched activator opens it.
 *
 * Presentational: `attention-store` decided what the viewer may see (scope,
 * D4), so a song they may not read arrives only as the `restricted` count.
 * Colour is state only and nothing here is an error, so there is none: the
 * blocked gates are words, not red.
 */
import { Lock } from 'lucide-react';
import { ListContainer, ListRow } from '@/components/ui/ListRow';
import type { AttentionItem } from '@/lib/labelos/attention';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';

export type NeedsAttentionProps = {
  items: readonly AttentionItem[];
  /** Stalled songs the viewer may not read (D4). */
  restricted: number;
  /** False when release gates cannot be evaluated yet (a migration is missing). */
  releasesReady?: boolean;
};

export function NeedsAttention({ items, restricted, releasesReady = true }: NeedsAttentionProps) {
  return (
    <section aria-label="Needs attention" className="mb-8" data-testid="needs-attention">
      <h2 className={`${LABEL} mb-3 text-white/60`}>
        Needs attention <span className="ml-1.5 text-white/40" data-testid="needs-attention-count">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40" data-testid="needs-attention-empty">
          Nothing needs attention.
        </p>
      ) : (
        <ListContainer>
          {items.map((item) => (
            <ListRow
              key={item.id}
              href={item.action.href}
              label={`${item.action.verb}: ${item.title}`}
              title={
                <span data-testid={`attention-${item.id}`}>
                  <span className="text-[13px] text-white/80">{item.title}</span>
                  {item.artistName && <span className="ml-2 text-[11px] text-white/40">{item.artistName}</span>}
                </span>
              }
              meta={
                <>
                  <span data-testid={`attention-detail-${item.id}`}>{item.detail}</span>
                  <span className="md:hidden"> · {item.person.name} · {item.action.verb}</span>
                </>
              }
              columns={
                <>
                  <span className="w-28 shrink-0 truncate text-[11px] text-white/60" data-testid={`attention-person-${item.id}`}>{item.person.name}</span>
                  <span className="w-36 shrink-0 truncate text-right font-mono text-[10px] uppercase tracking-[0.2em] text-white/60" data-testid={`attention-action-${item.id}`}>
                    {item.action.verb}
                  </span>
                </>
              }
            />
          ))}
        </ListContainer>
      )}
      {restricted > 0 && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-white/40" data-testid="needs-attention-restricted">
          <Lock size={10} aria-hidden="true" />
          {restricted} {restricted === 1 ? 'song' : 'songs'} restricted
        </p>
      )}
      {!releasesReady && (
        <p className="mt-2 text-[10px] text-white/40" data-testid="needs-attention-releases-unavailable">
          Release gates are not available yet, so blocked releases are not listed.
        </p>
      )}
    </section>
  );
}
