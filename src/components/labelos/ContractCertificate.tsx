'use client';

/**
 * The signature certificate of one contract (LABEL-60): who signed, when, how,
 * and against which text (its SHA-256). It says plainly what it is — an in-app
 * signature, not a qualified electronic signature — and carries the address of
 * an external e-signature when the label recorded one. Read from
 * `GET …/signing`, so a viewer sees exactly what they may: no internal note,
 * no address hash, no image reference. Printable (the controls drop out).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SigningView } from '@/lib/labelos/contract-signing-view';
import { loadSigning, signatureImageUrl } from '@/lib/labelos/contract-signing-client';
import { StateChip, when } from './ContractSigningPanel';
import { StatusBadge } from './ContractsView';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] active:bg-white/[0.14] disabled:opacity-40';

export function ContractCertificate({ orgId, contractId }: { orgId: string; contractId: string }) {
  const [view, setView] = useState<SigningView | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadSigning(orgId, contractId).then((res) => {
      if (!live) return;
      if (!res.ok) return setFailed(res.status === 404 ? 'This contract does not exist, or it is not yours to read.' : res.error);
      if ('schemaReady' in res && res.schemaReady === false) return setNotReady(true);
      setView(res as unknown as SigningView);
    });
    return () => {
      live = false;
    };
  }, [orgId, contractId]);

  if (failed) return <p role="alert" className="text-[11px] text-[#ff8b73]" data-testid="certificate-failed">{failed}</p>;
  if (notReady) return <p className="text-[11px] text-white/60" data-testid="certificate-not-ready">Signing is not set up yet: the database migration for it (178) is not applied.</p>;
  if (!view) return <p className="text-[11px] text-white/40">Loading the certificate…</p>;

  const { contract } = view;
  const signed = view.signers.filter((s) => s.status === 'signed').length;
  return (
    <article className="max-w-3xl space-y-6" data-testid="certificate">
      <header className="space-y-2">
        <Link className="text-[10px] text-white/50 underline print:hidden" href={`../${contractId}`}>Back to the contract</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white md:text-[32px]" data-testid="certificate-title">Signature certificate</h1>
          <StatusBadge status={contract.status as 'draft' | 'sent' | 'signed' | 'void'} />
        </div>
        <p className="text-[11px] text-white/70">{contract.title}</p>
        <p className="text-[10px] text-white/40">{contract.typeLabel} · version {contract.version}</p>
      </header>

      <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-3 text-[11px] leading-relaxed text-white/70" data-testid="certificate-statement">{view.statement}</p>

      <section className="space-y-1.5" aria-label="Document">
        <h2 className={LABEL}>The text that was signed</h2>
        <p className="text-[10px] text-white/40">SHA-256 of the contract as it reads now</p>
        <p className="break-all rounded-lg border border-white/10 bg-[#090907] px-3 py-2 font-mono text-[10px] text-white/70" data-testid="certificate-hash">{view.documentSha256}</p>
      </section>

      <section className="space-y-3" aria-label="Signers">
        <h2 className={LABEL}>Signers · {signed} of {view.signers.length}</h2>
        <ul className="space-y-3">
          {view.signers.map((s) => (
            <li key={s.partyId} className="space-y-1.5 rounded-xl border border-white/10 bg-[#0D0D0A] p-4" data-testid={`certificate-signer-${s.partyId}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-white/80">{s.name} <span className="text-white/40">· {s.roleLabel}</span></p>
                <StateChip status={s.status} />
              </div>
              {s.signature ? (
                <dl className="grid gap-x-4 gap-y-1 text-[11px] text-white/60 sm:grid-cols-[auto_1fr]">
                  <dt className="text-white/40">Signed as</dt><dd>{s.signature.signerName}</dd>
                  <dt className="text-white/40">When</dt><dd>{when(s.signature.signedAt)}</dd>
                  <dt className="text-white/40">How</dt><dd>{s.signature.method === 'drawn' ? 'Typed name and drawn signature' : 'Typed name'}{s.signature.via === 'link' ? ', through a signing link' : s.signature.countersign ? ', countersigned for the label' : ', signed in the app'}</dd>
                  <dt className="text-white/40">Contract version</dt><dd>{s.signature.contractVersion}</dd>
                  <dt className="text-white/40">Text signed</dt>
                  <dd className="break-all font-mono text-[10px]">
                    {s.signature.documentSha256}
                    {s.status === 'stale' && <span className="ml-1 font-sans text-[#c8a47a]">(not the current text)</span>}
                  </dd>
                </dl>
              ) : (
                <p className="text-[11px] text-white/50">Not signed yet.</p>
              )}
              {s.signature?.hasImage && (
                // eslint-disable-next-line @next/next/no-img-element -- a private, per-request image: next/image would cache and proxy it
                <img src={signatureImageUrl(orgId, contractId, s.signature.id)} alt={`Drawn signature of ${s.signature.signerName}`} className={cn('h-20 w-auto rounded-md border border-white/10 bg-white')} data-testid={`certificate-image-${s.partyId}`} />
              )}
            </li>
          ))}
        </ul>
      </section>

      {view.history.length > view.signers.length && (
        <section className="space-y-2" aria-label="Earlier signatures">
          <h2 className={LABEL}>Every signature on record</h2>
          <ul className="space-y-1 text-[11px] text-white/60" data-testid="certificate-history">
            {view.history.map((h) => (
              <li key={h.id}>{when(h.signedAt)} · {h.name} · version {h.contractVersion} · {h.current ? 'current text' : 'an earlier text'}</li>
            ))}
          </ul>
        </section>
      )}

      {view.providerUrl && (
        <section className="space-y-1" aria-label="External e-signature">
          <h2 className={LABEL}>External e-signature</h2>
          <p className="text-[11px] text-white/70"><a className="break-all underline" href={view.providerUrl} target="_blank" rel="noopener noreferrer" data-testid="certificate-provider">{view.providerUrl}</a></p>
        </section>
      )}

      <div className="print:hidden">
        <button type="button" className={cn(BTN, 'inline-flex items-center gap-1.5')} onClick={() => window.print()}><Printer size={11} aria-hidden="true" />Print</button>
      </div>
    </article>
  );
}
