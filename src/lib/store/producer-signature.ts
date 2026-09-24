/**
 * A producer's "sound at a glance", derived from their listed catalogue:
 * the tempo band most of it lives in and the key they reach for most. Shown
 * under the name on /store/producer/[slug] so a visitor knows in one line
 * whether this catalogue is for them, before scrolling a single card.
 *
 * Derived, never stored — it stays true as the catalogue changes. The tempo
 * band is the 10th–90th percentile, not min–max, so one 70 BPM interlude in a
 * catalogue of 140s does not report "70–150 BPM".
 */
export interface SignatureTrack {
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
}

export interface ProducerSignature {
  bpmLow: number | null;
  bpmHigh: number | null;
  /** e.g. "F minor", or null when fewer than 3 tracks carry a key. */
  signatureKey: string | null;
  /** Share of keyed tracks in minor, 0..1, or null with no keyed tracks. */
  minorShare: number | null;
  trackCount: number;
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

export function producerSignature(tracks: ReadonlyArray<SignatureTrack>): ProducerSignature {
  const bpms = tracks
    .map((t) => t.bpm)
    .filter((b): b is number => typeof b === 'number' && Number.isFinite(b) && b > 0)
    .sort((a, b) => a - b);
  const keyed = tracks.filter((t) => t.key);
  const keyCounts = new Map<string, number>();
  for (const t of keyed) {
    const label = `${t.key} ${t.scale === 'minor' ? 'minor' : 'major'}`;
    keyCounts.set(label, (keyCounts.get(label) ?? 0) + 1);
  }
  let signatureKey: string | null = null;
  if (keyed.length >= 3) {
    let best = 0;
    for (const [label, n] of keyCounts) if (n > best) { best = n; signatureKey = label; }
  }
  return {
    bpmLow: bpms.length ? Math.round(percentile(bpms, 0.1)) : null,
    bpmHigh: bpms.length ? Math.round(percentile(bpms, 0.9)) : null,
    signatureKey,
    minorShare: keyed.length ? keyed.filter((t) => t.scale === 'minor').length / keyed.length : null,
    trackCount: tracks.length,
  };
}

/** "138–150 BPM · mostly minor · F minor" — only the parts that exist. */
export function formatSignature(s: ProducerSignature): string {
  const parts: string[] = [];
  if (s.bpmLow != null && s.bpmHigh != null) {
    parts.push(s.bpmLow === s.bpmHigh ? `${s.bpmLow} BPM` : `${s.bpmLow}–${s.bpmHigh} BPM`);
  }
  if (s.minorShare != null) {
    if (s.minorShare >= 0.7) parts.push('mostly minor');
    else if (s.minorShare <= 0.3) parts.push('mostly major');
  }
  if (s.signatureKey) parts.push(`often in ${s.signatureKey}`);
  return parts.join(' · ');
}
