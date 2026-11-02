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
 * never the asker. ONE recipient per request (the closed union is one person per ask): a role-`artist`
 * member scoped to that artist comes before the artist org's owner, then the earliest `joined_at`, then the
 * lowest user id — deterministic, so the same request always reaches the same person (`pickRecipient`).
 * Best effort: the request is recorded either way, and the UI
 * says when nobody could be reached.
 */
import { loadAccountLinks } from './store-consent-store';
import { proposalRecipients } from './store-consent';
import { notifyDirectAsk, type NotifyAdmin } from './notify';

type Candidate = { userId: string; role: string; joinedAt: string };

/** The one account to ask: role `artist` before anything else, then the earliest member, then the lowest id. */
export function pickRecipient(candidates: readonly Candidate[]): string | null {
  const sorted = [...candidates].sort(
    (a, b) => Number(b.role === 'artist') - Number(a.role === 'artist') || a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId),
  );
  return sorted[0]?.userId ?? null;
}

export async function askArtistForAsset(
  admin: NotifyAdmin,
  input: { orgId: string; askerId: string; askerName: string | null; releaseId: string; releaseTitle: string; artistContactId: string; kind: string },
): Promise<{ recipientId: string | null; failed: boolean }> {
  const links = await loadAccountLinks(admin, input.orgId, [input.artistContactId]);
  const { recipients } = proposalRecipients([input.artistContactId], links, input.askerId);
  if (recipients.length === 0) return { recipientId: null, failed: false };
  const ids = [...new Set(recipients.map((r) => r.userId))];
  const members = await admin.from('org_members').select('user_id, role, joined_at').eq('org_id', input.orgId).in('user_id', ids);
  if (members.error) throw new Error(`recipient read: ${members.error.message}`);
  const chosen = pickRecipient(
    ((members.data ?? []) as { user_id: string; role: string; joined_at: string | null }[]).map((m) => ({ userId: m.user_id.toLowerCase(), role: m.role, joinedAt: m.joined_at ?? '' })),
  );
  if (!chosen) return { recipientId: null, failed: false };
  const res = await notifyDirectAsk(admin, {
    kind: 'asset_requested',
    orgId: input.orgId,
    recipientId: chosen,
    actorId: input.askerId,
    actorName: input.askerName,
    subject: input.releaseTitle,
    data: { releaseId: input.releaseId, assetKind: input.kind },
  });
  return { recipientId: res.ok ? chosen : null, failed: !res.ok && res.skipped === 'failed' };
}
