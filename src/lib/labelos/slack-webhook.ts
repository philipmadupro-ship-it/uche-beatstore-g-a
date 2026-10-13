/**
 * Slack incoming-webhook URLs for the weekly digest (LABEL-38): validation
 * and posting.
 *
 * SSRF: the digest posts to a URL an org admin typed, from our server. The
 * guard is an exact allowlist rather than a private-address filter: https,
 * host EXACTLY `hooks.slack.com`, the default port, no credentials, no query
 * or fragment, and Slack's own `/services/T…/B…/…` path. A fixed public
 * hostname cannot be an IP literal, `localhost` or an internal name. The post
 * then follows NO redirects (a 3xx is a failure, not a hop to somewhere else),
 * has a timeout, and sends only the digest body.
 *
 * The URL is a secret: it appears in no error, log line or return value here.
 */
export const SLACK_WEBHOOK_HOST = 'hooks.slack.com';
const PATH = /^\/services\/[A-Z0-9]{8,}\/[A-Z0-9]{8,}\/[A-Za-z0-9]{16,}$/;

export type WebhookCheck = { ok: true; url: string } | { ok: false; reason: string };

export function validateSlackWebhookUrl(raw: unknown): WebhookCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'Enter the Slack webhook URL' };
  const text = raw.trim();
  if (text.length === 0 || text.length > 300) return { ok: false, reason: 'Enter the Slack webhook URL' };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, reason: 'That is not a URL' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'The webhook must be an https URL' };
  if (u.hostname !== SLACK_WEBHOOK_HOST || u.port !== '') return { ok: false, reason: `Use a Slack incoming webhook (${SLACK_WEBHOOK_HOST})` };
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: 'Use the webhook URL exactly as Slack shows it' };
  if (!PATH.test(u.pathname)) return { ok: false, reason: 'That does not look like a Slack incoming webhook URL' };
  return { ok: true, url: `https://${SLACK_WEBHOOK_HOST}${u.pathname}` };
}

export type SlackResult = { ok: true } | { ok: false; reason: 'rejected' | 'redirect' | 'network' };

export async function postToSlack(
  url: string,
  body: { text: string; blocks: unknown[] },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<SlackResult> {
  // A stored URL is re-checked: a row that no longer validates is never posted to.
  if (!validateSlackWebhookUrl(url).ok) return { ok: false, reason: 'rejected' };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) return { ok: false, reason: 'redirect' };
    return res.ok ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
