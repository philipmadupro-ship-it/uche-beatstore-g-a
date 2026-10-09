import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultVisibility, isAuditVerb, type Verb } from './activity';
import { AUDIT_RPCS, auditRpc, isMissingAuditRpc, type AuditRpcAdmin } from './audit-rpc';

const SQL_146 = readFileSync(join(process.cwd(), 'supabase/migrations/146_labelos_audit_rpc.sql'), 'utf8');
// LABEL-21 adds the project-member family (and replaces labelos_audit_invitation_create, same signature).
const SQL_148 = readFileSync(join(process.cwd(), 'supabase/migrations/148_labelos_project_members.sql'), 'utf8');
// LABEL-27 adds the credit decision (confirm / dispute).
const SQL_153 = readFileSync(join(process.cwd(), 'supabase/migrations/153_labelos_parties_credits.sql'), 'utf8');
const SQL = SQL_146 + SQL_148 + SQL_153;

describe('auditRpc', () => {
  it('calls the named function with the arguments untouched', async () => {
    const calls: unknown[] = [];
    const admin = {
      rpc: async (name: string, args: unknown) => {
        calls.push([name, args]);
        return { data: { removed: true }, error: null };
      },
    } as unknown as AuditRpcAdmin;
    const args = { p_org: 'o', p_actor: 'a', p_user: 'u', p_payload: { role: 'member' } };
    const res = await auditRpc(admin, 'memberRemove', args);
    expect(calls).toEqual([['labelos_audit_member_remove', args]]);
    expect(res).toEqual({ data: { removed: true }, error: null });
  });

  it('hands a database error back instead of throwing', async () => {
    const admin = { rpc: async () => ({ data: null, error: { message: 'boom', code: 'P0001' } }) } as unknown as AuditRpcAdmin;
    expect(await auditRpc(admin, 'memberRemove', { p_org: 'o', p_actor: 'a', p_user: 'u', p_payload: {} })).toEqual({
      data: null,
      error: { message: 'boom', code: 'P0001' },
    });
  });

  it('recognises a function that is not deployed', () => {
    expect(isMissingAuditRpc({ message: 'Could not find the function public.labelos_audit_member_update(p_org) in the schema cache', code: 'PGRST202' })).toBe(true);
    expect(isMissingAuditRpc({ message: 'function public.labelos_audit_insert(uuid) does not exist', code: '42883' })).toBe(true);
    // Some other missing function, raised from inside an applied one, is a real failure.
    expect(isMissingAuditRpc({ message: 'function public.some_helper(uuid) does not exist', code: '42883' })).toBe(false);
    expect(isMissingAuditRpc({ message: 'x', code: 'PGRST202' })).toBe(false);
    expect(isMissingAuditRpc({ message: 'Could not find the function public.labelos_audit_member_remove' })).toBe(true);
    expect(isMissingAuditRpc({ message: 'must keep at least one owner', code: '23514' })).toBe(false);
    expect(isMissingAuditRpc(null)).toBe(false);
  });
});

describe('migrations 146 + 148 + 153 hold exactly these functions, service_role only', () => {
  for (const [key, name] of Object.entries(AUDIT_RPCS)) {
    it(`${key} → ${name}`, () => {
      expect(SQL).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
      expect(SQL).toMatch(new RegExp(`${name}\\([^)]*\\) OWNER TO postgres`));
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`));
      expect(SQL).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO[^;]*(authenticated|anon|PUBLIC)`));
    });
  }

  it('declares no audit function the TypeScript does not know', () => {
    const declared = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(labelos_audit_\w+)\(/g)].map((m) => m[1]);
    const helpers = ['labelos_audit_insert', 'labelos_audit_insert_project'];
    // 148 replaces labelos_audit_invitation_create: declared in both files, still one function.
    expect([...new Set(declared)].filter((n) => !helpers.includes(n)).sort()).toEqual(Object.values(AUDIT_RPCS).sort());
  });

  it('writes only verbs whose default visibility is internal (the helper hardcodes it)', () => {
    const written = [...SQL.matchAll(/'((?:member|invitation|project)\.[a-z_]+)'/g)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(5);
    for (const verb of new Set(written)) expect(defaultVisibility(verb as Verb), verb).toBe('internal');
    for (const verb of new Set(written)) expect(isAuditVerb(verb), verb).toBe(true);
  });

  it('keeps the event helpers private (no EXECUTE for anyone but their owner)', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.labelos_audit_insert\([^)]*\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.labelos_audit_insert_project\([^)]*\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(SQL).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.labelos_audit_insert/);
  });

  it('every function is SECURITY DEFINER with a pinned search_path', () => {
    const bodies = SQL.split(/CREATE OR REPLACE FUNCTION /).slice(1);
    // 146: the five + its helper; 148: the three + its helper + the replaced create, user_has_cap, can_see_project, the accept function, the integrity trigger.
    expect(bodies.length).toBeGreaterThanOrEqual(Object.keys(AUDIT_RPCS).length + 2);
    for (const b of bodies) {
      expect(b).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    }
  });
});
