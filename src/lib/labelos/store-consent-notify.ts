/**
 * The one place that asks a credited artist for their say on a store listing
 * (LABEL-71, closed-union kind `listing_proposed`). Only the store-listing PUT
 * imports it (a source-scan test in notify.test.ts holds that).
 *
 * One call per recipient account, never the asker — `notifyDirectAsk` already
 * refuses to notify the person who asked. Best effort, like every direct ask:
 * the listing happened, and a failed bell write must not report it as failed.
 * The body names the release, never a token or an email.
 */
import { notifyDirectAsk, type NotifyAdmin } from './notify';
import type { ProposalRecipients } from './store-consent';

export async function askArtistsAboutListing(
  admin: NotifyAdmin,
  input: {
    orgId: string;
    askerId: string;
    askerName: string | null;
    releaseId: string;
    releaseTitle: string;
    recipients: ProposalRecipients['recipients'];
  },
): Promise<{ asked: number; failed: number }> {
  let asked = 0;
  let failed = 0;
  for (const r of input.recipients) {
    const res = await notifyDirectAsk(admin, {
      kind: 'listing_proposed',
      orgId: input.orgId,
      recipientId: r.userId,
      actorId: input.askerId,
      actorName: input.askerName,
      subject: input.releaseTitle,
      data: { releaseId: input.releaseId, artistContactId: r.contactId },
    });
    if (res.ok) asked += 1;
    else if (res.skipped === 'failed') failed += 1;
  }
  return { asked, failed };
}
