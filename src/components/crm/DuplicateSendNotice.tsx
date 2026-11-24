'use client';

import { useEffect, useMemo, useState } from 'react';
import { History, Undo2 } from 'lucide-react';
import {
  describeEarlierSend,
  recipientKey,
  type RecipientRef,
  type ShareActivity,
} from '@/lib/crm/duplicate-sends';

/** One recipient the check reports, as `POST /api/beat_sends/duplicates` returns it. */
export interface DuplicateRow {
  key: string;
  tracks: { id: string; title: string }[];
  last_sent_at: string;
  email_opened: boolean;
  link_clicked: boolean;
  activity: ShareActivity | null;
}

/**
 * Asks which recipients already have what is about to go out. A warning only:
 * a failed or slow check is silence, never a blocked send.
 */
export function useDuplicateSends(input: { recipients: RecipientRef[]; trackIds: string[]; projectId?: string | null }): DuplicateRow[] {
  const [rows, setRows] = useState<DuplicateRow[]>([]);
  const { recipients, trackIds, projectId } = input;
  const signature = useMemo(
    () => JSON.stringify([recipients.map(recipientKey).filter(Boolean).sort(), [...trackIds].sort(), projectId ?? null]),
    [recipients, trackIds, projectId],
  );

  useEffect(() => {
    const refs = recipients.filter((r) => recipientKey(r)).slice(0, 200);
    if (refs.length === 0 || (trackIds.length === 0 && !projectId)) {
      setRows([]);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/beat_sends/duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipients: refs,
            ...(trackIds.length > 0 ? { track_ids: trackIds.slice(0, 500) } : {}),
            ...(projectId ? { project_id: projectId } : {}),
          }),
          signal: ctl.signal,
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        setRows(Array.isArray(data?.duplicates) ? data.duplicates : []);
      } catch {
        if (!ctl.signal.aborted) setRows([]);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // `signature` stands for the inputs; the arrays are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return rows;
}

interface DuplicateSendNoticeProps {
  rows: DuplicateRow[];
  /** recipient key → display name. */
  names: Record<string, string>;
  /** recipient key → tracks dropped for them. */
  removed: Record<string, string[]>;
  skipped: ReadonlySet<string>;
  /** More than one recipient: offers "Skip recipients who have them". */
  bulk: boolean;
  /** A project goes out whole, so its tracks cannot be dropped one by one. */
  canRemoveTracks: boolean;
  onRemoveTracks: (key: string, trackIds: string[]) => void;
  onSkip: (keys: string[]) => void;
  onUndo: (key: string) => void;
  now?: number;
}

const SHOWN_TITLES = 3;

function titleList(titles: string[]): string {
  const shown = titles.slice(0, SHOWN_TITLES).join(', ');
  return titles.length > SHOWN_TITLES ? `${shown} +${titles.length - SHOWN_TITLES} more` : shown;
}

const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-white/60 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30';

export function DuplicateSendNotice({ rows, names, removed, skipped, bulk, canRemoveTracks, onRemoveTracks, onSkip, onUndo, now }: DuplicateSendNoticeProps) {
  if (rows.length === 0) return null;
  const open = rows.filter((r) => !skipped.has(r.key) && !(removed[r.key]?.length));

  return (
    <section
      aria-label="Already sent"
      className="border-b border-white/10 px-4 py-3 sm:px-8"
    >
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const name = names[row.key] || row.key;
            const titles = row.tracks.map((t) => t.title || 'Untitled');
            const when = describeEarlierSend(
              { lastSentAt: row.last_sent_at, outcome: { emailOpened: row.email_opened, linkClicked: row.link_clicked, activity: row.activity } },
              now,
            );
            const dropped = removed[row.key] ?? [];
            const isSkipped = skipped.has(row.key);
            const droppedTitles = row.tracks.filter((t) => dropped.includes(t.id)).map((t) => t.title || 'Untitled');
            return (
              <li key={row.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <p className="flex min-w-0 items-start gap-2 text-[11px] leading-5 text-white/60">
                  <History size={13} aria-hidden className="mt-1 shrink-0 text-[var(--warning)]" />
                  <span className="min-w-0">
                    {isSkipped ? (
                      <>Skipping <span className="text-white/80">{name}</span>: {titleList(titles)} already sent.</>
                    ) : droppedTitles.length > 0 ? (
                      <>Leaving {titleList(droppedTitles)} out for <span className="text-white/80">{name}</span>.</>
                    ) : (
                      <>
                        Already sent to <span className="text-white/80">{name}</span>: {titleList(titles)}{' '}
                        <span className="text-white/40">({when})</span>
                      </>
                    )}
                  </span>
                </p>
                <div className="flex shrink-0 gap-1.5 pl-5 sm:pl-0">
                  {isSkipped || droppedTitles.length > 0 ? (
                    <button type="button" className={BTN} onClick={() => onUndo(row.key)}>
                      <Undo2 size={10} aria-hidden className="mr-1 inline" />Undo
                    </button>
                  ) : canRemoveTracks ? (
                    <button type="button" className={BTN} onClick={() => onRemoveTracks(row.key, row.tracks.map((t) => t.id))}>
                      Remove these tracks
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-5 text-[11px] text-white/40">
          <span>You can still send. This is only a heads-up.</span>
          {bulk && open.length > 0 && (
            <button type="button" className={BTN} onClick={() => onSkip(open.map((r) => r.key))}>
              Skip recipients who have them
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
