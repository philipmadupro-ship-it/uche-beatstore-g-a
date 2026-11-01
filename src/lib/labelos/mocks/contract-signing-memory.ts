/**
 * In-memory twins of migration 178's audit functions (LABEL-60), for route
 * tests that run on `memoryAdmin`. Each mirrors the SQL it stands for: the
 * contract row is checked, the change AND its audit event are made together,
 * and the expected refusals come back as `{ error }`. The real transaction,
 * the append-only trigger and the grants are proven against Postgres in
 * supabase/local/checks/178_labelos_contract_signing.sql; this keeps the route
 * tests honest about what the routes may assume of it.
 */
import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Res = { data: unknown; error: { message: string; code?: string } | null };
type Handler = (args: Record<string, unknown>, tables: Tables) => Res;

const ok = (data: unknown): Res => ({ data, error: null });

function event(tables: Tables, args: Row, verb: string, contract: Row, payload: Row) {
  (tables.activity_events ??= []).push({
    org_id: args.p_org,
    actor_id: args.p_actor ?? null,
    verb,
    subject_type: 'contract',
    subject_id: contract.id,
    payload,
    audit: true,
    visibility: 'internal',
  });
}

export function contractSigningMemory(): Record<string, Handler> {
  const contractOf = (args: Row, tables: Tables) => (tables.contracts ?? []).find((c) => c.id === args.p_contract && c.org_id === args.p_org);
  return {
    labelos_audit_contract_link_issue: (args, tables) => {
      const c = contractOf(args, tables);
      if (!c) return ok({ error: 'not_found' });
      if (c.status !== 'sent') return ok({ error: 'not_sent' });
      const link = (tables.contract_parties ?? []).filter((p) => p.contract_id === c.id && p.party_id === args.p_party).sort((a, b) => Number(a.position) - Number(b.position))[0];
      if (!link) return ok({ error: 'not_party' });
      const signers = (tables.contract_signers ??= []);
      const row = signers.find((s) => s.contract_id === c.id && s.party_id === args.p_party);
      const next = { token_hash: args.p_token_hash, link_issued_at: new Date().toISOString(), link_issued_by: args.p_actor, link_expires_at: args.p_expires_at, link_revoked_at: null };
      if (row) Object.assign(row, next);
      else signers.push({ id: randomUUID(), contract_id: c.id, org_id: args.p_org, party_id: args.p_party, role: link.role, ...next });
      event(tables, args, 'contract.signer_link_issued', c, { ...(args.p_payload as Row), role: link.role });
      return ok({ issued: true, role: link.role });
    },
    labelos_audit_contract_link_revoke: (args, tables) => {
      const c = contractOf(args, tables);
      if (!c) return ok({ error: 'not_found' });
      const row = (tables.contract_signers ?? []).find((s) => s.contract_id === c.id && s.party_id === args.p_party && s.token_hash);
      if (!row) return ok({ error: 'no_link' });
      Object.assign(row, { token_hash: null, link_revoked_at: new Date().toISOString() });
      event(tables, args, 'contract.signer_link_revoked', c, { ...(args.p_payload as Row), role: row.role });
      return ok({ revoked: true });
    },
    labelos_audit_contract_sign: (args, tables) => {
      if (JSON.stringify(args.p_payload ?? {}).match(/token|password|secret/i)) return { data: null, error: { message: 'audit payload carries a secret-looking key', code: '22023' } };
      const c = contractOf(args, tables);
      if (!c) return ok({ error: 'not_found' });
      if (c.status === 'void') return ok({ error: 'void' });
      if (c.status === 'signed') return ok({ error: 'already_signed' });
      if (c.status !== 'sent') return ok({ error: 'not_sent' });
      if (c.version !== args.p_version) return ok({ error: 'changed' });
      const parties = (tables.contract_parties ?? []).filter((p) => p.contract_id === c.id);
      if (!parties.some((p) => p.party_id === args.p_party && p.role === args.p_role)) return ok({ error: 'not_party' });
      const sigs = (tables.contract_signatures ??= []);
      if (sigs.some((s) => s.contract_id === c.id && s.party_id === args.p_party && s.document_sha256 === args.p_sha)) return ok({ error: 'duplicate' });
      const id = randomUUID();
      sigs.push({
        id,
        contract_id: c.id,
        org_id: args.p_org,
        party_id: args.p_party,
        role: args.p_role,
        contract_version: args.p_version,
        document_sha256: args.p_sha,
        signer_name: args.p_name,
        method: args.p_method,
        signature_image: args.p_image ?? null,
        via: args.p_via,
        signed_by_user: args.p_actor ?? null,
        countersign: args.p_countersign,
        ip_hash: args.p_ip_hash ?? null,
        signed_at: new Date(Date.UTC(2026, 10, 1, 10, sigs.length)).toISOString(),
      });
      const required = [...new Set(parties.map((p) => p.party_id))];
      const done = required.every((pid) => sigs.some((s) => s.contract_id === c.id && s.party_id === pid && s.document_sha256 === args.p_sha));
      event(tables, args, 'contract.signature_added', c, { ...(args.p_payload as Row), role: args.p_role, method: args.p_method, via: args.p_via, countersign: args.p_countersign, completes: done });
      if (done) {
        c.status = 'signed';
        event(tables, args, 'contract.signed', c, { version: args.p_version });
      }
      return ok({ signed: true, signature_id: id, completed: done });
    },
    labelos_audit_contract_supersede: (args, tables) => {
      const c = contractOf(args, tables);
      if (!c) return ok({ error: 'not_found' });
      if ((c.status !== 'sent' && c.status !== 'signed') || c.superseded_by) return ok({ error: 'not_sent' });
      const copy = { ...c, id: randomUUID(), status: 'draft', internal_note: null, version: 1, supersedes_id: c.id, superseded_by: null, created_by: args.p_actor };
      tables.contracts.push(copy);
      for (const p of (tables.contract_parties ?? []).filter((x) => x.contract_id === c.id)) tables.contract_parties.push({ ...p, contract_id: copy.id });
      const from = c.status;
      Object.assign(c, { status: 'void', void_reason: args.p_reason || 'Superseded', superseded_by: copy.id });
      for (const s of (tables.contract_signers ?? []).filter((x) => x.contract_id === c.id)) Object.assign(s, { token_hash: null, link_revoked_at: 'now' });
      event(tables, args, 'contract.superseded', c, { ...(args.p_payload as Row), from, replacement: copy.id });
      return ok({ new_id: copy.id, from });
    },
  };
}
