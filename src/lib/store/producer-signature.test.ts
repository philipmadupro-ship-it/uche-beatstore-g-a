import { describe, expect, it } from 'vitest';
import { formatSignature, producerSignature } from './producer-signature';

describe('producerSignature', () => {
  it('uses the 10th–90th percentile so an outlier does not stretch the band', () => {
    const tracks = [70, 140, 142, 144, 145, 146, 148, 150, 150, 150].map((bpm) => ({ bpm }));
    const s = producerSignature(tracks);
    expect(s.bpmLow).toBe(140);
    expect(s.bpmHigh).toBe(150);
  });
  it('names a key only with at least three keyed tracks', () => {
    expect(producerSignature([{ key: 'F', scale: 'minor' }]).signatureKey).toBeNull();
    const s = producerSignature([
      { key: 'F', scale: 'minor' }, { key: 'F', scale: 'minor' }, { key: 'C', scale: 'major' },
    ]);
    expect(s.signatureKey).toBe('F minor');
  });
  it('formats only what exists', () => {
    expect(formatSignature(producerSignature([]))).toBe('');
    const s = producerSignature([
      { bpm: 140, key: 'F', scale: 'minor' }, { bpm: 150, key: 'F', scale: 'minor' }, { bpm: 145, key: 'A', scale: 'minor' },
    ]);
    expect(formatSignature(s)).toBe('140–150 BPM · mostly minor · often in F minor');
  });
});
