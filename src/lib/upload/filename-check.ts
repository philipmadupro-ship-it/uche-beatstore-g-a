/**
 * What the uploads tray asks the producer to settle about BPM and key, and
 * the one-click answers it offers.
 *
 * Two kinds of question, both about the moment the producer still knows the
 * file:
 *
 *   - `*-choice`   — the filename mentioned the field but did not settle it
 *                    (`beat 90 140`, `Am Fm`, `BB gun`). Nothing from it was
 *                    applied; each candidate is offered, and the one the
 *                    analyser backs is marked.
 *   - `*-conflict` — the filename settled it and the analyser heard something
 *                    else. The filename was kept (it is the producer's word);
 *                    the analyser's reading is offered as the alternative.
 *
 * Half/double tempo and relative major/minor are NOT raised: those are the
 * detector's known confusions, not a disagreement (`metadata-agreement.ts`).
 *
 * Every option carries the exact PATCH body for `/api/tracks/[id]`. Keys are
 * sent in the canonical spelling `mergeFeatures` stores, so a one-click fix
 * cannot fork `Bb` and `A#` in the column.
 */
import { normalizeKey } from '@/lib/audio/key-normalize';
import {
  compareFilenameWithDetected,
  type DetectedFeatures,
  type KeyValue,
} from '@/lib/audio/metadata-agreement';
import type { TitleMetadata } from './title-metadata';

export type FilenameCheckPatch =
  | { bpm: number }
  | { key: string; scale: 'major' | 'minor' | null };

export interface FilenameCheckOption {
  label: string;
  /** Screen-reader name: says what clicking does, not just the value. */
  ariaLabel: string;
  patch: FilenameCheckPatch;
  /** The analyser heard this too. */
  backedByAnalysis: boolean;
}

export interface FilenameCheck {
  id: 'bpm-choice' | 'key-choice' | 'bpm-conflict' | 'key-conflict';
  field: 'bpm' | 'key';
  message: string;
  options: FilenameCheckOption[];
}

export function keyLabel(k: KeyValue): string {
  return k.scale ? `${k.key} ${k.scale}` : k.key;
}

function keyPatch(k: KeyValue): FilenameCheckPatch {
  const n = normalizeKey(k.key, k.scale);
  return { key: n.key ?? k.key, scale: n.scale ?? k.scale };
}

function confidenceNote(confident: boolean | null): string {
  if (confident === true) return ' (confident)';
  if (confident === false) return ' (low confidence)';
  return '';
}

export function filenameChecks(
  meta: TitleMetadata,
  detected: DetectedFeatures | null | undefined,
): FilenameCheck[] {
  const report = compareFilenameWithDetected(meta, detected);
  const checks: FilenameCheck[] = [];
  const heardBpm = typeof detected?.bpm === 'number' && detected.bpm > 0 ? Math.round(detected.bpm) : null;
  const heardKey: KeyValue | null = detected?.key
    ? { key: detected.key, scale: detected.scale === 'major' || detected.scale === 'minor' ? detected.scale : null }
    : null;

  if (meta.fields.bpm.status === 'needs_confirmation') {
    const listed = meta.fields.bpm.candidates.join(' or ');
    checks.push({
      id: 'bpm-choice',
      field: 'bpm',
      message:
        `Filename gives BPM ${listed} — not applied` +
        (heardBpm != null ? `; analysis heard ${heardBpm}` : '; set it in the track details'),
      options: meta.fields.bpm.candidates.map((bpm) => ({
        label: String(bpm),
        ariaLabel: `Set BPM to ${bpm}`,
        patch: { bpm },
        backedByAnalysis: report.supported.bpm === bpm,
      })),
    });
  }

  if (meta.fields.key.status === 'needs_confirmation') {
    const listed = meta.fields.key.candidates.map(keyLabel).join(' or ');
    const supported = report.supported.key;
    checks.push({
      id: 'key-choice',
      field: 'key',
      message:
        `Filename gives key ${listed} — not applied` +
        (heardKey ? `; analysis heard ${keyLabel(heardKey)}` : '; set it in the track details'),
      options: meta.fields.key.candidates.map((k) => ({
        label: keyLabel(k),
        ariaLabel: `Set key to ${keyLabel(k)}`,
        patch: keyPatch(k),
        backedByAnalysis: supported != null && keyLabel(supported) === keyLabel(k),
      })),
    });
  }

  if (report.bpm?.agreement === 'conflict') {
    const { filename, detected: heard, detectorConfident } = report.bpm;
    checks.push({
      id: 'bpm-conflict',
      field: 'bpm',
      message: `Filename says ${filename} BPM, analysis heard ${heard}${confidenceNote(detectorConfident)} — kept ${filename}`,
      options: [{
        label: `Use ${heard}`,
        ariaLabel: `Set BPM to ${heard}, as analysed`,
        patch: { bpm: heard },
        backedByAnalysis: true,
      }],
    });
  }

  if (report.key?.agreement === 'conflict') {
    const { filename, detected: heard, detectorConfident } = report.key;
    checks.push({
      id: 'key-conflict',
      field: 'key',
      message: `Filename says ${keyLabel(filename)}, analysis heard ${keyLabel(heard)}${confidenceNote(detectorConfident)} — kept ${keyLabel(filename)}`,
      options: [{
        label: `Use ${keyLabel(heard)}`,
        ariaLabel: `Set key to ${keyLabel(heard)}, as analysed`,
        patch: keyPatch(heard),
        backedByAnalysis: true,
      }],
    });
  }

  return checks;
}
