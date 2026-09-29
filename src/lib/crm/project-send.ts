/**
 * The `beat_sends` row for a project sent to a contact.
 *
 * A project reaches a contact through two routes: the campaign path
 * (`/api/campaigns/[id]/targets`, `project_send`) and the direct path
 * (`/api/projects/[id]/shares/[shareId]/invite` with a `contact_id`). Until
 * the direct path recorded anything, a project sent outside a campaign wrote
 * no row at all, so it never reached the contact's timeline or the nudge
 * queue, and the Resend webhook, which matches on `email_resend_id`, had
 * nothing to stamp the open or click on.
 *
 * Both routes build the row here so the two cannot drift apart: a column
 * added to one path and forgotten in the other is exactly how the direct
 * path ended up recording nothing.
 */

export interface ProjectSendInput {
  contactId: string;
  /** The project's tracks at send time, in project order. */
  trackIds: readonly string[];
  shareToken: string;
  message?: string | null;
  campaignId?: string | null;
  emailResendId?: string | null;
}

export interface ProjectSendRow {
  contact_id: string;
  track_ids: string[];
  share_token: string;
  message: string;
  status: 'sent';
  campaign_id: string | null;
  email_resend_id: string | null;
}

export function buildProjectSendRow(input: ProjectSendInput): ProjectSendRow {
  // A track listed twice in a project would count twice in the timeline's
  // "sent N beats". Keep the first position, drop the rest.
  const trackIds = [...new Set(input.trackIds.filter((id) => typeof id === 'string' && id.length > 0))];
  return {
    contact_id: input.contactId,
    track_ids: trackIds,
    share_token: input.shareToken,
    message: (input.message ?? '').trim(),
    status: 'sent',
    campaign_id: input.campaignId ?? null,
    email_resend_id: input.emailResendId ?? null,
  };
}
