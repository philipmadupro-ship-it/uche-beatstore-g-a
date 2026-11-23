'use client';

import { useEffect, useState } from 'react';
import { agoLabel, type LinkActivity as Activity } from '@/lib/links/link-activity';
import type { ShareLinkSource } from '@/lib/links/share-link';

/**
 * The compact "what happened on this link" strip in the /links detail popup
 * (SHARE-06): Sent · Opened (people) · Played · Downloaded · last activity.
 *
 * "Opened" is the link's own counter — page loads, so a refresh counts. People,
 * plays and downloads come from the event log (mig 203); on a link older than
 * its first recorded event the hint says since when. Renders nothing while
 * loading, when the log is not set up yet, or when the request fails: this is
 * context, never the thing the popup is for.
 */
export function LinkActivity({ linkId, source }: { linkId: string; source: ShareLinkSource }) {
  const [activity, setActivity] = useState<Activity | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    setActivity(null);
    fetch(`/api/links/activity?links=${encodeURIComponent(`${source}:${linkId}`)}`, { signal: ctl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.schemaReady) setActivity(body.activity?.[`${source}:${linkId}`] ?? null);
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [linkId, source]);

  if (!activity) return null;

  const last = agoLabel(activity.lastActivityAt);
  const people = `${activity.people} ${activity.people === 1 ? 'person' : 'people'}`;
  const since = activity.since
    ? new Date(activity.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="mb-4" data-testid="link-activity">
      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">Activity</p>
      <p className="text-[11px] text-white/80 leading-relaxed">
        <span>Sent {activity.sends}</span>
        <span className="text-white/30"> · </span>
        <span>Opened {activity.opens} ({people})</span>
        <span className="text-white/30"> · </span>
        <span>Played {activity.plays}</span>
        <span className="text-white/30"> · </span>
        <span>Downloaded {activity.downloads}</span>
        {last && (
          <>
            <span className="text-white/30"> · </span>
            <span className="text-white/60">last {last}</span>
          </>
        )}
      </p>
      <p className="text-[10px] text-white/40 mt-1">
        Opens count page loads.
        {since ? ` People, plays and downloads are counted since ${since}.` : ''}
      </p>
    </div>
  );
}
