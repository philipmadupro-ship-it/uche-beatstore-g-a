'use client';

/**
 * The page behind a press link (LABEL-66). Standalone, no org chrome and no
 * way into the label's workspace. It renders exactly what /api/press/[token]
 * returns: before the embargo that is a title and a line saying more is coming;
 * after it, the one-sheet, the photos, the links and — only for released music
 * on the store — a player over the store's own streams. A link that is wrong,
 * revoked, expired or for a withdrawn release is one plain message.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Download, Printer } from 'lucide-react';
import { oneSheetText, type PublicPressView } from '@/lib/labelos/press';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

type Load = { state: 'loading' } | { state: 'gone' } | { state: 'failed' } | { state: 'ready'; view: PublicPressView };

export function PressKitPage({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/press/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setLoad({ state: 'gone' });
        if (!res.ok) return setLoad({ state: 'failed' });
        const body = (await res.json()) as { press?: PublicPressView };
        setLoad(body.press ? { state: 'ready', view: body.press } : { state: 'failed' });
      })
      .catch(() => live && setLoad({ state: 'failed' }));
    return () => {
      live = false;
    };
  }, [token]);

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-[#090907] px-4 py-8 text-white sm:px-6 print:bg-white print:text-black">
      <div className="mx-auto max-w-3xl space-y-8">{children}</div>
    </main>
  );

  if (load.state === 'loading') return shell(<p className="text-[11px] text-white/40">Loading…</p>);
  if (load.state === 'gone') {
    return shell(
      <div className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-10 text-center" data-testid="press-gone">
        <h1 className="font-heading text-[24px] text-white">This link does not work</h1>
        <p className="mt-2 text-[11px] text-white/60">It may have been revoked or have expired. Ask the person who sent it for a new one.</p>
      </div>,
    );
  }
  if (load.state === 'failed') return shell(<p role="alert" className="text-[11px] text-[#ff8b73]" data-testid="press-error">The press kit could not be loaded. Try again in a moment.</p>);

  const v = load.view;

  if (v.state === 'embargoed') {
    return shell(
      <div data-testid="press-embargoed" className="space-y-6">
        <header>
          {v.artist && <p className={`mb-2 ${LABEL}`}>{v.artist}</p>}
          <h1 className="font-heading text-[32px] font-bold leading-[1.05] tracking-tight text-white md:text-[40px]">{v.title}</h1>
          <p className="mt-3 text-[13px] text-white/70">{v.note ?? 'Coming soon.'}</p>
        </header>
        <Photos photos={v.photos} />
      </div>,
    );
  }

  const copyOneSheet = async () => {
    try {
      await navigator.clipboard.writeText(oneSheetText(v));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked; the text is on the page anyway */
    }
  };

  return shell(
    <div data-testid="press-live" className="space-y-8">
      <header>
        {v.artist && <p className={`mb-2 ${LABEL}`}>{v.artist}</p>}
        <h1 className="font-heading text-[32px] font-bold leading-[1.05] tracking-tight text-white md:text-[40px]">{v.title}</h1>
        <p className={`mt-3 ${LABEL}`}>
          {[v.type, v.label, v.genre, v.releaseDate ? (v.released ? `Out ${v.releaseDate}` : `Out ${v.releaseDate}`) : null].filter(Boolean).join(' · ')}
        </p>
        {v.headline && <p className="mt-4 text-[13px] leading-relaxed text-white/80">{v.headline}</p>}
        <div className="mt-4 flex flex-wrap gap-2 print:hidden">
          <button type="button" onClick={copyOneSheet} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]">
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copied' : 'Copy one-sheet'}
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]">
            <Printer size={14} aria-hidden /> Print
          </button>
        </div>
      </header>

      {v.bio && (
        <section>
          <h2 className={`mb-2 ${LABEL}`}>Bio</h2>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-white/70">{v.bio}</p>
        </section>
      )}

      {v.listen && (
        <section data-testid="press-listen">
          <h2 className={`mb-2 ${LABEL}`}>Listen</h2>
          <ul className="space-y-2">
            {v.listen.tracks.map((t) => (
              <li key={t.id} className="rounded-xl border border-white/10 bg-[#0D0D0A] p-3">
                <p className="mb-2 text-[11px] text-white/80">{t.title}</p>
                <audio controls preload="none" src={t.audioUrl} className="w-full" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.tracklist.length > 0 && (
        <section>
          <h2 className={`mb-2 ${LABEL}`}>Tracklist</h2>
          <ol className="divide-y divide-white/10 rounded-xl border border-white/10 bg-[#0D0D0A]">
            {v.tracklist.map((t) => (
              <li key={t.position} className="flex items-baseline gap-3 px-3 py-2 text-[11px] text-white/80">
                <span className="w-5 font-mono text-[10px] text-white/40">{t.position}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {t.explicit && <span className={LABEL}>Explicit</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <Photos photos={v.photos} />

      {v.links.length > 0 && (
        <section>
          <h2 className={`mb-2 ${LABEL}`}>Links</h2>
          <ul className="space-y-1">
            {v.links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[11px] text-white/80 underline decoration-white/20 underline-offset-4 hover:decoration-white/60">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>,
  );
}

function Photos({ photos }: { photos: { id: string; url: string; caption: string | null }[] }) {
  if (photos.length === 0) return null;
  return (
    <section data-testid="press-photos">
      <h2 className={`mb-2 ${LABEL}`}>Photos</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0A]">
            {/* eslint-disable-next-line @next/next/no-img-element -- streamed through the token-gated route; no optimiser may fetch it */}
            <img src={p.url} alt={p.caption ?? 'Press photo'} loading="lazy" className="aspect-square w-full object-cover" />
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 print:hidden">
              <span className="min-w-0 truncate text-[10px] text-white/60">{p.caption ?? ''}</span>
              <a href={p.url} download aria-label="Download photo" className="text-white/60 hover:text-white">
                <Download size={14} aria-hidden />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
