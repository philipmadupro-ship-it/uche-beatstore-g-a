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
import { memberAccessFor } from '@/lib/auth/org-access';
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

/** True when a webhook is stored. Never selects the ciphertext. */
export async function channelConfigured(admin: AdminClient, orgId: string): Promise<boolean> {
  const res = await admin.from('org_digest_channels').select('org_id').eq('org_id', orgId).not('slack_webhook_cipher', 'is', null).maybeSingle();
  if (res.error) fail('digest channel read', res.error);
  return !!res.data;
}

export type ChannelBackup = { cipher: string | null } | null;

/** Stores the encrypted URL; returns what was there (for the route to put back if its audit event fails). */
export async function writeChannel(admin: AdminClient, orgId: string, userId: string, url: string): Promise<ChannelBackup> {
  const before = await admin.from('org_digest_channels').select('slack_webhook_cipher').eq('org_id', orgId).maybeSingle();
  if (before.error) fail('digest channel read', before.error);
  const previous = before.data ? { cipher: (before.data as { slack_webhook_cipher: string | null }).slack_webhook_cipher } : null;
  const res = await admin
    .from('org_digest_channels')
    .upsert({ org_id: orgId, slack_webhook_cipher: encryptWebhook(url, orgId), configured_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
  if (res.error) fail('digest channel write', res.error);
  return previous;
}

export async function clearChannel(admin: AdminClient, orgId: string): Promise<ChannelBackup> {
  const before = await admin.from('org_digest_channels').select('slack_webhook_cipher').eq('org_id', orgId).maybeSingle();
  if (before.error) fail('digest channel read', before.error);
  const previous = before.data ? { cipher: (before.data as { slack_webhook_cipher: string | null }).slack_webhook_cipher } : null;
  const res = await admin.from('org_digest_channels').update({ slack_webhook_cipher: null, updated_at: new Date().toISOString() }).eq('org_id', orgId);
  if (res.error) fail('digest channel clear', res.error);
  return previous;
}

export async function restoreChannel(admin: AdminClient, orgId: string, backup: ChannelBackup): Promise<void> {
  if (backup === null) {
    await admin.from('org_digest_channels').delete().eq('org_id', orgId);
    return;
  }
  await admin.from('org_digest_channels').update({ slack_webhook_cipher: backup.cipher }).eq('org_id', orgId);
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

    async listDue(week) {
      const members: DueRow[] = [];
      const m = await admin.from('org_digest_members').select('org_id, user_id, enabled, last_sent_week').eq('enabled', true).neq('last_sent_week', week).order('org_id').order('user_id').limit(PAGE);
      if (m.error) fail('due members read', m.error);
      for (const r of (m.data ?? []) as Array<{ org_id: string; user_id: string; enabled: boolean; last_sent_week: string }>) {
        members.push({ orgId: r.org_id, userId: r.user_id, enabled: r.enabled, lastSentWeek: r.last_sent_week });
      }
      // No server secret = no webhook can be opened: leave the channels alone rather than claim and fail.
      if (!secretAvailable()) return { members, channelOrgs: [] };
      const c = await admin.from('org_digest_channels').select('org_id, slack_last_week').not('slack_webhook_cipher', 'is', null).neq('slack_last_week', week).order('org_id').limit(PAGE);
      if (c.error) fail('due channels read', c.error);
      const channelOrgs = ((c.data ?? []) as Array<{ org_id: string; slack_last_week: string }>).map((r) => ({ orgId: r.org_id, lastSentWeek: r.slack_last_week }));
      return { members, channelOrgs };
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
      const res = await admin.from('org_digest_members').select('user_id').eq('org_id', orgId).eq('enabled', true).limit(PAGE);
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
      if (!url) return false;
      const sent = await postToSlack(url, message.slack);
      if (!sent.ok) log.warn('digest slack post failed', { orgId, reason: sent.reason });
      return sent.ok;
    },
  };
}
