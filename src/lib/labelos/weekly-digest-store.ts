/**
 * The reads and writes behind the weekly digest (LABEL-38): the two
 * service-role tables of migration 160, the recipient's own content, and the
 * ports `runWeeklyDigest` runs on. Every query names its org. Nothing here
 * logs or returns the Slack URL; `readChannelUrl` is called only by the cron.
 *
 * A table that is not there (160 unapplied) reads as "nobody opted in":
 * `isMissingSchema` is treated as an empty result by the cron and answered
 * `schemaReady: false` by the settings routes.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { memberAccessFor, orgHasModule } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { createLogger } from '@/lib/log';
import { loadActivityFeed } from './activity-store';
import { loadAttention } from './attention-store';
import { decryptWebhook, encryptWebhook, secretAvailable } from './webhook-secret';
import { postToSlack } from './slack-webhook';
import { activityLines, digestSince, type WeeklyDigestContent } from './weekly-digest';
import type { DigestPorts, DueRow, OrgInfo } from './weekly-digest-run';
import { sendDigestEmail } from './weekly-digest-email';

const log = createLogger('lib.labelos.weekly-digest');

export class DigestSchemaMissing extends Error {}

function fail(what: string, error: { message: string; code?: string } | null): never {
  if (error && isMissingSchema(error)) throw new DigestSchemaMissing(what);
  throw new Error(`${what}: ${error?.message ?? 'unknown'}`);
}

// ── Member preference ───────────────────────────────────────────────────

export async function readPreference(admin: AdminClient, orgId: string, userId: string): Promise<boolean> {
  const res = await admin.from('org_digest_members').select('enabled').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (res.error) fail('digest preference read', res.error);
  return (res.data as { enabled?: boolean } | null)?.enabled === true;
}

/** Sets the caller's OWN row only (the route passes the session user). Returns the value before. */
export async function writePreference(admin: AdminClient, orgId: string, userId: string, enabled: boolean): Promise<boolean> {
  const before = await readPreference(admin, orgId, userId);
  const res = await admin
    .from('org_digest_members')
    .upsert({ org_id: orgId, user_id: userId, enabled, updated_at: new Date().toISOString() }, { onConflict: 'org_id,user_id' });
  if (res.error) fail('digest preference write', res.error);
  return before;
}

// ── Slack channel ───────────────────────────────────────────────────────

export type ChannelStatus = { configured: boolean; /** Stored, but this server can no longer open it (key lost or changed): save it again. */ needsReset: boolean };

/** Whether a webhook is stored, and whether it still opens. The ciphertext is read here, server-side, and goes no further. */
export async function channelStatus(admin: AdminClient, orgId: string): Promise<ChannelStatus> {
  const res = await admin.from('org_digest_channels').select('slack_webhook_cipher').eq('org_id', orgId).maybeSingle();
  if (res.error) fail('digest channel read', res.error);
  const cipher = (res.data as { slack_webhook_cipher: string | null } | null)?.slack_webhook_cipher;
  if (!cipher) return { configured: false, needsReset: false };
  return { configured: true, needsReset: decryptWebhook(cipher, orgId) === null };
}

/** What a channel change replaced (`previous`: null = there was no row) and what it wrote (`written`: null = it cleared). */
export type ChannelChange = { previous: { cipher: string | null } | null; written: string | null };

async function readCipher(admin: AdminClient, orgId: string): Promise<{ cipher: string | null } | null> {
  const res = await admin.from('org_digest_channels').select('slack_webhook_cipher').eq('org_id', orgId).maybeSingle();
  if (res.error) fail('digest channel read', res.error);
  return res.data ? { cipher: (res.data as { slack_webhook_cipher: string | null }).slack_webhook_cipher } : null;
}

