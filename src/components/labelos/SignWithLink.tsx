'use client';

/**
 * The page behind a signing link (LABEL-60). Standalone, no org chrome: the
 * signer reads the contract, types (and may draw) their name, and signs for
 * THEIR party. After signing they keep a receipt on the same page. A link that
 * is wrong, revoked, expired or for a voided contract is one plain message —
 * the page cannot tell them which, by design.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { loadPublicSigning, signWithLink, type PublicSigningPayload } from '@/lib/labelos/contract-signing-client';
import { SignatureInput } from './SignatureInput';
import { when } from './ContractSigningPanel';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

export function SignWithLink({ token }: { token: string }) {
  const [data, setData] = useState<PublicSigningPayload | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const res = await loadPublicSigning(token);
    if (!res.ok) {
      if (res.status === 404) setGone(true);
      else setError(res.error);
      return;
    }
    setError(null);
    setData(res);
  }, [token]);

  useEffect(() => {
    let live = true;
    void loadPublicSigning(token).then((res) => {
      if (!live) return;
      if (!res.ok) {
        if (res.status === 404) setGone(true);
        else setError(res.error);
        return;
      }
      setData(res);
    });
    return () => {
      live = false;
    };
  }, [token]);

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-[var(--background-primary)] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">{children}</div>
    </main>
  );

  if (gone) {
    return shell(
      <div className="rounded-xl border border-white/10 bg-[var(--surface-primary)] px-4 py-10 text-center" data-testid="sign-gone">
        <h1 className="font-heading text-[24px] text-white">This link does not work</h1>
        <p className="mt-2 text-[11px] text-white/60">It may have been replaced, revoked, or have expired, or the contract may have been withdrawn. Ask the person who sent it for a new one.</p>
      </div>,
    );
  }
  if (error && !data) return shell(<p role="alert" className="text-[11px] text-[#ff8b73]" data-testid="sign-error">{error}</p>);
  if (!data) return shell(<p className="text-[11px] text-white/40">Loading…</p>);

  const sign = async (input: { name: string; drawing?: string }) => {
    setBusy(true);
    setError(null);
    const res = await signWithLink(token, { version: data.contract.version, document_sha256: data.documentSha256, name: input.name, ...(input.drawing ? { drawing: input.drawing } : {}) });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      if (res.code === 'changed') await reload();
      return;
    }
    toast.success(res.completed ? 'Signed — every party has signed' : 'Signed');
    await reload();
  };

  return shell(
    <>
      <header className="space-y-2">
        <p className={LABEL}>{data.contract.typeLabel}</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight md:text-[32px]" data-testid="sign-title">{data.contract.title}</h1>
        <p className="text-[11px] text-white/60">You are signing as <strong className="text-white/80">{data.you.name}</strong> ({data.you.roleLabel}).</p>
        {data.parties.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-[11px] text-white/70">
            {data.parties.map((p, i) => <li key={`${p.roleLabel}-${i}`} className="rounded-md border border-white/10 px-2 py-0.5">{p.roleLabel}: {p.name}</li>)}
          </ul>
        )}
      </header>

      <article className="space-y-4 rounded-xl border border-white/10 bg-[var(--surface-primary)] p-4 sm:p-5" data-testid="sign-document">
        {data.clauses.map((c, i) => (
          <section key={c.id} className="space-y-1">
            <h2 className="text-[11px] font-semibold text-white/80">{i + 1}. {c.heading}</h2>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/70">{c.body}</p>
          </section>
        ))}
      </article>

      {data.state === 'signed' && data.receipt ? (
        <section className="space-y-2 rounded-xl border border-[#6DC6A4]/30 bg-[var(--surface-primary)] p-4" data-testid="sign-receipt">
          <p className="inline-flex items-center gap-1.5 text-[11px] text-[#6DC6A4]"><Check size={13} aria-hidden="true" />You signed this contract</p>
          <p className="text-[11px] text-white/60">{data.receipt.signerName ?? data.you.name} · {when(data.receipt.signedAt)}</p>
          <p className="break-all font-mono text-[10px] text-white/40">Text fingerprint (SHA-256): {data.receipt.documentSha256}</p>
          <p className="text-[11px] text-white/60">{data.completed ? 'Every party has now signed.' : 'The contract is complete once every party has signed.'}</p>
        </section>
      ) : data.canSign ? (
        <section className="space-y-3 rounded-xl border border-white/10 bg-[var(--surface-primary)] p-4" data-testid="sign-form">
          {data.state === 'stale' && <p className="text-[11px] text-[#c8a47a]">You signed an earlier text. This contract changed since, so please read it again and sign again.</p>}
          <SignatureInput busy={busy} label={data.you.name} confirmLabel="Sign this contract" defaultName={data.you.name} onSign={(i) => void sign(i)} testId="sign" />
          {error && <p role="alert" className="text-[11px] text-[#ff8b73]" data-testid="sign-error">{error}</p>}
        </section>
      ) : (
        <p className="rounded-xl border border-white/10 bg-[var(--surface-primary)] px-4 py-3 text-[11px] text-white/60" data-testid="sign-closed">This contract is not open for signing.</p>
      )}

      <footer className="space-y-1.5 text-[10px] leading-relaxed text-white/40">
        <p data-testid="sign-statement">{data.statement}</p>
        <p className="break-all font-mono">Text fingerprint (SHA-256): {data.documentSha256}</p>
        {data.providerUrl && <p>The label also lists an external e-signature for this contract: <a className="underline" href={data.providerUrl} target="_blank" rel="noopener noreferrer">{data.providerUrl}</a></p>}
      </footer>
    </>,
  );
}
