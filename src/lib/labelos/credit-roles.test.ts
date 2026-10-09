import { describe, expect, it } from 'vitest';
import {
  CREDIT_ROLES,
  CREDIT_SCOPES,
  CREDIT_STATUSES,
  creditRole,
  creditRoleLabel,
  isCreditRole,
  isCreditScope,
  isCreditStatus,
  resolveCreditScope,
  rolesForScope,
} from './credit-roles';
import { KNOWN_COLLABORATOR_ROLES } from '@/lib/tracks/collaborators';

describe('the credit role vocabulary', () => {
  it('has unique snake_case keys and a label for each', () => {
    const keys = CREDIT_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of CREDIT_ROLES) {
      expect(r.key).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(r.label.length).toBeGreaterThan(2);
      expect(CREDIT_SCOPES).toContain(r.scope);
    }
  });

  it('covers both scopes, and the work is only ever written', () => {
    expect(rolesForScope('composition').map((r) => r.key)).toEqual(['songwriter', 'composer', 'lyricist', 'arranger']);
    expect(rolesForScope('recording').length).toBeGreaterThan(10);
  });

  it('RIN-aligned labels', () => {
    expect(creditRoleLabel('co_producer')).toBe('Co-Producer');
    expect(creditRoleLabel('mastering_engineer')).toBe('Mastering Engineer');
    expect(creditRoleLabel('feature')).toBe('Featured Artist');
    expect(creditRoleLabel('executive_producer')).toBe('Executive Producer');
  });

  it('keeps the three roles the producer app writes (115) valid, as recording credits', () => {
    for (const legacy of KNOWN_COLLABORATOR_ROLES) {
      expect(isCreditRole(legacy), legacy).toBe(true);
      expect(creditRole(legacy)!.scope).toBe('recording');
    }
    expect(CREDIT_ROLES.filter((r) => r.legacy).map((r) => r.key).sort()).toEqual([...KNOWN_COLLABORATOR_ROLES].sort());
  });

  it('a role the vocabulary does not know passes through tidied; nothing throws', () => {
    expect(creditRoleLabel('mixing_engineer')).toBe('Mixing engineer');
    expect(creditRoleLabel('  ')).toBe('  ');
    expect(creditRole('nope')).toBeNull();
    expect(creditRole(undefined)).toBeNull();
    expect(isCreditRole('__proto__')).toBe(false);
    expect(isCreditRole(7)).toBe(false);
  });

  it('only an instrumentalist asks what instrument', () => {
    expect(CREDIT_ROLES.filter((r) => r.detail).map((r) => r.key)).toEqual(['instrumentalist']);
  });

  it('status and scope guards', () => {
    expect(CREDIT_STATUSES).toEqual(['proposed', 'confirmed', 'disputed']);
    expect(isCreditStatus('confirmed')).toBe(true);
    expect(isCreditStatus('rejected')).toBe(false);
    expect(isCreditScope('recording')).toBe(true);
    expect(isCreditScope('mix')).toBe(false);
  });

  describe('resolveCreditScope', () => {
    it('is the role’s own scope', () => {
      expect(resolveCreditScope('songwriter')).toEqual({ ok: true, scope: 'composition' });
      expect(resolveCreditScope('mixer', 'recording')).toEqual({ ok: true, scope: 'recording' });
      expect(resolveCreditScope('mixer', null)).toEqual({ ok: true, scope: 'recording' });
    });
    it('refuses a scope the role does not have, and an unknown role', () => {
      expect(resolveCreditScope('mixer', 'composition')).toEqual({ ok: false, error: 'Mixer is a recording credit' });
      expect(resolveCreditScope('songwriter', 'recording')).toMatchObject({ ok: false });
      expect(resolveCreditScope('wizard')).toEqual({ ok: false, error: 'Unknown credit role' });
    });
  });
});
