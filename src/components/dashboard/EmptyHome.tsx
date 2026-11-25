'use client';

import { Upload } from 'lucide-react';

/** A brand-new workspace: one clear first step instead of a blank page. */
export function EmptyHome({ onUpload }: { onUpload: () => void }) {
  return (
    <section data-testid="empty-home" className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-5 py-6 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Your library is empty</p>
      <p className="mx-auto mt-2 max-w-sm text-[11px] text-white/60">
        Upload your first beat. BPM and key are read from the file, and you can tag and price it once it lands.
      </p>
      <button
        type="button"
        onClick={onUpload}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-[11px] font-semibold text-white transition-colors hover:border-white/20 hover:bg-white/[0.10] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <Upload size={13} aria-hidden /> Upload your first beat
      </button>
    </section>
  );
}
