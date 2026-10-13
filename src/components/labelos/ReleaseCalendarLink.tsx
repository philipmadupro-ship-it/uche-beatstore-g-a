'use client';

/**
 * The member's own release-calendar link (LABEL-34): create it, copy it,
 * replace it (the old URL stops working) or switch it off. The link shows
 * only release titles and dates; anyone holding it can read them, which is
 * what "replace" and "turn off" are for. Mounted on the release page for `release.write`.
 */
import { useCallback, useState } from 'react';
import { toast } from '@/hooks/useToast';
import { copyToClipboard } from '@/lib/clipboard';
import { fetchCalendarLink, issueCalendarLink, revokeCalendarLink, type CalendarLink } from '@/lib/labelos/metadata-export-client';

const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

export function ReleaseCalendarLink({ orgId }: { orgId: string }) {
  const [link, setLink] = useState<CalendarLink | null>(null);
  const [busy, setBusy] = useState(false);

  /** Nothing is requested until the member asks: the page does not poll for a link nobody opened. */
  async function open() {
    setBusy(true);
    const res = await fetchCalendarLink(orgId);
    setBusy(false);
    if (!res.ok) return toast.error('Could not read the calendar link', res.error);
    setLink(res.active ? { active: true, path: res.path } : { active: false });
  }

  const change = useCallback(
    async (call: typeof issueCalendarLink, done: string) => {
      setBusy(true);
      const res = await call(orgId);
      setBusy(false);
      if (!res.ok) return toast.error('Could not change the calendar link', res.error);
      setLink(res.active ? { active: true, path: res.path } : { active: false });
      toast.success(done);
    },
    [orgId],
  );

  async function copy() {
    if (!link?.active) return;
    const ok = await copyToClipboard(`${window.location.origin}${link.path}`);
    if (ok) toast.success('Calendar link copied');
    else toast.error('Could not copy the link');
  }

  if (!link) {
    return (
      <button type="button" className={BTN} disabled={busy} onClick={() => void open()}>
        Calendar link
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Release calendar link">
      <span className={LABEL}>Release calendar</span>
      {link.active ? (
        <>
          <button type="button" className={BTN} disabled={busy} onClick={() => void copy()}>
            Copy link
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => void change(issueCalendarLink, 'New link created — the old one no longer works')}>
            Replace link
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => void change(revokeCalendarLink, 'Calendar link turned off')}>
            Turn off
          </button>
        </>
      ) : (
        <button type="button" className={BTN} disabled={busy} onClick={() => void change(issueCalendarLink, 'Calendar link created')}>
          Create calendar link
        </button>
      )}
    </div>
  );
}
