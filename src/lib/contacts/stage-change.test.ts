import { describe, it, expect } from 'vitest';
import { describeStageChange, stageLabel } from './stage-change';

describe('stageLabel', () => {
  it('labels every stage, including the customer stage', () => {
    expect(stageLabel('prospect')).toBe('Prospect');
    expect(stageLabel('customer')).toBe('Customer');
    expect(stageLabel('archived')).toBe('Archived');
  });

  it('calls a null stage Unset rather than rendering "null"', () => {
    expect(stageLabel(null)).toBe('Unset');
    expect(stageLabel(undefined)).toBe('Unset');
  });
});

describe('describeStageChange', () => {
  it('describes a move between two stages', () => {
    expect(describeStageChange('prospect', 'engaged')?.title).toBe('Stage: Prospect → Engaged');
  });

  it('describes first-time assignment', () => {
    expect(describeStageChange(null, 'customer')?.title).toBe('Stage set to Customer');
  });

  it('describes clearing back to the derived tone', () => {
    expect(describeStageChange('cold', null)?.title).toBe('Stage cleared (was Cold)');
  });

  it('returns null for a no-op so the timeline is not polluted', () => {
    // A PATCH that resends the current stage, or a bulk edit spanning
    // contacts already on the target stage, must not log anything.
    expect(describeStageChange('active', 'active')).toBeNull();
    expect(describeStageChange(null, null)).toBeNull();
    expect(describeStageChange(undefined, null)).toBeNull();
  });
});
