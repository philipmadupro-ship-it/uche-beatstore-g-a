import { describe, expect, it } from 'vitest';
import { isLabelOsEnabled } from './flag';

describe('isLabelOsEnabled', () => {
  it('is off when unset', () => {
    expect(isLabelOsEnabled({})).toBe(false);
  });

  it.each(['true', '1', 'TRUE', ' true '])('is on for %j', (v) => {
    expect(isLabelOsEnabled({ LABEL_OS_ENABLED: v })).toBe(true);
  });

  it.each(['', 'false', '0', 'no', 'off', 'yes', 'enabled'])('is off for %j', (v) => {
    expect(isLabelOsEnabled({ LABEL_OS_ENABLED: v })).toBe(false);
  });
});
