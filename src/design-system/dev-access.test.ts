import { describe, expect, it } from 'vitest';
import { canAccessDesignSystemLab } from './dev-access';

describe('design system lab access', () => {
  it('allows non-production environments', () => {
    expect(canAccessDesignSystemLab('development')).toBe(true);
    expect(canAccessDesignSystemLab('test')).toBe(true);
  });

  it('blocks production', () => {
    expect(canAccessDesignSystemLab('production')).toBe(false);
  });
});
