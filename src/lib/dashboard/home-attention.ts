/**
 * "Needs you" on Home — the one block that answers "is anything waiting?".
 *
 * Pure (same rule as action-digest.ts): the component only fetches and draws.
 *
 * The honesty rule: "all clear" is a claim, so it is made only when EVERY
 * source loaded without error. While something is still loading the block is a
 * quiet skeleton; if a source failed and nothing else turned up, it says it
 * could not load — never "nothing waiting".
 */

import type { ActionDigest, DigestDomain, DigestItem } from '@/lib/dashboard/action-digest';

export type SourceState = 'loading' | 'ok' | 'error';

export interface AttentionSources {
  sales: SourceState;
  offers: SourceState;
  leads: SourceState;
}

export type AttentionStatus =
  /** At least one source is still loading and there is nothing to show yet. */
  | 'loading'
  /** Items to act on (some sources may have failed: see `failedSources`). */
  | 'items'
  /** Every source loaded cleanly and nothing is waiting. */
  | 'clear'
  /** Nothing to show and at least one source failed: we cannot say it is clear. */
  | 'error';

export interface HomeAttention {
  status: AttentionStatus;
  rows: DigestItem[];
  /** Items beyond `rows` (shown behind "N more"). */
  moreCount: number;
  total: number;
  /** "1 offer · 2 sales · 1 lead", empty when there is nothing. */
  summary: string;
  failedSources: Array<keyof AttentionSources>;
}

export const ATTENTION_VISIBLE_ROWS = 4;

const NOUNS: Record<DigestDomain, [string, string]> = {
  sales: ['sale', 'sales'],
  offers: ['offer', 'offers'],
  crm: ['lead', 'leads'],
};
const ORDER: DigestDomain[] = ['sales', 'offers', 'crm'];

export function summariseDigest(counts: Record<DigestDomain, number>): string {
  return ORDER.filter((d) => counts[d] > 0)
    .map((d) => `${counts[d]} ${NOUNS[d][counts[d] === 1 ? 0 : 1]}`)
    .join(' · ');
}

export function buildHomeAttention(input: {
  digest: ActionDigest;
  sources: AttentionSources;
  visibleRows?: number;
}): HomeAttention {
  const { digest, sources } = input;
  const visible = input.visibleRows ?? ATTENTION_VISIBLE_ROWS;
  const states = Object.values(sources);
  const failedSources = (Object.keys(sources) as Array<keyof AttentionSources>).filter(
    (k) => sources[k] === 'error',
  );
  const base = {
    total: digest.total,
    summary: summariseDigest(digest.countsByDomain),
    failedSources,
  };

  if (digest.total > 0) {
    return {
      ...base,
      status: 'items',
      rows: digest.items.slice(0, visible),
      moreCount: Math.max(0, digest.total - visible),
    };
  }
  if (states.includes('loading')) return { ...base, status: 'loading', rows: [], moreCount: 0 };
  if (failedSources.length > 0) return { ...base, status: 'error', rows: [], moreCount: 0 };
  return { ...base, status: 'clear', rows: [], moreCount: 0 };
}
