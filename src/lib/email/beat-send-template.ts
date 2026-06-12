/**
 * Canonical HTML template for beat-send emails.
 *
 * Used by BOTH the SendBeatModal preview AND /api/email/route.ts so the
 * recipient sees exactly what the preview showed — no more divergence.
 *
 * Design: dark luxury, on-brand (U2C palette). Cover art as a full-width
 * header image. Clean typographic hierarchy. One primary CTA.
 *
 * Pure string builder — no Resend dependency, trivially unit-testable.
 */

import { escapeHtml } from './templates';

const BG      = '#090907';
const BG2     = '#1A1813';
const BG3     = '#2B2821';
const TEXT    = '#F7EBDD';
const MUTED   = '#D0C3AF';
const FAINT   = '#9B9282';
const ACCENT  = '#E7D7BE';
const BORDER  = '#3B372F';

export interface BeatSendEmailOpts {
  /** First name or full name of the recipient. Will be used in greeting. */
  recipientName: string;
  /** The share URL the button links to. */
  shareUrl: string;
  /** Pack title: single track title or "N Tracks". */
  packTitle: string;
  /** E.g. "1 track · lease" or "4 tracks · preview only". */
  packMeta: string;
  /** Optional cover image URL (absolute). */
  coverUrl?: string | null;
  /** Producer's personalised message. Escaped + line-break converted. */
  message: string;
  /** Whether downloads are enabled — shown in permissions row. */
  allowDownloads: boolean;
  /** Expiry days (0 = never). Shown in permissions row. */
  expiresDays: number;
  /** Subject line (returned separately so callers can pass to Resend). */
  subject?: string;
  /** "tracks" | "project" — changes the eyebrow label and button text. */
  kind?: 'tracks' | 'project';
  /** Track list metadata for multi-track sends (optional). */
  tracks?: Array<{ title: string; bpm?: number | null; key?: string | null; type?: string | null }>;
  /** Producer display name. Falls back to "U2C Beatstore". */
  producerName?: string;
}

/** Returns the full email HTML string. */
export function buildBeatSendEmail(opts: BeatSendEmailOpts): string {
  const {
    recipientName, shareUrl, packTitle, packMeta, coverUrl, message,
    allowDownloads, expiresDays, kind = 'tracks', tracks = [], producerName = 'U2C Beatstore',
  } = opts;

  const first = escapeHtml(recipientName.split(' ')[0] || recipientName);
  const safeUrl = escapeHtml(shareUrl);
  const safeTitle = escapeHtml(packTitle);
  const safeMeta = escapeHtml(packMeta);
  const safeProducer = escapeHtml(producerName);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');
  const eyebrow = kind === 'project' ? 'Project share' : 'New music';
  const btnLabel = kind === 'project' ? 'Open project' : 'Listen to the pack';

  const expiryText = expiresDays === 0 ? 'No expiry' : `Link expires in ${expiresDays} day${expiresDays === 1 ? '' : 's'}`;

  const coverBlock = coverUrl
    ? `<img src="${escapeHtml(coverUrl)}" alt="" style="width:100%;display:block;max-height:260px;object-fit:cover;border-bottom:1px solid ${BORDER};">`
    : `<div style="height:8px;background:linear-gradient(135deg,${ACCENT}22 0%,${BG2} 100%);"></div>`;

  const trackListBlock = tracks.length > 1
    ? `<table style="width:100%;border-collapse:collapse;margin:0 0 24px">
        ${tracks.map((t, i) => `
          <tr style="border-top:1px solid ${BG3}">
            <td style="padding:8px 0;color:${FAINT};font-size:11px;font-family:monospace;width:28px">${String(i + 1).padStart(2, '0')}</td>
            <td style="padding:8px 4px;color:${TEXT};font-size:13px">${escapeHtml(t.title)}</td>
            <td style="padding:8px 0;color:${MUTED};font-size:11px;font-family:monospace;text-align:right;white-space:nowrap">
              ${t.bpm ? `${t.bpm}` : ''}${t.key ? ` · ${escapeHtml(t.key)}` : ''}
            </td>
          </tr>`).join('')}
      </table>`
    : '';

  const messageBlock = safeMessage
    ? `<p style="font-size:14px;color:${TEXT};line-height:1.75;margin:0 0 24px">${safeMessage}</p>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:580px;margin:0 auto;padding:24px 16px 48px">

    <!-- Header -->
    <div style="margin:0 0 16px;text-align:center">
      <p style="font-size:10px;color:${FAINT};letter-spacing:3px;text-transform:uppercase;margin:0">${safeProducer}</p>
    </div>

    <!-- Card -->
    <div style="background:${BG2};border:1px solid ${BORDER};border-radius:16px;overflow:hidden">

      <!-- Cover image (or gradient strip) -->
      ${coverBlock}

      <!-- Body -->
      <div style="padding:28px 28px 32px">

        <!-- Eyebrow + title -->
        <p style="font-size:10px;color:${MUTED};letter-spacing:3px;text-transform:uppercase;margin:0 0 10px">${eyebrow}</p>
        <h1 style="font-size:24px;font-weight:700;color:${TEXT};margin:0 0 6px;line-height:1.2">${safeTitle}</h1>
        <p style="font-size:12px;color:${FAINT};font-family:monospace;margin:0 0 28px;letter-spacing:1px;text-transform:uppercase">${safeMeta}</p>

        <!-- Greeting -->
        <p style="font-size:14px;color:${TEXT};line-height:1.6;margin:0 0 16px">Hey ${first},</p>

        <!-- Personal message -->
        ${messageBlock}

        <!-- Track list (multi-track sends) -->
        ${trackListBlock}

        <!-- Primary CTA -->
        <a href="${safeUrl}"
          style="display:inline-block;background:${ACCENT};color:${BG};padding:14px 32px;text-decoration:none;border-radius:10px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 28px">
          ${btnLabel}
        </a>

        <!-- Permissions strip -->
        <div style="border-top:1px solid ${BG3};padding-top:16px;display:flex;gap:24px;flex-wrap:wrap">
          <span style="font-size:11px;color:${FAINT};font-family:monospace">${allowDownloads ? '↓ Downloads on' : '↓ Downloads off'}</span>
          <span style="font-size:11px;color:${FAINT};font-family:monospace">⏳ ${expiryText}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <p style="text-align:center;font-size:10px;color:${FAINT};letter-spacing:2px;text-transform:uppercase;margin:24px 0 0">
      Sent via ${safeProducer}
    </p>
  </div>
</body>
</html>`.trim();
}

/**
 * Derive a sensible subject line from the send context.
 * Callers can override; this is the default when no custom subject is set.
 */
export function defaultSubject(producerName: string, packTitle: string, kind: 'tracks' | 'project' = 'tracks'): string {
  const label = kind === 'project' ? 'Project' : 'New music';
  return `${label}: ${packTitle} — ${producerName}`;
}
