import { z } from 'zod';

/**
 * What a browser may claim about an upload's audio (Essentia.js, in
 * `lib/audio/analyze.client`). Three routes accept it — `/api/upload`,
 * `/api/upload/complete` and `/api/tracks/[id]/analyze` — and all three used
 * to cast the body straight to a type and write it to `tracks`. A BPM of
 * 99999, a key of `"<script>"` or a NaN duration went in as sent.
 *
 * Validation is PER FIELD. Analysis is best-effort, so one bad value must not
 * fail an upload that has already stored the bytes: the bad field is dropped
 * (reported in `rejected`) and the server's own analysis fills it, exactly as
 * it would had the browser sent nothing.
 */
const unit = z.number().finite().min(0).max(1);

export const ClientAnalysisSchema = z.object({
  bpm: z.number().finite().min(30).max(300),
  /** Essentia's spelling: a note, optionally `#` or `b`. The scale is separate. */
  key: z.string().regex(/^[A-G](?:#|b)?$/),
  scale: z.enum(['major', 'minor']),
  loudness: z.number().finite().min(-100).max(20),
  duration: z.number().finite().min(0).max(24 * 60 * 60),
  energy: unit,
  danceability: unit,
  valence: unit,
  acousticness: unit,
  /** Essentia RhythmExtractor2013 confidence, 0–5.32. */
  bpmConfidence: z.number().finite().min(0).max(10),
  /** Essentia KeyExtractor strength, 0–1. */
  keyStrength: unit,
});

export type ClientAnalysis = {
  [K in keyof z.infer<typeof ClientAnalysisSchema>]?: z.infer<typeof ClientAnalysisSchema>[K] | null;
};

export interface ParsedClientAnalysis {
  /** Null when the payload was absent, not an object, or had no valid field. */
  analysis: ClientAnalysis | null;
  /** Field names that were present but invalid, or `'(payload)'` for a non-object. */
  rejected: string[];
}

export function parseClientAnalysis(raw: unknown): ParsedClientAnalysis {
  if (raw == null) return { analysis: null, rejected: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { analysis: null, rejected: ['(payload)'] };

  const input = raw as Record<string, unknown>;
  const analysis: Record<string, unknown> = {};
  const rejected: string[] = [];
  const shape = ClientAnalysisSchema.shape;
  for (const field of Object.keys(shape) as Array<keyof typeof shape>) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === null) {
      analysis[field] = null;
      continue;
    }
    const parsed = shape[field].safeParse(value);
    if (parsed.success) analysis[field] = parsed.data;
    else rejected.push(field);
  }
  // A key without a readable scale (or the reverse) is half a statement; keep neither.
  if ((analysis.key == null) !== (analysis.scale == null)) {
    if (analysis.key != null) rejected.push('key');
    if (analysis.scale != null) rejected.push('scale');
    analysis.key = null;
    analysis.scale = null;
  }
  const hasValue = Object.values(analysis).some((v) => v != null);
  return { analysis: hasValue ? (analysis as ClientAnalysis) : null, rejected };
}
