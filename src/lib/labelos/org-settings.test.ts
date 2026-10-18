import { describe, expect, it } from 'vitest';
import { MODULES, type Module } from './entitlements';
import {
  SWITCHABLE_MODULES,
  effectiveModules,
  parseDepartmentsOff,
  parseOrgSettings,
  planSettingsChange,
} from './org-settings';

const LICENSED = new Set<Module>(['contracts', 'finance', 'marketing', 'store', 'export']);

describe('parseDepartmentsOff', () => {
  it('is total: anything that is not a list of switchable modules reads as none', () => {
    expect(parseDepartmentsOff(null)).toEqual([]);
    expect(parseDepartmentsOff('finance')).toEqual([]);
    expect(parseDepartmentsOff({ finance: true })).toEqual([]);
    expect(parseDepartmentsOff([1, null, 'nope'])).toEqual([]);
  });
  it('keeps known switchable modules once each, in MODULES order, and never the data export', () => {
    expect(parseDepartmentsOff(['store', 'finance', 'finance', 'export'])).toEqual(['finance', 'store']);
    expect(SWITCHABLE_MODULES).not.toContain('export');
    for (const m of SWITCHABLE_MODULES) expect(MODULES).toContain(m);
  });
});

describe('parseOrgSettings', () => {
  it('reads defaults from nothing and from garbage', () => {
    const d = { legal_gate: 'on', marketing_gate: 'on', require_signed_master_split: false, attention_release_days: 30, attention_stalled_days: 30, departments_off: [] };
    expect(parseOrgSettings(null)).toEqual(d);
    expect(parseOrgSettings([])).toEqual(d);
    expect(parseOrgSettings({ legal_gate: 'OFF', attention_release_days: 0 })).toEqual(d);
  });
  it('only the exact string off switches a gate off', () => {
    expect(parseOrgSettings({ legal_gate: 'off', marketing_gate: 'off' })).toMatchObject({ legal_gate: 'off', marketing_gate: 'off' });
  });
});

describe('effectiveModules', () => {
  it('is the licence minus what the owner switched off, never more than the licence', () => {
    expect([...effectiveModules(LICENSED, ['finance'])].sort()).toEqual(['contracts', 'export', 'marketing', 'store']);
    // A module that was never licensed stays absent even if listed.
    expect(effectiveModules(LICENSED, ['pr']).has('pr')).toBe(false);
    expect(effectiveModules(LICENSED, []).size).toBe(LICENSED.size);
  });
});

describe('planSettingsChange', () => {
  const plan = (current: unknown, patch: Record<string, unknown>) => planSettingsChange({ current, patch, licensed: LICENSED });

  it('returns only the keys that change, with from/to, and nothing for a no-op', () => {
    const r = plan({ legal_gate: 'on' }, { legal_gate: 'off', marketing_gate: 'on' });
    expect(r).toEqual({
      ok: true,
      patch: { legal_gate: 'off' },
      keys: ['legal_gate'],
      payload: { keys: ['legal_gate'], changes: { legal_gate: { from: 'on', to: 'off' } } },
    });
    expect(plan({}, { legal_gate: 'on', require_signed_master_split: false })).toMatchObject({ ok: true, patch: {}, keys: [] });
  });

  it('compares departments as sets', () => {
    expect(plan({ departments_off: ['store', 'finance'] }, { departments_off: ['finance', 'store'] })).toMatchObject({ ok: true, keys: [] });
    const r = plan({}, { departments_off: ['finance'] });
    expect(r).toMatchObject({ ok: true, patch: { departments_off: ['finance'] }, keys: ['departments_off'] });
  });

  it('refuses a department the licence does not include (never above the licence)', () => {
    const r = plan({}, { departments_off: ['pr'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/licen[cs]e/i);
  });

  it('lets an already-off department stay off after its licence is gone', () => {
    // Stored list still names pr; the owner sends the same list back unchanged: no change, no error.
    expect(plan({ departments_off: ['pr'] }, { departments_off: ['pr'] })).toMatchObject({ ok: true, keys: [] });
  });

  it('payload names keys and values of settings only; it carries no free text', () => {
    const r = plan({}, { attention_release_days: 14, attention_stalled_days: 60 });
    expect(r).toMatchObject({ ok: true, keys: ['attention_release_days', 'attention_stalled_days'] });
    if (r.ok) expect(JSON.stringify(r.payload)).not.toMatch(/note/i);
  });
});
