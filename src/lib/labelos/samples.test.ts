import { describe, expect, it } from 'vitest';
import { isCleared, planSamples, samplesChanged, type SamplesState } from './samples';

const yes: SamplesState = { samples: 'yes', note: 'Cleared with the publisher', assetId: 'a1' };
const blank: SamplesState = { samples: 'unknown', note: null, assetId: null };

describe('planSamples', () => {
  it('none and unknown drop the note and the file', () => {
    expect(planSamples(yes, { samples: 'none' })).toEqual({ samples: 'none', note: null, assetId: null });
    expect(planSamples(yes, { samples: 'unknown', note: 'kept?' })).toEqual(blank);
  });
  it('yes keeps what is there unless the body names it', () => {
    expect(planSamples(yes, { samples: 'yes' })).toEqual(yes);
    expect(planSamples(yes, { samples: 'yes', note: 'New note' })).toEqual({ ...yes, note: 'New note' });
    expect(planSamples(yes, { samples: 'yes', asset_id: null })).toEqual({ ...yes, assetId: null });
    expect(planSamples(yes, { samples: 'yes', note: '   ' })).toEqual({ ...yes, note: null });
  });
  it('yes from nothing starts blank', () => {
    expect(planSamples(blank, { samples: 'yes' })).toEqual({ samples: 'yes', note: null, assetId: null });
  });
});

describe('isCleared', () => {
  it('needs a non-blank note or a file', () => {
    expect(isCleared({ note: null, assetId: null })).toBe(false);
    expect(isCleared({ note: '  ', assetId: null })).toBe(false);
    expect(isCleared({ note: 'ok', assetId: null })).toBe(true);
    expect(isCleared({ note: null, assetId: 'a1' })).toBe(true);
  });
});

describe('samplesChanged', () => {
  it('compares all three fields', () => {
    expect(samplesChanged(yes, { ...yes })).toBe(false);
    expect(samplesChanged(yes, { ...yes, note: 'x' })).toBe(true);
    expect(samplesChanged(blank, { ...blank, samples: 'none' })).toBe(true);
  });
});
