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
 *  - a failed send RELEASES the claim (the previous value is put back), and a
 *    released claim is retried by the next run IN THE SAME ISO WEEK (the cron
 *    runs daily; the week key only changes on Monday); a claim is never
 *    released after a successful send;
 *  - NO FIXED SLICE: due members are walked org by org with a cursor
 *    (`nextDueOrg`) until none is left or the time budget is spent. When the
 *    budget ends the run, the rest are left UNclaimed and the next run
 *    (tomorrow, same week) picks them up — the ones already served are claimed
 *    and no longer due, so the front of the queue always moves;
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
import { buildWeeklyDigest, isEmptyDigest, isoWeekKey, type DigestMessage, type DigestSubscription, type WeeklyDigestContent } from './weekly-digest';

export type DueRow = DigestSubscription & { orgId: string };

export type OrgInfo = { id: string; name: string; slug: string };

export type RecipientAccess = { userId: string; orgId: string; role: string };

export type DigestPorts = {
  /** The next org (by id, after `afterOrgId`) with an opted-in member not yet sent for `week`, and those members. null = none left. */
  nextDueOrg(week: string, afterOrgId: string | null): Promise<{ orgId: string; members: DueRow[] } | null>;
  /** Orgs with a Slack channel not yet posted for `week`, after `afterOrgId`, at most `limit`. */
  dueChannels(week: string, afterOrgId: string | null, limit: number): Promise<Array<{ orgId: string; lastSentWeek: string }>>;
  orgInfo(orgIds: readonly string[]): Promise<Map<string, OrgInfo>>;
  /** A live member with catalog.read, or null (not a member, org deleted, lost the capability). */
  recipient(orgId: string, userId: string): Promise<RecipientAccess | null>;
  /** Content through that member's own access. */
  content(r: RecipientAccess, org: OrgInfo, now: Date): Promise<WeeklyDigestContent>;
  claimMember(orgId: string, userId: string, week: string): Promise<boolean>;
  releaseMember(orgId: string, userId: string, week: string, previous: string): Promise<void>;
  claimChannel(orgId: string, week: string): Promise<boolean>;
  releaseChannel(orgId: string, week: string, previous: string): Promise<void>;
  /** Opted-in members of an org, any order (the runner keeps owners and admins). */
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
  /** The time budget ended the run: the rest were left unclaimed for the next run. */
  stoppedForTime: boolean;
};

export type RunOptions = {
  /** Stop starting new work after this many ms (default: no limit). */
  budgetMs?: number;
  /** Channels handled per run. */
  maxChannels?: number;
  /** Members looked at per channel to find an owner or admin who opted in. */
  maxAuthorLookups?: number;
  clock?: () => number;
};

export const MAX_CHANNELS = 50;
export const MAX_AUTHOR_LOOKUPS = 20;

export async function runWeeklyDigest(ports: DigestPorts, now: Date = new Date(), opts: RunOptions = {}): Promise<RunResult> {
  const week = isoWeekKey(now);
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  const outOfTime = () => opts.budgetMs !== undefined && clock() - startedAt >= opts.budgetMs;
  const result: RunResult = { week, emailed: 0, slacked: 0, empty: 0, skipped: 0, failed: 0, stoppedForTime: false };

  if (ports.emailConfigured) {
    let after: string | null = null;
    walk: for (;;) {
      if (outOfTime()) { result.stoppedForTime = true; break; }
      const next = await ports.nextDueOrg(week, after);
      if (!next) break;
      after = next.orgId;
      const org = (await ports.orgInfo([next.orgId])).get(next.orgId);
      const rows = [...next.members].filter((m) => m.enabled && m.lastSentWeek !== week).sort((a, b) => a.userId.localeCompare(b.userId));
      for (const row of rows) {
        if (outOfTime()) { result.stoppedForTime = true; break walk; }
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
  }

  if (!result.stoppedForTime) {
    const maxChannels = opts.maxChannels ?? MAX_CHANNELS;
    const maxLookups = opts.maxAuthorLookups ?? MAX_AUTHOR_LOOKUPS;
    const channels = await ports.dueChannels(week, null, maxChannels);
    const orgs = await ports.orgInfo(channels.map((c) => c.orgId));
    for (const channel of channels) {
      if (outOfTime()) { result.stoppedForTime = true; break; }
      const org = orgs.get(channel.orgId);
      if (!org) { result.skipped += 1; continue; }
      try {
        const authors = (await ports.channelAuthors(channel.orgId)).sort().slice(0, maxLookups);
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
  }
  return result;
}
