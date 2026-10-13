/**
 * The sample declaration of an org song (LABEL-29, 09 §3.1 L8; migration 156).
 * Pure: the route loads the row and writes what this module plans.
 *
 *   - `none` / `unknown` carry no clearance: switching to either drops the
 *     note and the file, so a stale clearance cannot outlive the samples it
 *     cleared (and `yes` again starts from a blank page).
 *   - `yes` keeps what is there unless the body names it (`null` clears).
 *   - A song is CLEARED when it has a non-blank note or a clearance file —
 *     the "clearance note or document attached" of L8.
 */
import type { SamplesDeclared } from './legal-readiness';

export const SAMPLES_VALUES = ['none', 'yes', 'unknown'] as const;

export const SAMPLES_LABEL: Record<SamplesDeclared, string> = {
  none: 'No samples',
  yes: 'Uses samples',
  unknown: 'Not declared',
};

export type SamplesState = {
  samples: SamplesDeclared;
  note: string | null;
  assetId: string | null;
};

export type SamplesInput = {
  samples: SamplesDeclared;
  note?: string | null;
  asset_id?: string | null;
};

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

export const isSamplesDeclared = (v: unknown): v is SamplesDeclared => v === 'none' || v === 'yes' || v === 'unknown';

/** The state to store for `input` over `current`. */
export function planSamples(current: SamplesState, input: SamplesInput): SamplesState {
  if (input.samples !== 'yes') return { samples: input.samples, note: null, assetId: null };
  return {
    samples: 'yes',
    note: input.note === undefined ? current.note : clean(input.note),
    assetId: input.asset_id === undefined ? current.assetId : input.asset_id,
  };
}

/** L8's "clearance note or document attached". */
export const isCleared = (s: Pick<SamplesState, 'note' | 'assetId'>): boolean => clean(s.note) !== null || !!s.assetId;

export function samplesChanged(a: SamplesState, b: SamplesState): boolean {
  return a.samples !== b.samples || a.note !== b.note || a.assetId !== b.assetId;
}
