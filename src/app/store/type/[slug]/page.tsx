import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAppUrl } from '@/lib/env';
import { loadStoreCatalogue } from '@/lib/store/discovery-catalogue';
import { findTermBySlug, trackMatchesTerm, discoveryMetadata } from '@/lib/store/discovery';

/**
 * Discovery landing page — `/store/type/dark-type-beat`.
 *
 * The store had exactly one indexable page, so the only people who reached it
 * were people who were sent a link. These pages answer the searches buyers
 * actually make ("dark trap type beat", "140 bpm beats") using tags the
 * producer already applies, and each one is a genuine entry point into the
 * catalogue.
 *
 * A SERVER component on purpose. The rest of the store is client-rendered,
 * which is fine for an app but means crawlers see an empty shell. The whole
 * value here is that the track list is in the HTML.
 */

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

/** Pre-render every term the catalogue supports. */
export async function generateStaticParams() {
  const { terms } = await loadStoreCatalogue();
  return terms.map((term) => ({ slug: term.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { terms, producerName } = await loadStoreCatalogue();
  const term = findTermBySlug(terms, slug);
  if (!term) return { title: 'Not found' };

  const { title, description } = discoveryMetadata(term, producerName);
  const url = `${getAppUrl()}/store/type/${term.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function DiscoveryPage({ params }: Props) {
  const { slug } = await params;
  const { tracks, terms, producerName } = await loadStoreCatalogue();
  const term = findTermBySlug(terms, slug);

  // 404 rather than render an empty page: a term only exists when enough
  // tracks match it, so an unknown slug means there is genuinely nothing here.
  if (!term) notFound();

  const matches = tracks.filter((t) => trackMatchesTerm(t, term));
  const related = terms.filter((t) => t.slug !== term.slug).slice(0, 8);

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8">
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link
          href="/store"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 transition-colors hover:text-white/70"
        >
          ← All beats
        </Link>
      </nav>

      <header className="mb-10">
        <h1 className="text-[32px] font-semibold leading-tight text-white sm:text-[40px]">
          {term.label}
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/50">
          {matches.length} {matches.length === 1 ? 'beat' : 'beats'} by {producerName}.
          Stream free, then license instantly for streaming, video and commercial release.
        </p>
      </header>

      {/* Real anchors, not a client-side list: the point of this page is that a
          crawler can follow every link without running JavaScript. */}
      <ul className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
        {matches.map((track) => (
          <li key={track.id}>
            <Link
              href={`/store/${track.id}`}
              className="flex items-center justify-between gap-4 py-3.5 transition-colors hover:bg-white/[0.03]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] text-white/90">{track.title}</span>
                <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                  {[track.bpm ? `${track.bpm} BPM` : null, track.type].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[#D4BFA0]">
                Listen
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {related.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            Browse more
          </h2>
          {/* Internal links: these are how a crawler reaches the rest of the
              catalogue, and how a visitor who nearly found what they wanted
              gets a second chance. */}
          <div className="flex flex-wrap gap-2">
            {related.map((other) => (
              <Link
                key={other.slug}
                href={`/store/type/${other.slug}`}
                className="rounded-full border border-white/[0.08] px-3 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/20 hover:text-white"
              >
                {other.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
