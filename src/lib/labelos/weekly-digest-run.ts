/**
 * One run of the weekly digest (LABEL-38). The orchestration, with every
 * side effect behind `DigestPorts` so the idempotency rules are tested
 * without a database:
 *
 *  - who is due: members who opted in and whose `last_sent_week` is not this
 *    ISO week;
 *  - CLAIM before sending: `claimMember` is a compare-and-set in the database
 *    (`UPDATE … WHERE last_sent_week <> $week RETURNING`), so a second run, or
 *    a concurrent one, gets `false` and sends nothing;
 *  - a failed send RELEASES the claim (the previous value is put back) so the
 *    next run retries; a claim is never released after a successful send;
 *  - an empty digest sends nothing and keeps the claim (the week is done);
 *  - membership is re-read at send time: a member removed, downgraded below
 *    `catalog.read` or whose org is soft-deleted is not claimed or sent to;
 *  - the content is built FOR THE RECIPIENT through their own access
 *    (weekly-digest-store.ts), never for the org.
 *
 * The Slack channel is one post per org per week, built from the access of an
 * opted-in owner or admin (the whole-org view): the channel is the org's own
 * and its audience is not a member we can scope to.
 */
import { buildWeeklyDigest, dueMembers, isEmptyDigest, isoWeekKey, type DigestMessage, type DigestSubscription, type WeeklyDigestContent } from './weekly-digest';

export type DueRow = DigestSubscription & { orgId: string };

export type OrgInfo = { id: string; name: string; slug: string };

export type RecipientAccess = { userId: string; orgId: string; role: string };

export type DigestPorts = {
  /** Opted-in rows not yet sent for `week`, plus every org with a channel set (`channelOrgs`). */
  listDue(week: string): Promise<{ members: DueRow[]; channelOrgs: Array<{ orgId: string; lastSentWeek: string }> }>;
  orgInfo(orgIds: readonly string[]): Promise<Map<string, OrgInfo>>;
  /** A live member with catalog.read, or null (not a member, org deleted, lost the capability). */
  recipient(orgId: string, userId: string): Promise<RecipientAccess | null>;
  /** Content through that member's own access. */
  content(r: RecipientAccess, org: OrgInfo, now: Date): Promise<WeeklyDigestContent>;
  claimMember(orgId: string, userId: string, week: string): Promise<boolean>;
  releaseMember(orgId: string, userId: string, week: string, previous: string): Promise<void>;
  claimChannel(orgId: string, week: string): Promise<boolean>;
  releaseChannel(orgId: string, week: string, previous: string): Promise<void>;
  /** Opted-in owners and admins of an org, any order. */
  channelAuthors(orgId: string): Promise<string[]>;
  emailOf(userId: string): Promise<string | null>;
  sendEmail(to: string, message: DigestMessage): Promise<boolean>;
  postSlack(orgId: string, message: DigestMessage): Promise<boolean>;
  emailConfigured: boolean;
  baseUrl: string;
};

export type RunResult = {
  week: string;
  emailed: number;
  slacked: number;
  /** Claimed but nothing to say. */
  empty: number;
  /** Lost the claim to another run, or no longer a member. */
  skipped: number;
  failed: number;
};

/** Upper bound per run, so one run stays inside the function timeout. */
export const MAX_PER_RUN = 100;

export async function runWeeklyDigest(ports: DigestPorts, now: Date = new Date()): Promise<RunResult> {
  const week = isoWeekKey(now);
  const result: RunResult = { week, emailed: 0, slacked: 0, empty: 0, skipped: 0, failed: 0 };
  const { members, channelOrgs } = await ports.listDue(week);

  const dueIds = new Set(
    dueMembers(
      members.map((m) => ({ userId: `${m.orgId}|${m.userId}`, enabled: m.enabled, lastSentWeek: m.lastSentWeek })),
      week,
    ),
  );
  const due = members.filter((m) => dueIds.has(`${m.orgId}|${m.userId}`)).sort((a, b) => `${a.orgId}|${a.userId}`.localeCompare(`${b.orgId}|${b.userId}`)).slice(0, MAX_PER_RUN);
  const channels = channelOrgs.filter((c) => c.lastSentWeek !== week).sort((a, b) => a.orgId.localeCompare(b.orgId));

  const orgs = await ports.orgInfo([...new Set([...due.map((d) => d.orgId), ...channels.map((c) => c.orgId)])]);

  if (ports.emailConfigured) {
    for (const row of due) {
      const org = orgs.get(row.orgId);
      if (!org) { result.skipped += 1; continue; }
      try {
        const who = await ports.recipient(row.orgId, row.userId);
        if (!who) { result.skipped += 1; continue; }
        if (!(await ports.claimMember(row.orgId, row.userId, week))) { result.skipped += 1; continue; }
        let sent = false;
        try {
          const content = await ports.content(who, org, now);
          if (isEmptyDigest(content)) { result.empty += 1; continue; }
          const to = await ports.emailOf(row.userId);
          if (!to) {
            await ports.releaseMember(row.orgId, row.userId, week, row.lastSentWeek);
            result.skipped += 1;
            continue;
          }
          sent = await ports.sendEmail(to, buildWeeklyDigest(content, ports.baseUrl));
        } catch {
          sent = false;
        }
        if (sent) result.emailed += 1;
        else {
          await ports.releaseMember(row.orgId, row.userId, week, row.lastSentWeek);
          result.failed += 1;
        }
      } catch {
        result.failed += 1;
      }
    }
  }

  for (const channel of channels) {
    const org = orgs.get(channel.orgId);
    if (!org) { result.skipped += 1; continue; }
    try {
      const authors = (await ports.channelAuthors(channel.orgId)).sort();
      let who: RecipientAccess | null = null;
      for (const id of authors) {
        const r = await ports.recipient(channel.orgId, id);
        if (r && (r.role === 'owner' || r.role === 'admin')) { who = r; break; }
      }
      if (!who) { result.skipped += 1; continue; }
      if (!(await ports.claimChannel(channel.orgId, week))) { result.skipped += 1; continue; }
      let posted = false;
      try {
        const content = await ports.content(who, org, now);
        if (isEmptyDigest(content)) { result.empty += 1; continue; }
        posted = await ports.postSlack(channel.orgId, buildWeeklyDigest(content, ports.baseUrl));
      } catch {
        posted = false;
      }
      if (posted) result.slacked += 1;
      else {
        await ports.releaseChannel(channel.orgId, week, channel.lastSentWeek);
        result.failed += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
