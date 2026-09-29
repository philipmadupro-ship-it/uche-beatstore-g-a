/**
 * Does what the filename says agree with what the analyser heard?
 *
 * `mergeFeatures` ranks a clear filename above every detector, and that stays
 * the rule: the producer made the beat. What was missing is that a
 * disagreement was settled SILENTLY — a name saying 140 over a detector
 * hearing 97 gave no sign that anything was off. This classifies each field
 * so the uploads tray can say so and offer the other reading, and so a
 * detector error that is not a real disagreement does not raise an alarm:
 *
 *   - `agree`           same tempo (±2 BPM or ±1.5 %) / same key, any spelling
 *   - `tempo_multiple`  detector at half or double the tempo — the classic
 *                       beat-tracker octave error, not a disagreement
 *   - `relative_key`    A minor vs C major: the same notes, the classic key-
 *                       profile confusion, not a disagreement
 *   - `conflict`        anything else. Surfaced; the filename is still kept.
 *
 * Pure and client-safe. Vitest: `metadata-agreement.test.ts`.
 */
import { normalizeKey, relativeKey, sameKey } from './key-normalize';
import type { TitleMetadata } from '@/lib/upload/title-metadata';
import { RELIABLE_BPM_CONFIDENCE, RELIABLE_KEY_STRENGTH } from './essentia-extract';

export type Agreement = 'agree' | 'tempo_multiple' | 'relative_key' | 'conflict';

export interface DetectedFeatures {
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  /** Essentia confidence 0–5.32. Absent for the server heuristics. */
  bpmConfidence?: number | null;
  /** Essentia key strength 0–1. Absent for the server heuristics. */
  keyStrength?: number | null;
}

export interface KeyValue {
  key: string;
  scale: 'major' | 'minor' | null;
}

export interface BpmComparison {
  field: 'bpm';
  filename: number;
  detected: number;
  agreement: Agreement;
  /** True/false when the detector reported a confidence; null when it did not. */
  detectorConfident: boolean | null;
}

export interface KeyComparison {
  field: 'key';
  filename: KeyValue;
  detected: KeyValue;
  agreement: Agreement;
  detectorConfident: boolean | null;
}

export interface FilenameDetectorReport {
  bpm: BpmComparison | null;
  key: KeyComparison | null;
  /** Only the real disagreements — what the tray has to show. */
  conflicts: Array<BpmComparison | KeyComparison>;
  /**
   * For a field the filename left `needs_confirmation`, the candidate the
   * detector backs, if exactly one does. "BPM 90 or 140?" with a detector
   * hearing 140 can say so rather than making the producer guess.
   */
  supported: { bpm: number | null; key: KeyValue | null };
}

const BPM_ABSOLUTE_TOLERANCE = 2;
const BPM_RELATIVE_TOLERANCE = 0.015;

function tempoClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(BPM_ABSOLUTE_TOLERANCE, BPM_RELATIVE_TOLERANCE * Math.max(a, b));
}

export function compareBpm(filename: number, detected: number): Agreement {
  if (tempoClose(filename, detected)) return 'agree';
  if (tempoClose(filename, detected * 2) || tempoClose(filename * 2, detected)) return 'tempo_multiple';
  return 'conflict';
}

export function compareKey(filename: KeyValue, detected: KeyValue): Agreement {
  if (sameKey(filename, detected)) return 'agree';
  const f = normalizeKey(filename.key, filename.scale);
  const d = normalizeKey(detected.key, detected.scale);
  if (f.key && d.key && f.scale && d.scale && f.scale !== d.scale) {
    const rel = relativeKey(f.key, f.scale);
    if (rel.key === d.key && rel.scale === d.scale) return 'relative_key';
  }
  return 'conflict';
}

function detectedKey(d: DetectedFeatures): KeyValue | null {
  if (!d.key) return null;
  const scale = d.scale === 'major' || d.scale === 'minor' ? d.scale : null;
  return { key: d.key, scale };
}

function confident(value: number | null | undefined, threshold: number): boolean | null {
  return typeof value === 'number' && Number.isFinite(value) ? value >= threshold : null;
}

/** Compare every field the filename settled, and find detector support for the ones it did not. */
export function compareFilenameWithDetected(
  meta: TitleMetadata,
  detected: DetectedFeatures | null | undefined,
): FilenameDetectorReport {
  const report: FilenameDetectorReport = {
    bpm: null,
    key: null,
    conflicts: [],
    supported: { bpm: null, key: null },
  };
  if (!detected) return report;

  const dBpm = typeof detected.bpm === 'number' && Number.isFinite(detected.bpm) && detected.bpm > 0 ? detected.bpm : null;
  const dKey = detectedKey(detected);

  if (dBpm != null && meta.fields.bpm.status === 'accepted' && meta.fields.bpm.value != null) {
    report.bpm = {
      field: 'bpm',
      filename: meta.fields.bpm.value,
      detected: Math.round(dBpm),
      agreement: compareBpm(meta.fields.bpm.value, dBpm),
      detectorConfident: confident(detected.bpmConfidence, RELIABLE_BPM_CONFIDENCE),
    };
  }
  if (dKey && meta.fields.key.status === 'accepted' && meta.fields.key.value) {
    report.key = {
      field: 'key',
      filename: meta.fields.key.value,
      detected: dKey,
      agreement: compareKey(meta.fields.key.value, dKey),
      detectorConfident: confident(detected.keyStrength, RELIABLE_KEY_STRENGTH),
    };
  }
  report.conflicts = [report.bpm, report.key].filter(
    (c): c is BpmComparison | KeyComparison => c != null && c.agreement === 'conflict',
  );

  if (dBpm != null && meta.fields.bpm.status === 'needs_confirmation') {
    const backed = meta.fields.bpm.candidates.filter((c) => compareBpm(c, dBpm) === 'agree');
    if (backed.length === 1) report.supported.bpm = backed[0];
  }
  if (dKey && meta.fields.key.status === 'needs_confirmation') {
    const backed = meta.fields.key.candidates.filter((c) => compareKey(c, dKey) === 'agree');
    if (backed.length === 1) report.supported.key = backed[0];
  }
  return report;
}
