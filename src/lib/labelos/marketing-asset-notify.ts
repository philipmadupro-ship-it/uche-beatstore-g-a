/**
 * The one place that asks an artist for material for a release's marketing plan
 * (LABEL-65, closed-union kind `asset_requested`). Only the plan's asset-request
 * POST imports it (a source-scan test in notify.test.ts holds that).
 *
 * Who is asked is the identity rule LABEL-71 used for consent
 * (`loadAccountLinks` + `proposalRecipients`): a member whose role is `artist`
 * scoped to the release's artist, or the owner of an artist org for its one
 * artist. Never a party's self-linked account, never the label staff scoped to the
 * same artist, never an address read off a contact card. One call per account,
 * never the asker. Best effort: the request is recorded either way, and the UI
 * says when nobody could be reached.
 */
import { loadAccountLinks } from './store-consent-store';
import { proposalRecipients } from './store-consent';
import { notifyDirectAsk, type NotifyAdmin } from './notify';

export async function askArtistForAsset(
  admin: NotifyAdmin,
  input: { orgId: string; askerId: string; askerName: string | null; releaseId: string; releaseTitle: string; artistContactId: string; kind: string },
): Promise<{ recipientId: string | null; failed: boolean }> {
  const links = await loadAccountLinks(admin, input.orgId, [input.artistContactId]);
  const { recipients } = proposalRecipients([input.artistContactId], links, input.askerId);
  let recipientId: string | null = null;
  let failed = false;
  for (const r of recipients) {
    const res = await notifyDirectAsk(admin, {
      kind: 'asset_requested',
      orgId: input.orgId,
      recipientId: r.userId,
      actorId: input.askerId,
      actorName: input.askerName,
      subject: input.releaseTitle,
      data: { releaseId: input.releaseId, assetKind: input.kind },
    });
    if (res.ok) recipientId = recipientId ?? r.userId;
    else if (res.skipped === 'failed') failed = true;
  }
  return { recipientId, failed };
}
