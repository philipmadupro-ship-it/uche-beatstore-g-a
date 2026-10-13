/**
 * The weekly owner digest (LABEL-38). Pure: members and already-scoped
 * content in, a message out. The loader (weekly-digest-store.ts) builds each
 * recipient's content THROUGH THEIR OWN access (`loadAttention` and
 * `loadActivityFeed` apply the artist scope, D4 and `business.read.internal`
 * before anything reaches this file), so nothing here can name or count a
 * thing the recipient may not see. In particular `restricted` counts from
 * either loader are never read: a digest carries no totals of hidden things.
 *
 * One message per member per ISO week, claimed in the database
 * (weekly-digest-store.ts) before sending; `isoWeekKey` is the claim's value.
 */
import type { AttentionItem } from './attention';
import { buildDigest, describeLine, type DigestEvent, type DigestNames } from './digest';

// ── Week ────────────────────────────────────────────────────────────────

/** `2026-W42`: the ISO-8601 week (Monday start, week 1 holds the first Thursday) of a UTC instant. */
export function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;

/** The activity window: the seven days before the run. */
export const DIGEST_WINDOW_DAYS = 7;
export const digestSince = (now: Date): string => new Date(now.getTime() - DIGEST_WINDOW_DAYS * 86_400_000).toISOString();

// ── Recipients ──────────────────────────────────────────────────────────

export type DigestSubscription = {
  userId: string;
  enabled: boolean;
  /** The ISO week of the last digest claimed for this member ('' = never). */
  lastSentWeek: string;
};

/** Members who opted in and have not had this week's digest. Sorted, so a run is deterministic. */
export function dueMembers(subs: readonly DigestSubscription[], week: string): string[] {
  return subs
    .filter((s) => s.enabled && s.lastSentWeek !== week)
    .map((s) => s.userId)
    .sort();
}

// ── Content ─────────────────────────────────────────────────────────────

export type DigestActivityLine = { artist: string | null; actor: string; text: string };

export type WeeklyDigestContent = {
  orgName: string;
  orgSlug: string;
  attention: AttentionItem[];
  activity: DigestActivityLine[];
};

/** Lines per list: the digest is a nudge, the app is the place to read the rest. */
export const MAX_ATTENTION = 8;
export const MAX_ACTIVITY = 8;

/** Activity events (already visible to the recipient) as plain lines, newest section first. */
export function activityLines(events: readonly DigestEvent[], names: DigestNames, projectArtists?: ReadonlyMap<string, readonly string[]>): DigestActivityLine[] {
  const digest = buildDigest(events, { view: 'overview', projectArtists });
  const out: DigestActivityLine[] = [];
  for (const section of digest.sections) {
    const artist = section.artistId === null ? null : names.artists[section.artistId] ?? null;
    for (const day of section.days) {
      for (const line of day.lines) {
        const { actor, text } = describeLine(line, names);
        out.push({ artist, actor, text });
      }
    }
  }
  return out;
}

/** Nothing to say = no message. */
export function isEmptyDigest(c: Pick<WeeklyDigestContent, 'attention' | 'activity'>): boolean {
  return c.attention.length === 0 && c.activity.length === 0;
}

// ── Rendering ───────────────────────────────────────────────────────────

