/**
 * The daily digest cron's rule for one artist (artist_portals.auto_digest).
 *
 * The cron is the producer's Notify button pressed once a day on their
 * behalf, so it sends only when Notify would have something to say, and at
 * most once per day however the day went: if the producer pressed Notify
 * themselves in the last `minGapHours`, the artist has just had an email and
 * the rest waits for tomorrow. Re-running the cron is safe — a digest moves
 * `last_notified_at`, which is what both rules read.
 */

export const AUTO_DIGEST_MIN_GAP_HOURS = 20;

export function autoDigestDue(input: {
  unnotified: number;
  /** project_contacts.last_notified_at across the artist's portal projects. */
  lastNotifiedAt: ReadonlyArray<string | null>;
  now: Date;
  minGapHours?: number;
}): boolean {
  if (input.unnotified <= 0) return false;
  const gap = (input.minGapHours ?? AUTO_DIGEST_MIN_GAP_HOURS) * 3_600_000;
  const latest = input.lastNotifiedAt
    .filter((v): v is string => !!v && Number.isFinite(Date.parse(v)))
    .reduce<number | null>((max, v) => Math.max(max ?? 0, Date.parse(v)), null);
  return latest === null || input.now.getTime() - latest >= gap;
}
