/**
 * The "Notify artist" digest email.
 *
 * Adding material never emails anyone by itself. After a round of changes the
 * producer presses "Notify · N new" and the artist gets ONE email listing what
 * is new, pointing at the same portal link as always. Pure so the wording and
 * the escaping are tested; the route only sends what this returns.
 */

export interface DigestProject {
  name: string;
  /** True when the whole project is new to the artist. */
  isNewProject: boolean;
  /** Titles of tracks new in this project (for a new project: its tracks). */
  trackTitles: string[];
}

export interface DigestInput {
  artistName: string;
  producerName: string;
  portalUrl: string;
  message?: string | null;
  projects: DigestProject[];
}

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
  itemCount: number;
}

const MAX_TITLES_PER_PROJECT = 8;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function projectLine(p: DigestProject): string {
  const count = p.trackTitles.length;
  if (p.isNewProject) return `${p.name} — new project${count ? ` · ${count} track${count === 1 ? '' : 's'}` : ''}`;
  return `${p.name} — ${count} new track${count === 1 ? '' : 's'}`;
}

export function buildPortalDigest(input: DigestInput): DigestEmail {
  const projects = input.projects.filter((p) => p.isNewProject || p.trackTitles.length > 0);
  const itemCount = projects.reduce((n, p) => n + (p.isNewProject ? 1 : p.trackTitles.length), 0);
  const producer = input.producerName.trim() || 'Your producer';
  const artist = input.artistName.trim() || 'there';

  const subject = itemCount === 1 && projects[0]?.isNewProject
    ? `${producer} shared ${projects[0].name} with you`
    : `${producer}: ${itemCount} new in your library`;

  const textLines = [
    `Hi ${artist},`,
    '',
    input.message?.trim() ? `${input.message.trim()}\n` : null,
    `New in your library:`,
    ...projects.flatMap((p) => [
      `• ${projectLine(p)}`,
      ...p.trackTitles.slice(0, MAX_TITLES_PER_PROJECT).map((t) => `    – ${t}`),
      ...(p.trackTitles.length > MAX_TITLES_PER_PROJECT ? [`    – and ${p.trackTitles.length - MAX_TITLES_PER_PROJECT} more`] : []),
    ]),
    '',
    `Open your library: ${input.portalUrl}`,
    '',
    'Same link as always — bookmark it.',
  ].filter((l): l is string => l !== null);

  const projectHtml = projects.map((p) => {
    const titles = p.trackTitles.slice(0, MAX_TITLES_PER_PROJECT).map((t) =>
      `<li style="margin:2px 0;color:#bdbdbd;">${escapeHtml(t)}</li>`).join('');
    const more = p.trackTitles.length > MAX_TITLES_PER_PROJECT
      ? `<li style="margin:2px 0;color:#8a8a8a;">and ${p.trackTitles.length - MAX_TITLES_PER_PROJECT} more</li>`
      : '';
    return `<div style="margin:0 0 16px;">
      <p style="margin:0 0 4px;font-size:14px;color:#fff;font-weight:600;">${escapeHtml(projectLine(p))}</p>
      ${titles || more ? `<ul style="margin:0;padding-left:18px;font-size:13px;">${titles}${more}</ul>` : ''}
    </div>`;
  }).join('');

  const safeUrl = escapeHtml(input.portalUrl);
  const message = input.message?.trim()
    ? `<div style="font-size:14px;line-height:1.6;color:#ccc;border-left:2px solid #444;padding:10px 16px;margin:0 0 20px;">${escapeHtml(input.message.trim()).replace(/\n/g, '<br>')}</div>`
    : '';

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#090907;color:#fff;padding:40px 24px;">
    <table style="max-width:520px;margin:0 auto;background:#0D0D0A;border:1px solid #222;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:32px;">
        <p style="font-size:11px;color:#9a9a9a;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">${escapeHtml(producer)}</p>
        <h1 style="font-size:20px;font-weight:600;margin:0 0 18px;color:#fff;">Hi ${escapeHtml(artist)} — new in your library</h1>
        ${message}
        ${projectHtml}
        <a href="${safeUrl}" style="display:inline-block;background:#fff;color:#090907;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;font-size:12px;">Open your library</a>
        <p style="font-size:11px;color:#8a8a8a;margin:24px 0 0;">Same link as always — bookmark it.<br><a href="${safeUrl}" style="color:#bdbdbd;">${safeUrl}</a></p>
      </td></tr>
    </table>
  </div>`;

  return { subject, html, text: textLines.join('\n'), itemCount };
}