export type DigestMessage = {
  subject: string;
  text: string;
  html: string;
  /** A Slack incoming-webhook body. */
  slack: { text: string; blocks: unknown[] };
};

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Slack mrkdwn control characters. */
const escapeSlack = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function absoluteHref(baseUrl: string, href: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${href}`;
}

function counted(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** The subject names what is inside, from the shown lists only. */
export function digestSubject(c: WeeklyDigestContent): string {
  const parts: string[] = [];
  if (c.attention.length > 0) parts.push(`${counted(c.attention.length, 'item needs', 'items need')} attention`);
  if (c.activity.length > 0) parts.push(counted(c.activity.length, 'update', 'updates'));
  return `${c.orgName}: ${parts.join(', ')}`;
}

export function buildWeeklyDigest(c: WeeklyDigestContent, baseUrl: string): DigestMessage {
  const attention = c.attention.slice(0, MAX_ATTENTION);
  const moreAttention = c.attention.length - attention.length;
  const activity = c.activity.slice(0, MAX_ACTIVITY);
  const moreActivity = c.activity.length - activity.length;
  const overview = absoluteHref(baseUrl, `/o/${c.orgSlug}`);
  const link = (a: AttentionItem) => absoluteHref(baseUrl, a.action.href);
  const attentionLine = (a: AttentionItem) => clean(`${a.title}${a.artistName ? ` (${a.artistName})` : ''} - ${a.detail}`);
  const activityLine = (l: DigestActivityLine) => clean(`${l.artist ? `${l.artist}: ` : ''}${l.actor} ${l.text}`);
  const subject = digestSubject(c);

  const textParts: string[] = [`${c.orgName} - your week`, ''];
  if (attention.length > 0) {
    textParts.push('NEEDS ATTENTION');
    for (const a of attention) textParts.push(`- ${attentionLine(a)}\n  ${link(a)}`);
    if (moreAttention > 0) textParts.push(`- and ${moreAttention} more: ${overview}`);
    textParts.push('');
  }
  if (activity.length > 0) {
    textParts.push('THIS WEEK');
    for (const l of activity) textParts.push(`- ${activityLine(l)}`);
    if (moreActivity > 0) textParts.push(`- and ${moreActivity} more: ${overview}`);
    textParts.push('');
  }
  textParts.push(`Open ${c.orgName}: ${overview}`, '', 'You get this because you turned on the weekly digest. Turn it off in the organization settings.');

  const li = (inner: string) => `<li style="margin:0 0 10px">${inner}</li>`;
  const htmlParts: string[] = [
    `<div style="font-family:Arial,sans-serif;background:#090907;color:#d8d8d4;padding:24px"><div style="max-width:560px;margin:0 auto">`,
    `<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8a8a86;margin:0 0 6px">${escapeHtml(c.orgName)}</p>`,
    `<h1 style="font-size:22px;font-weight:600;color:#f1f1ee;margin:0 0 20px">Your week</h1>`,
  ];
  if (attention.length > 0) {
    htmlParts.push(`<h2 style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8a8a86;margin:0 0 10px">Needs attention</h2><ul style="padding-left:18px;margin:0 0 20px">`);
    for (const a of attention) htmlParts.push(li(`<a href="${escapeHtml(link(a))}" style="color:#f1f1ee">${escapeHtml(attentionLine(a))}</a>`));
    if (moreAttention > 0) htmlParts.push(li(`<a href="${escapeHtml(overview)}" style="color:#8a8a86">and ${moreAttention} more</a>`));
    htmlParts.push('</ul>');
  }
  if (activity.length > 0) {
    htmlParts.push(`<h2 style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8a8a86;margin:0 0 10px">This week</h2><ul style="padding-left:18px;margin:0 0 20px">`);
    for (const l of activity) htmlParts.push(li(escapeHtml(activityLine(l))));
    if (moreActivity > 0) htmlParts.push(li(`<a href="${escapeHtml(overview)}" style="color:#8a8a86">and ${moreActivity} more</a>`));
    htmlParts.push('</ul>');
  }
  htmlParts.push(
    `<p style="margin:0 0 20px"><a href="${escapeHtml(overview)}" style="color:#f1f1ee">Open ${escapeHtml(c.orgName)}</a></p>`,
    `<p style="font-size:11px;color:#6f6f6b;margin:0">You get this because you turned on the weekly digest. Turn it off in the organization settings.</p>`,
    '</div></div>',
  );

  const blocks: unknown[] = [{ type: 'header', text: { type: 'plain_text', text: clean(`${c.orgName}: your week`).slice(0, 150) } }];
  if (attention.length > 0) {
    const body = attention.map((a) => `• <${link(a)}|${escapeSlack(attentionLine(a)).replace(/\|/g, '/')}>`);
    if (moreAttention > 0) body.push(`• <${overview}|and ${moreAttention} more>`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Needs attention*\n${body.join('\n')}`.slice(0, 2900) } });
  }
  if (activity.length > 0) {
    const body = activity.map((l) => `• ${escapeSlack(activityLine(l))}`);
    if (moreActivity > 0) body.push(`• <${overview}|and ${moreActivity} more>`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*This week*\n${body.join('\n')}`.slice(0, 2900) } });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${overview}|Open ${escapeSlack(c.orgName)}>` }] });

  return { subject, text: textParts.join('\n'), html: htmlParts.join(''), slack: { text: subject, blocks } };
}

