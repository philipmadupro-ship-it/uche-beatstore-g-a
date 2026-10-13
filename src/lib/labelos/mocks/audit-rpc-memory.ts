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
    // ── 154 (LABEL-41): the artist ↔ label connection, as the SQL does it ──
    labelos_audit_connection_request: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const orgs = (tables.organizations ??= []);
      const side = String(args.p_side);
      const otherKind = side === 'label' ? 'artist' : 'label';
      const self = orgs.find((o) => o.id === args.p_org && o.kind === side && !o.deleted_at);
      if (!self) return ok({ error: 'not_found' });
      // Judged on the asking org alone, before the target is looked up (no existence oracle).
      if (args.p_contact && (side !== 'label' || !(tables.contacts ?? []).some((c) => c.id === args.p_contact && c.org_id === args.p_org))) {
        return ok({ error: 'bad_contact' });
      }
      const slug = typeof args.p_target_slug === 'string' ? args.p_target_slug.trim().toLowerCase() : '';
      const email = typeof args.p_target_email === 'string' ? args.p_target_email.trim().toLowerCase() : '';
      let target: Row | undefined;
      if (slug) target = orgs.find((o) => o.slug === slug && o.kind === otherKind && !o.deleted_at);
      else if (email) {
        const users = (tables.auth_users ??= []);
        target = orgs.find(
          (o) =>
            o.kind === otherKind &&
            !o.deleted_at &&
            (tables.org_members ?? []).some(
              (m) => m.org_id === o.id && ['owner', 'admin'].includes(String(m.role)) && users.some((u) => u.id === m.user_id && String(u.email).toLowerCase() === email),
            ),
        );
      }
      if (!target) return ok({ error: 'not_found' });
      const label = side === 'label' ? args.p_org : target.id;
      const artist = side === 'label' ? target.id : args.p_org;
      const conns = (tables.org_connections ??= []);
      const open = conns.find((c) => c.label_org_id === label && c.artist_org_id === artist && ['requested', 'active'].includes(String(c.status)));
      if (open) return ok({ error: 'pending', id: open.id });
      const row: Row = {
        id: randomUUID(),
        label_org_id: label,
        artist_org_id: artist,
        status: 'requested',
        initiated_by: side,
        requested_by: args.p_actor,
        label_contact_id: args.p_contact ?? null,
        share_mode: 'selected',
        allow_copies: false,
        accepted_at: null,
        ended_at: null,
        created_at: new Date().toISOString(),
      };
      conns.push(row);
      const payload = { ...(args.p_payload as Row), side, connection_id: row.id };
      for (const org of [label, artist]) event(tables, { ...args, p_org: org }, 'connection.requested', 'connection', row.id, payload);
      return ok({ connection: { ...row } });
    },
    labelos_audit_connection_accept: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const conn = (tables.org_connections ?? []).find((c) => c.id === args.p_connection);
      if (!conn || conn.status !== 'requested') return ok({ error: 'not_found' });
      const accepting = conn.initiated_by === 'label' ? conn.artist_org_id : conn.label_org_id;
      if (args.p_org !== accepting) return ok({ error: 'not_found' });
      const contacts = (tables.contacts ??= []);
      let contactId = conn.label_contact_id as string | null;
      if (!contactId) {
        const artistOrg = (tables.organizations ?? []).find((o) => o.id === conn.artist_org_id);
        contactId = randomUUID();
        contacts.push({ id: contactId, org_id: conn.label_org_id, user_id: null, name: artistOrg?.name ?? 'Artist', category: 'artist', artist_org_id: null });
      }
      const taken = contacts.some((c) => c.org_id === conn.label_org_id && c.artist_org_id === conn.artist_org_id && c.id !== contactId);
      if (taken) return ok({ error: 'contact_taken' });
      conn.status = 'active';
      conn.accepted_at = new Date().toISOString();
      conn.label_contact_id = contactId;
      const contact = contacts.find((c) => c.id === contactId);
      if (contact) contact.artist_org_id = conn.artist_org_id;
      const payload = { ...(args.p_payload as Row), connection_id: conn.id };
      for (const org of [conn.label_org_id, conn.artist_org_id]) event(tables, { ...args, p_org: org }, 'connection.accepted', 'connection', conn.id, payload);
      return ok({ connection: { ...conn } });
    },
    labelos_audit_connection_end: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const conn = (tables.org_connections ?? []).find((c) => c.id === args.p_connection);
      if (!conn || !['requested', 'active'].includes(String(conn.status))) return ok({ error: 'not_found' });
      const side = args.p_org === conn.label_org_id ? 'label' : args.p_org === conn.artist_org_id ? 'artist' : null;
      if (!side) return ok({ error: 'not_found' });
      const was = conn.status;
      conn.status = was === 'requested' && side !== conn.initiated_by ? 'declined' : 'ended';
      conn.ended_at = new Date().toISOString();
      conn.label_contact_id = null;
      tables.connection_projects = (tables.connection_projects ?? []).filter((r) => r.connection_id !== conn.id);
      for (const c of tables.contacts ?? []) {
        if (c.org_id === conn.label_org_id && c.artist_org_id === conn.artist_org_id) c.artist_org_id = null;
      }
      const payload = { ...(args.p_payload as Row), connection_id: conn.id, was, outcome: conn.status, by_side: side };
      for (const org of [conn.label_org_id, conn.artist_org_id]) event(tables, { ...args, p_org: org }, 'connection.ended', 'connection', conn.id, payload);
      return ok({ connection: { ...conn } });
    },
    labelos_audit_connection_share: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const conn = (tables.org_connections ?? []).find((c) => c.id === args.p_connection);
      if (!conn || !['requested', 'active'].includes(String(conn.status)) || conn.artist_org_id !== args.p_org) return ok({ error: 'not_found' });
      const ids = args.p_project_ids as string[] | null;
      if (ids && ids.some((id) => !(tables.projects ?? []).some((p) => p.id === id && p.org_id === args.p_org))) return ok({ error: 'bad_project' });
      const patch = args.p_patch as Row;
      const before = (tables.connection_projects ?? []).filter((r) => r.connection_id === conn.id).map((r) => String(r.project_id));
      const beforeAll = conn.share_mode === 'all';
      const beforeCopies = conn.allow_copies === true;
      if (ids) {
        tables.connection_projects = (tables.connection_projects ?? []).filter((r) => r.connection_id !== conn.id);
        for (const id of new Set(ids)) tables.connection_projects.push({ connection_id: conn.id, project_id: id, org_id: args.p_org });
      } else if (beforeAll && patch.share_mode === 'selected') {
        tables.connection_projects = (tables.connection_projects ?? []).filter((r) => r.connection_id !== conn.id);
      }
      if (typeof patch.share_mode === 'string') conn.share_mode = patch.share_mode;
      if (typeof patch.allow_copies === 'boolean') conn.allow_copies = patch.allow_copies;
      const after = (tables.connection_projects ?? []).filter((r) => r.connection_id === conn.id).map((r) => String(r.project_id));
      const afterAll = conn.share_mode === 'all';
      const widened = (!beforeAll && afterAll) || (!beforeAll && !afterAll && after.some((a) => !before.includes(a))) || (!beforeCopies && conn.allow_copies === true);
      const narrowed = (beforeAll && !afterAll) || (!beforeAll && !afterAll && before.some((b) => !after.includes(b))) || (beforeCopies && conn.allow_copies !== true);
      const payload = { ...(args.p_payload as Row), via: 'connection', share_mode: conn.share_mode, projects: after.length, allow_copies: conn.allow_copies };
      if (narrowed) event(tables, args, 'share.revoked', 'connection', conn.id, payload);
      if (widened) event(tables, args, 'share.created', 'connection', conn.id, payload);
      return ok({ connection: { ...conn }, project_ids: after.sort() });
    },
    // Migration 153 (LABEL-27): confirm / dispute a credit, with its event in the same step.
    labelos_audit_credit_decide: (args, tables) => {
      if (opts.failAudit?.()) return failed();
      const credit = (tables.track_collaborators ?? []).find((c) => c.id === args.p_credit && c.org_id === args.p_org);
      if (!credit) return ok({ error: 'not_found' });
      const decision = String(args.p_decision);
      if (credit.status === decision) return ok({ error: 'unchanged' });
      if (decision === 'confirmed') {
        Object.assign(credit, { status: 'confirmed', confirmed_by: args.p_actor, confirmed_at: new Date().toISOString(), dispute_note: null });
      } else {
        Object.assign(credit, { status: 'disputed', confirmed_by: null, confirmed_at: null, dispute_note: args.p_note ?? null });
      }
      const subject = (args.p_subject ?? {}) as Row;
      (tables.activity_events ??= []).push({
        org_id: args.p_org,
        actor_id: args.p_actor,
        verb: decision === 'confirmed' ? 'credit.confirmed' : 'credit.disputed',
        subject_type: 'credit',
        subject_id: credit.id,
        artist_id: subject.artist_id ?? null,
        project_id: subject.project_id ?? null,
        song_id: subject.song_id ?? null,
        payload: args.p_payload,
        audit: true,
        visibility: 'artist',
      });
      return ok({ credit: { ...credit } });
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
