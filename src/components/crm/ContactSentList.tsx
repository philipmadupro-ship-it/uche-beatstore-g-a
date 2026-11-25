'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { BeatSend } from '@/lib/types';
import { loadTracksCached } from '@/lib/crm/tracks-cache';
import { recentSends, sendTitleText, summarizeSends } from '@/lib/contacts/row-model';
import { relativeDays } from './contacts-shared';

/**
 * "Sent to <name>": the three newest sends — what went out, whether it was
 * opened, when — with a link to the whole log filtered to this contact. The
 * contact page used to show sends only as timeline events and a count.
 */
export function ContactSentList({ contactId, contactName, sends }: { contactId: string; contactName: string; sends: BeatSend[] }) {
  const recent = useMemo(() => recentSends(sends, 3), [sends]);
  const [titles, setTitles] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    if (recent.length === 0) return;
    let alive = true;
    const want = new Set(recent.flatMap((s) => s.track_ids ?? []));
    void loadTracksCached().then((list) => {
      if (!alive) return;
      setTitles(new Map(list.filter((t) => want.has(t.id)).map((t) => [t.id, t.title ?? null])));
    });
    return () => { alive = false; };
  }, [recent]);

  return (
    <section aria-labelledby="sent-to-heading" data-testid="contact-sent-list" className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="sent-to-heading" className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Sent to {contactName.split(' ')[0]}</h2>
        {sends.length > 0 && (
          <Link
            href={`/contacts?tab=activity&contact=${contactId}`}
            aria-label={`View all ${sends.length} sends to ${contactName}`}
            className="text-[11px] text-white/60 transition-colors hover:text-white"
          >
            View all {sends.length}
          </Link>
        )}
      </div>
      {recent.length === 0 ? (
        <p className="text-[11px] text-white/40">Nothing sent yet.</p>
      ) : (
        <ul className="space-y-2">
          {recent.map((s) => {
            const sum = summarizeSends([s]);
            return (
              <li key={s.id} className="min-w-0">
                <p className="truncate text-[11px] text-white/80">{sendTitleText(s.track_ids, titles)}</p>
                <p className="truncate text-[11px] text-white/40">{[sum.outcomeLabel, relativeDays(s.sent_at)].join(' · ')}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