/** Stores the encrypted URL; returns the change, for the route to undo if its audit event cannot be written. */
export async function writeChannel(admin: AdminClient, orgId: string, userId: string, url: string): Promise<ChannelChange> {
  const previous = await readCipher(admin, orgId);
  const written = encryptWebhook(url, orgId);
  const res = await admin
    .from('org_digest_channels')
    .upsert({ org_id: orgId, slack_webhook_cipher: written, configured_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
  if (res.error) fail('digest channel write', res.error);
  return { previous, written };
}

export async function clearChannel(admin: AdminClient, orgId: string): Promise<ChannelChange> {
  const previous = await readCipher(admin, orgId);
  const res = await admin.from('org_digest_channels').update({ slack_webhook_cipher: null, updated_at: new Date().toISOString() }).eq('org_id', orgId);
  if (res.error) fail('digest channel clear', res.error);
  return { previous, written: null };
}

/**
 * Undo a change, but only while the row still holds what that change wrote:
 * an optimistic compare, so a concurrent save by someone else is never
 * clobbered by a late rollback. There is no transaction to lean on (no atomic
 * function without another migration), so this is the serialisation.
 * Returns false when the undo did not (or could not) happen — the caller says
 * the state is uncertain.
 */
export async function undoChannelChange(admin: AdminClient, orgId: string, change: ChannelChange): Promise<boolean> {
  try {
    const mine = admin.from('org_digest_channels');
    if (change.previous === null) {
      const res = change.written === null ? { error: null } : await mine.delete().eq('org_id', orgId).eq('slack_webhook_cipher', change.written);
      return !res.error;
    }
    const q = admin.from('org_digest_channels').update({ slack_webhook_cipher: change.previous.cipher }).eq('org_id', orgId);
    const res = change.written === null ? await q.is('slack_webhook_cipher', null) : await q.eq('slack_webhook_cipher', change.written);
    return !res.error;
  } catch {
    return false;
  }
}

// ── Recipient content ───────────────────────────────────────────────────

/** Events about the digest or the calendar link are housekeeping, not news. */
const NOISE = /^(digest|calendar_feed)\./;

/**
 * What THIS member's week looks like: Needs attention and the week's
 * activity, each read through their own access (artist scope, D4,
 * `business.read.internal`). The loaders' `restricted` counts are dropped on
 * purpose.
 */
export async function contentFor(access: Parameters<typeof loadAttention>[0], org: OrgInfo, now: Date): Promise<WeeklyDigestContent> {
  const [attention, feed] = await Promise.all([
    loadAttention(access, org.slug, now),
    loadActivityFeed(access, { target: { kind: 'org' }, since: digestSince(now), limit: 200 }),
  ]);
  const events = feed.events.filter((e) => !NOISE.test(e.verb));
  const projectArtists = new Map(Object.entries(feed.projectArtists));
  return { orgName: org.name, orgSlug: org.slug, attention: attention.items, activity: activityLines(events, feed.names, projectArtists) };
}

// ── Ports ───────────────────────────────────────────────────────────────

const PAGE = 500;

export function databasePorts(admin: AdminClient, baseUrl: string): DigestPorts {
  const emailConfigured = !!process.env.RESEND_API_KEY;
  return {
    emailConfigured,
    baseUrl,

    async nextDueOrg(week, afterOrgId) {
      let first = admin.from('org_digest_members').select('org_id').eq('enabled', true).neq('last_sent_week', week);
      if (afterOrgId) first = first.gt('org_id', afterOrgId);
      const head = await first.order('org_id').limit(1);
      if (head.error) fail('due org read', head.error);
      const orgId = ((head.data ?? []) as Array<{ org_id: string }>)[0]?.org_id;
      if (!orgId) return null;
      // Every due member of THIS org, read before any is claimed (claims shift a live offset).
      const members: DueRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const page = await admin
          .from('org_digest_members')
          .select('org_id, user_id, enabled, last_sent_week')
          .eq('org_id', orgId)
          .eq('enabled', true)
          .neq('last_sent_week', week)
          .order('user_id')
          .range(from, from + PAGE - 1);
        if (page.error) fail('due members read', page.error);
        const rows = (page.data ?? []) as Array<{ org_id: string; user_id: string; enabled: boolean; last_sent_week: string }>;
        for (const r of rows) members.push({ orgId: r.org_id, userId: r.user_id, enabled: r.enabled, lastSentWeek: r.last_sent_week });
        if (rows.length < PAGE) break;
      }
      return { orgId, members };
    },

    async dueChannels(week, afterOrgId, limit) {
      // No server secret = no webhook can be opened: leave the channels alone rather than claim and fail.
      if (!secretAvailable()) return [];
      let q = admin.from('org_digest_channels').select('org_id, slack_last_week').not('slack_webhook_cipher', 'is', null).neq('slack_last_week', week);
      if (afterOrgId) q = q.gt('org_id', afterOrgId);
      const c = await q.order('org_id').limit(limit);
      if (c.error) fail('due channels read', c.error);
      return ((c.data ?? []) as Array<{ org_id: string; slack_last_week: string }>).map((r) => ({ orgId: r.org_id, lastSentWeek: r.slack_last_week }));
    },

    async orgInfo(orgIds) {
      const out = new Map<string, OrgInfo>();
      if (orgIds.length === 0) return out;
      const res = await admin.from('organizations').select('id, name, slug').in('id', [...orgIds]).is('deleted_at', null);
      if (res.error) throw new Error(`org read: ${res.error.message}`);
      for (const o of (res.data ?? []) as OrgInfo[]) out.set(o.id, o);
      return out;
    },

    async recipient(orgId, userId) {
      const access = await memberAccessFor(orgId, userId);
      if (!access.ok) {
        if (access.reason === 'error') throw new Error('membership read failed');
        return null;
      }
      if (!access.capabilities.has('catalog.read')) return null;
      // An org not licensed for the digest module (LABEL-47) gets no digest, by email or Slack.
      if (!orgHasModule(access, 'digest')) return null;
      return { userId, orgId, role: access.role };
    },

    async content(r, org, now) {
      const access = await memberAccessFor(r.orgId, r.userId);
      if (!access.ok) throw new Error('membership vanished');
      return contentFor(access, org, now);
    },

    async claimMember(orgId, userId, week) {
      const res = await admin
        .from('org_digest_members')
        .update({ last_sent_week: week, updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .eq('enabled', true)
        .neq('last_sent_week', week)
        .select('user_id');
      if (res.error) fail('digest claim', res.error);
      return ((res.data ?? []) as unknown[]).length === 1;
    },

    async releaseMember(orgId, userId, week, previous) {
      const res = await admin.from('org_digest_members').update({ last_sent_week: previous }).eq('org_id', orgId).eq('user_id', userId).eq('last_sent_week', week);
      if (res.error) log.error('digest claim release failed', { orgId, error: res.error.message });
    },

    async claimChannel(orgId, week) {
      const res = await admin
        .from('org_digest_channels')
        .update({ slack_last_week: week })
        .eq('org_id', orgId)
        .not('slack_webhook_cipher', 'is', null)
        .neq('slack_last_week', week)
        .select('org_id');
      if (res.error) fail('digest channel claim', res.error);
      return ((res.data ?? []) as unknown[]).length === 1;
    },

    async releaseChannel(orgId, week, previous) {
      const res = await admin.from('org_digest_channels').update({ slack_last_week: previous }).eq('org_id', orgId).eq('slack_last_week', week);
      if (res.error) log.error('digest channel release failed', { orgId, error: res.error.message });
    },

    async channelAuthors(orgId) {
      const res = await admin.from('org_digest_members').select('user_id').eq('org_id', orgId).eq('enabled', true).order('user_id').limit(PAGE);
      if (res.error) fail('digest authors read', res.error);
      return ((res.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
    },

    async emailOf(userId) {
      try {
        const res = await admin.auth.admin.getUserById(userId);
        const user = res.data?.user;
        // A confirmed address only: the digest names artists and songs.
        return user?.email && user.email_confirmed_at ? user.email : null;
      } catch {
        return null;
      }
    },

    sendEmail: sendDigestEmail,

    async postSlack(orgId, message) {
      const res = await admin.from('org_digest_channels').select('slack_webhook_cipher').eq('org_id', orgId).maybeSingle();
      if (res.error) fail('digest channel read', res.error);
      const cipher = (res.data as { slack_webhook_cipher: string | null } | null)?.slack_webhook_cipher;
      const url = cipher ? decryptWebhook(cipher, orgId) : null;
      if (!url) {
        // Key lost or changed since the URL was saved. Once per org per run; the settings page tells the admin to save it again.
        log.error('digest channel cannot be opened (needs reset)', { orgId });
        return false;
      }
      const sent = await postToSlack(url, message.slack);
      if (!sent.ok) log.warn('digest slack post failed', { orgId, reason: sent.reason });
      return sent.ok;
    },
  };
}
