import Link from 'next/link';

/**
 * /invite/<token> — retired (LABEL-40).
 *
 * The old team invite flow granted nothing and has been removed. Its tokens
 * are not compatible with the Label OS invitations at /join/<token>, so there
 * is nothing to redirect to: say the link is dead and where a new one comes
 * from. The page reads no token and touches no table.
 */
export default function RetiredInvitePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090907] px-6">
      <div className="w-full max-w-md rounded-[20px] border border-white/10 bg-[#0D0D0A] p-10 text-center">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Invitation</p>
        <h1 className="font-heading text-2xl text-white/80">This invite has expired</h1>
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          Ask for a new one. Invitations now arrive as a fresh link, and links from the old
          system no longer work.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
        >
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
