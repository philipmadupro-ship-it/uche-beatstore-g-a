/**
 * Messages and requests between the producer and one artist (mig 130).
 *
 * One thread per contact, not per project: portal comments already cover
 * "about this beat". A request is an artist's message with a status the
 * producer moves (open → done / declined). Both audiences read rows through
 * `toArtistMessage`, built field by field — the portal must never see the
 * owner id, the contact id or when an email went out.
 */

import { escapeHtml } from '@/lib/artist-portal/digest';

export const MESSAGE_AUTHORS = ['producer', 'artist'] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];
export const MESSAGE_KINDS = ['message', 'request'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export const REQUEST_STATUSES = ['open', 'done', 'declined'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const ARTIST_MESSAGE_COLUMNS = 'id, contact_id, project_id, author, kind, body, request_status, resolved_at, read_at, emailed_at, created_at';

export interface MessageRow {
  id: string;
  contact_id: string;
  project_id: string | null;
  author: string;
  kind: string;
  body: string;
  request_status: string | null;
  resolved_at: string | null;
  read_at: string | null;
  emailed_at: string | null;
  created_at: string;
}

export interface ArtistMessage {
  id: string;
  author: MessageAuthor;
  kind: MessageKind;
  body: string;
  projectId: string | null;
  projectName: string | null;
  requestStatus: RequestStatus | null;
  resolvedAt: string | null;
  /** When the other side saw it. */
  readAt: string | null;
  createdAt: string;
  authorName: string;
  /** Producer view only: when the message was also emailed. */
  emailedAt?: string | null;
}

function isRequestStatus(v: unknown): v is RequestStatus {
  return typeof v === 'string' && (REQUEST_STATUSES as readonly string[]).includes(v);
}

export function toArtistMessage(
  row: MessageRow,
  ctx: {
    audience: 'portal' | 'producer';
    artistName: string;
    producerName: string;
    projectNames?: ReadonlyMap<string, string>;
  },
): ArtistMessage {
  const author: MessageAuthor = row.author === 'producer' ? 'producer' : 'artist';
  const kind: MessageKind = row.kind === 'request' && author === 'artist' ? 'request' : 'message';
  const name = author === 'producer' ? ctx.producerName : ctx.artistName;
  const msg: ArtistMessage = {
    id: row.id,
    author,
    kind,
    body: row.body,
    projectId: row.project_id,
    projectName: row.project_id ? ctx.projectNames?.get(row.project_id) ?? null : null,
    requestStatus: kind === 'request' ? (isRequestStatus(row.request_status) ? row.request_status : 'open') : null,
    resolvedAt: kind === 'request' ? row.resolved_at : null,
    readAt: row.read_at,
    createdAt: row.created_at,
    authorName: name.trim() || (author === 'producer' ? 'Producer' : 'Artist'),
  };
  if (ctx.audience === 'producer') msg.emailedAt = row.emailed_at;
  return msg;
}

/** Messages written by `from` that the other side has not seen yet. */
export function unreadFrom(messages: ReadonlyArray<Pick<ArtistMessage, 'author' | 'readAt'>>, from: MessageAuthor): number {
  return messages.filter((m) => m.author === from && !m.readAt).length;
}

export function openRequests<T extends Pick<ArtistMessage, 'kind' | 'requestStatus'>>(messages: readonly T[]): T[] {
  return messages.filter((m) => m.kind === 'request' && m.requestStatus === 'open');
}

/** The row change for the producer moving a request. Resolving stamps the time; reopening clears it. */
export function requestStatusPatch(status: RequestStatus, now: string): { request_status: RequestStatus; resolved_at: string | null } {
  return { request_status: status, resolved_at: status === 'open' ? null : now };
}

/* ── Email fallback ────────────────────────────────────────────────────── */

/** An artist who loaded the portal this recently will see the message there. */
export const ACTIVE_WINDOW_MS = 10 * 60_000;
/** One email per burst: while an emailed message is still unread, later ones wait this long. */
export const EMAIL_BURST_MS = 6 * 3_600_000;

export type EmailDecision =
  | { email: true }
  | { email: false; reason: 'no_email' | 'no_portal' | 'active' | 'recently_emailed' };

/**
 * Does a producer message also go out by email? The portal is where the
 * thread lives; the email only makes sure the artist knows to look. So: not
 * when there is no address or no live portal to point at, not when the artist
 * is on the portal right now, and not again while an earlier emailed message
 * is still unread (a burst of five messages is one email, not five).
 */
export function shouldEmailMessage(input: {
  hasEmail: boolean;
  portalLive: boolean;
  artistLastSeenAt: string | null;
  /** emailed_at of producer messages the artist has not read yet. */
  unreadEmailedAt: ReadonlyArray<string | null>;
  now: Date;
}): EmailDecision {
  if (!input.hasEmail) return { email: false, reason: 'no_email' };
  if (!input.portalLive) return { email: false, reason: 'no_portal' };
  const now = input.now.getTime();
  const seen = input.artistLastSeenAt ? Date.parse(input.artistLastSeenAt) : NaN;
  if (Number.isFinite(seen) && now - seen >= 0 && now - seen < ACTIVE_WINDOW_MS) return { email: false, reason: 'active' };
  const recent = input.unreadEmailedAt.some((v) => {
    const t = v ? Date.parse(v) : NaN;
    return Number.isFinite(t) && now - t < EMAIL_BURST_MS;
  });
  if (recent) return { email: false, reason: 'recently_emailed' };
  return { email: true };
}

export function buildMessageEmail(input: { artistName: string; producerName: string; portalUrl: string; body: string }) {
  const producer = input.producerName.trim() || 'Your producer';
  const artist = input.artistName.trim() || 'there';
  const body = input.body.trim();
  const safeUrl = escapeHtml(input.portalUrl);
  const subject = `New message from ${producer}`;
  const text = [
    `Hi ${artist},`,
    '',
    `${producer} wrote:`,
    '',
    body,
    '',
    `Reply in your library: ${input.portalUrl}`,
  ].join('\n');
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#090907;color:#fff;padding:40px 24px;">
    <table style="max-width:520px;margin:0 auto;background:#0D0D0A;border:1px solid #222;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:32px;">
        <p style="font-size:11px;color:#9a9a9a;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">${escapeHtml(producer)}</p>
        <h1 style="font-size:20px;font-weight:600;margin:0 0 18px;color:#fff;">Hi ${escapeHtml(artist)} — a message for you</h1>
        <div style="font-size:14px;line-height:1.6;color:#ccc;border-left:2px solid #444;padding:10px 16px;margin:0 0 20px;">${escapeHtml(body).replace(/\n/g, '<br>')}</div>
        <a href="${safeUrl}" style="display:inline-block;background:#fff;color:#090907;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;font-size:12px;">Reply in your library</a>
        <p style="font-size:11px;color:#8a8a8a;margin:24px 0 0;">Replies go in your library, not to this email.<br><a href="${safeUrl}" style="color:#bdbdbd;">${safeUrl}</a></p>
      </td></tr>
    </table>
  </div>`;
  return { subject, html, text };
}

/* ── The producer's notification ───────────────────────────────────────── */

export const ARTIST_MESSAGE_NOTIFICATION = 'artist_message';
export const ARTIST_REQUEST_NOTIFICATION = 'artist_request';

const PREVIEW_MAX = 140;

export function buildArtistMessageNotification(input: {
  ownerId: string;
  contactId: string;
  contactName: string;
  messageId: string;
  kind: MessageKind;
  body: string;
  projectName: string | null;
}) {
  const who = input.contactName.trim() || 'An artist';
  const flat = input.body.replace(/\s+/g, ' ').trim();
  const about = input.projectName?.trim() ? ` for ${input.projectName.trim()}` : '';
  return {
    user_id: input.ownerId,
    kind: input.kind === 'request' ? ARTIST_REQUEST_NOTIFICATION : ARTIST_MESSAGE_NOTIFICATION,
    title: input.kind === 'request' ? `${who} asked for something${about}` : `${who} sent you a message`,
    body: flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat,
    data: { contact_id: input.contactId, message_id: input.messageId },
  };
}
