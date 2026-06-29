import { describe, it, expect } from 'vitest';
import { stemsReady, isExclusiveDeliverable, needsStemsUpload } from './readiness';

describe('stemsReady', () => {
  it('is true for the finished states', () => {
    for (const s of ['ready', 'done', 'complete']) expect(stemsReady(s)).toBe(true);
  });

  it('is false for in-progress / absent states', () => {
    for (const s of ['none', 'pending', 'processing', 'failed', '', null, undefined]) {
      expect(stemsReady(s)).toBe(false);
    }
  });
});

describe('isExclusiveDeliverable', () => {
  it('is deliverable when a WAV exists, regardless of stems', () => {
    expect(isExclusiveDeliverable({ wav_url: 'r2://x.wav', stems_status: 'none' })).toBe(true);
  });

  it('is deliverable when stems are ready, even without a WAV', () => {
    expect(isExclusiveDeliverable({ wav_url: null, stems_status: 'done' })).toBe(true);
  });

  it('is NOT deliverable when there is neither a WAV nor ready stems', () => {
    expect(isExclusiveDeliverable({ wav_url: null, stems_status: 'pending' })).toBe(false);
    expect(isExclusiveDeliverable({})).toBe(false);
  });
});

describe('needsStemsUpload', () => {
  it('is the inverse of deliverability (the post-sale upload flag)', () => {
    expect(needsStemsUpload({ wav_url: null, stems_status: 'pending' })).toBe(true);
    expect(needsStemsUpload({ wav_url: 'r2://x.wav' })).toBe(false);
    expect(needsStemsUpload({ stems_status: 'ready' })).toBe(false);
  });
});
