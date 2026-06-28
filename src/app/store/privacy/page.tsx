import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy — Beat Store',
  description: 'How this beat store collects, uses, and protects buyer data.',
};

// Static, public-by-design. Plain server component — no buyer data touched.
const UPDATED = 'June 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[12px] font-mono uppercase tracking-[0.2em] text-[#D0C3AF] mb-3">{title}</h2>
      <div className="space-y-3 text-[14px] leading-relaxed text-[#B4AA99]">{children}</div>
    </section>
  );
}

export default function StorePrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">
      <div className="max-w-[760px] mx-auto px-5 md:px-8 py-12">
        <Link
          href="/store"
          className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.2em] text-[#837B6D] hover:text-[#D0C3AF] transition-colors"
        >
          <ArrowLeft size={13} /> Back to store
        </Link>

        <h1 className="font-heading text-[34px] md:text-[40px] mt-6 leading-tight">Privacy Policy</h1>
        <p className="mt-2 text-[12px] font-mono uppercase tracking-[0.2em] text-[#6E685B]">Last updated · {UPDATED}</p>

        <p className="mt-6 text-[14px] leading-relaxed text-[#B4AA99]">
          This is a single-producer beat store. You can browse and preview without an account; we only
          collect what we need to sell you a license and deliver your files.
        </p>

        <Section title="What we collect">
          <ul className="list-disc pl-5 space-y-2">
            <li><strong className="text-[#D0C3AF]">Email address</strong> — captured at checkout so we can send your receipt and download links. It is the only identifier we store for a buyer.</li>
            <li><strong className="text-[#D0C3AF]">Payment details</strong> — handled entirely by Stripe. We never see or store your full card number; we keep a Stripe session/customer reference and the amount.</li>
            <li><strong className="text-[#D0C3AF]">Purchase records</strong> — which license you bought, when, and for how much (needed for delivery, re-downloads, and our accounting).</li>
            <li><strong className="text-[#D0C3AF]">Anonymous usage events</strong> — page/preview/cart/checkout signals tied to a random session id (not your identity) so the producer can understand what resonates.</li>
          </ul>
        </Section>

        <Section title="What stays on your device">
          <p>
            Your cart, wishlist/favorites, and a random analytics session id live in your browser&apos;s
            local storage — not on our servers. Clearing your browser storage removes them. We do not
            use third-party advertising or cross-site tracking cookies.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p>We use a small set of processors purely to run the store, never to sell your data:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong className="text-[#D0C3AF]">Stripe</strong> — payment processing.</li>
            <li><strong className="text-[#D0C3AF]">Resend</strong> — sending your receipt and delivery emails.</li>
            <li><strong className="text-[#D0C3AF]">Cloudflare R2</strong> — hosting audio files and your purchased downloads.</li>
            <li><strong className="text-[#D0C3AF]">Supabase</strong> — our database for purchase records.</li>
          </ul>
        </Section>

        <Section title="How long we keep it">
          <p>
            Purchase records are retained as long as needed for delivery, re-downloads, and legal/tax
            obligations. On request we anonymise the personal parts (your email and payment reference)
            while keeping the non-identifying transaction record required for accounting.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            You can request access to, or deletion of, your personal data at any time. The simplest way
            is to <strong className="text-[#D0C3AF]">reply to your purchase receipt email</strong> (or use
            the contact option on the store) and ask to be forgotten. We will anonymise your email and
            payment reference across our records.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy or your data? Reach out through the store&apos;s contact option or
            reply to any email you received from us.
          </p>
        </Section>

        <div className="mt-12 border-t border-[#2B2821] pt-6">
          <Link
            href="/store"
            className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#837B6D] hover:text-[#D0C3AF] transition-colors"
          >
            ← Back to store
          </Link>
        </div>
      </div>
    </div>
  );
}
