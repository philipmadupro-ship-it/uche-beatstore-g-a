import { describe, expect, it } from 'vitest';
import { hasExclusiveDeliverable, licenseAvailability, stemsReady } from './license-availability';

describe('license availability', () => {
  it('treats ready/done/complete stems as deliverable', () => {
    expect(stemsReady('ready')).toBe(true);
    expect(stemsReady('done')).toBe(true);
    expect(stemsReady('complete')).toBe(true);
    expect(stemsReady('pending')).toBe(false);
    expect(stemsReady(null)).toBe(false);
  });

  it('allows exclusive tiers when a WAV or stems are ready', () => {
    expect(hasExclusiveDeliverable({ wav_url: 'r2://masters/a.wav', stems_status: 'none' })).toBe(true);
    expect(hasExclusiveDeliverable({ has_wav: true, wav_url: null, stems_status: 'none' })).toBe(true);
    expect(hasExclusiveDeliverable({ wav_url: null, stems_status: 'done' })).toBe(true);
  });

  it('blocks any license after exclusive rights are sold', () => {
    expect(licenseAvailability(
      { title: 'Late Night', exclusive_sold: true, wav_url: 'r2://masters/a.wav', stems_status: 'done' },
      { is_exclusive: false },
    )).toMatchObject({ available: false, reason: 'exclusive-sold' });
  });

  it('blocks exclusive or stems-included tiers without deliverables', () => {
    expect(licenseAvailability(
      { title: 'Draft Beat', wav_url: null, stems_status: 'pending' },
      { is_exclusive: true },
    )).toMatchObject({ available: false, reason: 'exclusive-files-missing' });

    expect(licenseAvailability(
      { title: 'Trackout Beat', wav_url: null, stems_status: 'none' },
      { stems_included: true },
    )).toMatchObject({ available: false, reason: 'exclusive-files-missing' });
  });

  it('allows ordinary lease tiers when a beat is still available', () => {
    expect(licenseAvailability(
      { title: 'Lease Beat', exclusive_sold: false, wav_url: null, stems_status: 'none' },
      { is_exclusive: false },
    )).toEqual({ available: true });
  });
});
