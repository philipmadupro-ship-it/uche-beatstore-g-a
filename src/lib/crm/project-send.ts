/**
 * The `beat_sends` row for a project shared with a contact.
 *
 * A project send used to be recorded only when it went out as part of a
 * campaign (`/api/campaigns/[id]/targets`). Sending a project straight from
 * SendBeatModal emailed the invite and wrote nothing, so the send never
 * reached the contact's timeline, the nudge queue or the Resend open/click
 * webhook (which correlates on `email_resend_id`). Both paths now build the
 * row here so they cannot drift.
 *
 * `track_ids` is the project's tracklist at send time. The share link itself
 * stays live — it reads `project_tracks` on every open — but the send records
 * what was actually in the project when the email went out.
 */
export interface ProjectSendInput {
  contactId: string;
  trackIds: string[];
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
  return {
    contact_id: input.contactId,
    track_ids: [...new Set(input.trackIds)],
    share_token: input.shareToken,
    message: input.message ?? '',
    status: 'sent',
    campaign_id: input.campaignId ?? null,
    email_resend_id: input.emailResendId ?? null,
  };
}
