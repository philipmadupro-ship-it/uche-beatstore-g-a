/**
 * An in-memory stand-in for migration 146's audit functions, for route tests
 * that run on `memoryAdmin`: each handler does the mutation AND appends the
 * `activity_events` row, or — when `failAudit()` is true, as a failed audit
 * insert would be — changes nothing and answers an error (the transaction's
 * rollback). The real transaction is proven against Postgres in
 * supabase/local/checks/146_labelos_audit_rpc.sql; this keeps the route tests
 * honest about what the routes may assume of it.
 */
import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Res = { data: unknown; error: { message: string; code?: string } | null };
type Handler = (args: Record<string, unknown>, tables: Tables) => Res;

export function auditRpcMemory(opts: { failAudit?: () => boolean } = {}): Record<string, Handler> {
  const ok = (data: unknown): Res => ({ data, error: null });
  const failed = (): Res => ({ data: null, error: { message: 'audit insert refused' } });
  const event = (tables: Tables, args: Row, verb: string, subjectType: string, subjectId: unknown, payload: unknown) => {
    (tables.activity_events ??= []).push({
      org_id: args.p_org,
      actor_id: args.p_actor,
      verb,
      subject_type: subjectType,
      subject_id: subjectId,
      payload,
      audit: true,
      visibility: 'internal',
    });
  };
  const member = (tables: Tables, org: unknown, user: unknown) =>
    (tables.org_members ??= []).find((m) => m.org_id === org && m.user_id === user);

  return {
    labelos_audit_member_update: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const m = member(tables, args.p_org, args.p_user);
      if (!m) return ok({ error: 'not_found' });
      const patch = args.p_patch as Row;
      for (const k of ['role', 'functions', 'scope', 'cap_grants', 'cap_revokes']) if (k in patch) m[k] = patch[k];
      let payload = args.p_payload as Row;
      if (m.role !== 'artist' && m.scope !== 'artists') {
        const scopes = (tables.member_artist_scopes ??= []);
        const gone = scopes.filter((s) => s.org_id === args.p_org && s.user_id === args.p_user);
        tables.member_artist_scopes = scopes.filter((s) => !gone.includes(s));
        if (gone.length) payload = { ...payload, contact_ids: { from: gone.map((s) => s.contact_id).sort(), to: [] } };
      }
      event(tables, args, String(args.p_verb), 'member', args.p_user, payload);
      return ok({ member: { ...m } });
    },
    labelos_audit_member_remove: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      if (!member(tables, args.p_org, args.p_user)) return ok({ error: 'not_found' });
      tables.org_members = tables.org_members.filter((m) => !(m.org_id === args.p_org && m.user_id === args.p_user));
      tables.member_artist_scopes = (tables.member_artist_scopes ?? []).filter((s) => !(s.org_id === args.p_org && s.user_id === args.p_user));
      event(tables, args, 'member.removed', 'member', args.p_user, args.p_payload);
      return ok({ removed: true });
    },
    labelos_audit_member_artists_set: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const m = member(tables, args.p_org, args.p_user);
      if (!m) return ok({ error: 'not_found' });
      if (m.role !== 'artist' && m.scope !== 'artists') return ok({ error: 'not_scoped' });
      const ids = [...new Set(args.p_contact_ids as string[])].sort();
      const scopes = (tables.member_artist_scopes ??= []);
      tables.member_artist_scopes = scopes.filter((s) => !(s.org_id === args.p_org && s.user_id === args.p_user));
      for (const contact_id of ids) tables.member_artist_scopes.push({ org_id: args.p_org, user_id: args.p_user, contact_id });
      event(tables, args, 'member.artists_changed', 'member', args.p_user, args.p_payload);
      return ok({ contact_ids: ids });
    },
    labelos_audit_invitation_create: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const invs = (tables.org_invitations ??= []);
      const pending = invs
        .filter((i) => i.org_id === args.p_org && i.email === args.p_email && !i.accepted_at && !i.revoked_at && String(i.expires_at) > new Date().toISOString())
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))[0];
      if (pending) return ok({ error: 'pending', id: pending.id });
      const row: Row = {
        id: `inv-${invs.length + 1}`,
        org_id: args.p_org,
        email: args.p_email,
        role: args.p_role,
        functions: args.p_functions,
        artist_ids: args.p_artist_ids,
        token_hash: args.p_token_hash,
        expires_at: args.p_expires_at,
        accepted_at: null,
        revoked_at: null,
        invited_by: args.p_actor,
        created_at: new Date().toISOString(),
      };
      invs.push(row);
      event(tables, args, 'invitation.created', 'invitation', row.id, args.p_payload);
      const view = { ...row };
      for (const k of ['token_hash', 'org_id', 'invited_by']) delete view[k];
      return ok({ invitation: view });
    },
    // Migration 148 (LABEL-21): external project members.
    labelos_audit_project_invitation_create: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      if (!(tables.projects ?? []).some((p) => p.id === args.p_project && p.org_id === args.p_org)) return ok({ error: 'not_found' });
      const invs = (tables.org_invitations ??= []);
      const pending = invs.find(
        (i) => i.org_id === args.p_org && i.project_id === args.p_project && i.email === args.p_email && !i.accepted_at && !i.revoked_at && String(i.expires_at) > new Date().toISOString(),
      );
      if (pending) return ok({ error: 'pending', id: pending.id });
      const row: Row = {
        id: randomUUID(),
        org_id: args.p_org,
        email: args.p_email,
        role: 'member',
        functions: [],
        artist_ids: [],
        project_id: args.p_project,
        project_role: args.p_role,
        project_allow_downloads: args.p_allow_downloads,
        token_hash: args.p_token_hash,
        expires_at: args.p_expires_at,
        accepted_at: null,
        revoked_at: null,
        invited_by: args.p_actor,
        created_at: new Date().toISOString(),
      };
      invs.push(row);
      event(tables, args, 'invitation.created', 'invitation', row.id, args.p_payload);
      return ok({
        invitation: {
          id: row.id,
          email: row.email,
          project_id: row.project_id,
          project_role: row.project_role,
          allow_downloads: row.project_allow_downloads,
          expires_at: row.expires_at,
          accepted_at: null,
          revoked_at: null,
          created_at: row.created_at,
        },
      });
    },
    labelos_audit_project_member_update: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const m = (tables.project_members ?? []).find((r) => r.org_id === args.p_org && r.project_id === args.p_project && r.user_id === args.p_user);
      if (!m) return ok({ error: 'not_found' });
      const patch = args.p_patch as Row;
      for (const k of ['role', 'allow_downloads', 'expires_at']) if (k in patch) m[k] = patch[k];
      event(tables, args, 'project.member_changed', 'member', args.p_user, args.p_payload);
      return ok({ member: { user_id: m.user_id, role: m.role, allow_downloads: m.allow_downloads, expires_at: m.expires_at, created_at: m.created_at } });
    },
    labelos_audit_project_member_remove: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const before = (tables.project_members ?? []).length;
      tables.project_members = (tables.project_members ?? []).filter((r) => !(r.org_id === args.p_org && r.project_id === args.p_project && r.user_id === args.p_user));
      if (tables.project_members.length === before) return ok({ error: 'not_found' });
      event(tables, args, 'project.member_removed', 'member', args.p_user, args.p_payload);
      return ok({ removed: true });
    },
    labelos_audit_invitation_revoke: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const inv = (tables.org_invitations ?? []).find((i) => i.org_id === args.p_org && i.id === args.p_id && !i.accepted_at && !i.revoked_at);
      if (!inv) return ok({ error: 'not_pending' });
      inv.revoked_at = new Date().toISOString();
      event(tables, args, 'invitation.revoked', 'invitation', args.p_id, args.p_payload);
      return ok({ revoked_at: inv.revoked_at });
    },
  };
}
