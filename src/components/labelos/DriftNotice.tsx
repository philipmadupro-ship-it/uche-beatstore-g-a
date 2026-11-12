'use client';

/**
 * "This sheet differs from its contract" (LABEL-59). One notice for both the
 * contract page and the song's splits view. A reader with `rights.read` gets
 * who and the two numbers; anyone else only the sentence (D2: the server sends
 * them nothing more, and this draws exactly what it was sent).
 */
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import type { DriftEntry } from '@/lib/labelos/contract-splits-client';
import { SPLIT_KIND_LABEL } from '@/lib/labelos/splits';

export function DriftNotice({
  entry,
  against,
  href,
}: {
  entry: DriftEntry;
  /** What it differs from, in words: `its contract “Title”` or `the sheet in force`. */
  against: string;
  /** Where to look at the other document, when the reader can open it. */
  href?: string;
}) {
  if (!entry.drifted) return null;
  return (
    <div role="status" className="rounded-xl border border-[#c8a47a]/40 bg-[#c8a47a]/10 p-3 text-[11px] text-white/80" data-testid={`drift-${entry.kind}`}>
      <p className="flex items-start gap-2">
        <TriangleAlert size={13} className="mt-px shrink-0 text-[#c8a47a]" aria-hidden="true" />
        <span>
          The {SPLIT_KIND_LABEL[entry.kind].toLowerCase()} split sheet in force differs from {against}.
          {href && (
            <>
              {' '}
              <Link href={href} className="underline">Open it</Link>
            </>
          )}
        </span>
      </p>
      {entry.items && entry.items.length > 0 && (
        <ul className="mt-2 space-y-0.5 pl-5 text-white/60" data-testid={`drift-${entry.kind}-items`}>
          {entry.items.map((i) => (
            <li key={i.partyId}>
              {i.name}: contract {i.contract}%, {i.sheet === null ? 'not on the sheet' : `sheet ${i.sheet}%`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
