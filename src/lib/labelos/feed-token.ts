/**
 * The release calendar's feed token (LABEL-34). A calendar app cannot send
 * cookies, so the URL itself is the credential for ONE person in ONE org:
 *
 *     <userId>.<mac>      mac = base64url(HMAC-SHA256(secret, context))
 *     context = "label-os.cal-feed.v1" | orgId | userId | joinedAt | version
 *
 * Unguessable (256-bit MAC), per user and per org (both are in the MAC input,
 * so a token never works for another org or another person), and revocable
 * WITHOUT stored secret material: `version` is the number of feed events the
 * person has in the org's audit log (`calendar_feed.issued|revoked`), so
 * issuing a new URL or revoking bumps it and every earlier URL stops
 * verifying on the next fetch. `joinedAt` is in the MAC so leaving and
 * rejoining the org does not resurrect an old URL. Nothing here grants
 * anything by itself: the route re-reads the membership live and serves
 * titles and dates only.
 *
 * Pure: the secret is passed in. Verification is constant-time.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isUUID } from '@/lib/validate';

export const FEED_EVENT_VERBS = ['calendar_feed.issued', 'calendar_feed.revoked'] as const;
export type FeedEventVerb = (typeof FEED_EVENT_VERBS)[number];

const CONTEXT = 'label-os.cal-feed.v1';
const MAC_LENGTH = 43; // 32 bytes, base64url, no padding

export type FeedState = {
  /** The latest feed event is an issue: there is a live URL. Revoked or never issued = off. */
  active: boolean;
  /** How many feed events the person has in this org; part of every MAC. */
  version: number;
};

/** From the person's feed verbs in time order (oldest first). Unknown verbs are ignored. */
export function feedState(verbs: readonly string[]): FeedState {
  const feed = verbs.filter((v): v is FeedEventVerb => (FEED_EVENT_VERBS as readonly string[]).includes(v));
  return { active: feed.length > 0 && feed[feed.length - 1] === 'calendar_feed.issued', version: feed.length };
}

export type FeedIdentity = { orgId: string; userId: string; joinedAt: string; version: number };

function mac(secret: string, id: FeedIdentity): string {
  return createHmac('sha256', secret)
    .update([CONTEXT, id.orgId.toLowerCase(), id.userId.toLowerCase(), id.joinedAt, String(id.version)].join('\0'))
    .digest('base64url');
}

export function signFeedToken(secret: string, id: FeedIdentity): string {
  return `${id.userId.toLowerCase()}.${mac(secret, id)}`;
}

/** The two halves of a token, or null for anything that is not shaped like one (checked before any lookup). */
export function parseFeedToken(token: unknown): { userId: string; mac: string } | null {
  if (typeof token !== 'string' || token.length > 100) return null;
  const dot = token.indexOf('.');
  if (dot !== 36) return null;
  const userId = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!isUUID(userId) || provided.length !== MAC_LENGTH || !/^[A-Za-z0-9_-]+$/.test(provided)) return null;
  return { userId: userId.toLowerCase(), mac: provided };
}

/** Constant-time: the token's MAC against the one recomputed from the live facts. */
export function verifyFeedToken(secret: string, id: FeedIdentity, providedMac: string): boolean {
  const expected = Buffer.from(mac(secret, id));
  const given = Buffer.from(providedMac);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The server's HMAC secret for feed tokens; production refuses to run without one. */
export function feedSecret(): string {
  const secret = process.env.LABEL_OS_FEED_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return 'antigravity-local-label-os-feed';
  throw new Error('LABEL_OS_FEED_TOKEN_SECRET is not configured');
}

/** The URL path+query a calendar app subscribes to. */
export function feedPath(orgId: string, token: string): string {
  return `/api/org/${orgId}/calendar.ics?token=${encodeURIComponent(token)}`;
}
