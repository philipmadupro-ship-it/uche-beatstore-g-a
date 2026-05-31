/**
 * Shared transactional-email building blocks.
 *
 * The store's outbound emails (offers, stems delivery, cart recovery, drop
 * notifications) all use the same dark-warm shell, accent button, and label.
 * They were copy-pasted into each route/cron, which drifts over time. These
 * pure helpers centralize the markup so every email stays on-brand and a
 * tweak lands once.
 *
 * Pure string builders — no Resend dependency here, so they're trivially
 * unit-testable and usable from any route or cron.
 */

const BG = '#0a0907';
const TEXT = '#E8DCC8';
const MUTED = '#a08a6a';
const FAINT = '#3a3328';
const ACCENT = '#D4BFA0';

/** Wrap body HTML in the standard dark card shell with an uppercase eyebrow. */
export function emailShell(eyebrow: string, bodyHtml: string): string {
  return `<div style="background:${BG};color:${TEXT};padding:32px;font-family:sans-serif;border-radius:12px">
      <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};margin:0 0 8px">${eyebrow}</p>
      ${bodyHtml}
    </div>`;
}

/** Primary accent CTA button. */
export function emailButton(label: string, href: string): string {
  return `<a href="${href}" style="background:${ACCENT};color:${BG};padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:13px">${label}</a>`;
}

/** A footer "you follow X · manage" line. */
export function emailFooter(text: string, manageHref: string): string {
  return `<p style="color:${FAINT};font-size:10px;margin:20px 0 0">${text} <a href="${manageHref}" style="color:#6a5d4a">Manage</a>.</p>`;
}

/** A two-column line-item table (name → right-aligned value). */
export function emailItemTable(rows: Array<{ label: string; value?: string }>): string {
  const trs = rows.map((r) =>
    `<tr><td style="padding:6px 0;color:${TEXT};font-size:13px">${r.label}</td>` +
    (r.value != null ? `<td style="padding:6px 0;text-align:right;color:${MUTED};font-size:13px">${r.value}</td>` : '<td></td>') +
    `</tr>`,
  ).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px">${trs}</table>`;
}

/** Standard h1 used inside the shell. */
export function emailHeading(text: string, color = ACCENT): string {
  return `<h1 style="color:${color};font-size:22px;margin:0 0 12px">${text}</h1>`;
}
