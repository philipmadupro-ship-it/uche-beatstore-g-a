import { describe, expect, it } from 'vitest';
import { memoryAdmin, type MemoryDb } from './mocks/memory-db';
import { creativeGateEffective, readCreativeGate } from './creative-store';
import type { AdminClient } from '@/lib/auth/ownership';

const L = '10000000-0000-4000-8000-000000000001';
const admin = (settings: unknown, entitlements: Record<string, unknown>[] = []) => {
  const db: MemoryDb = { tables: { organizations: [{ id: L, kind: 'label', deleted_at: null, settings }], org_entitlements: entitlements } };
  return memoryAdmin(db).client as unknown as AdminClient;
};

describe('creativeGateEffective (review H1)', () => {
  it('is on only when the setting is on AND the department is there', () => {
    expect(creativeGateEffective('on', true)).toBe(true);
    expect(creativeGateEffective('on', false)).toBe(false);
    expect(creativeGateEffective('off', true)).toBe(false);
    expect(creativeGateEffective('off', false)).toBe(false);
  });
});

describe('readCreativeGate', () => {
  it('off by default and for any value but the exact string on', async () => {
    for (const v of [{}, null, 'on', { creative_gate: true }, { creative_gate: 'ON' }, { creative_gate: 'off' }]) expect(await readCreativeGate(admin(v), L), JSON.stringify(v)).toBe(false);
  });
  it('on with the department present: in force', async () => {
    expect(await readCreativeGate(admin({ creative_gate: 'on' }), L)).toBe(true);
    expect(await readCreativeGate(admin({ creative_gate: 'on' }, [{ org_id: L, modules: ['artistic'], max_seats: null, max_artists: null, setup_done: true }]), L)).toBe(true);
  });
  it('on but the owner switched the department off: not in force', async () => {
    expect(await readCreativeGate(admin({ creative_gate: 'on', departments_off: ['artistic'] }), L)).toBe(false);
  });
  it('on but the module is not licensed: not in force', async () => {
    expect(await readCreativeGate(admin({ creative_gate: 'on' }, [{ org_id: L, modules: ['contracts'], max_seats: null, max_artists: null, setup_done: true }]), L)).toBe(false);
  });
});
