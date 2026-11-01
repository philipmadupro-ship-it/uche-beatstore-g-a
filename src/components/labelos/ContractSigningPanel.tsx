'use client';

/**
 * Signatures on one contract (LABEL-60): where each party stands, signing for
 * the party the viewer may sign for, the signing links of external parties
 * (contracts staff), the address of an external e-signature, and replacing
 * the contract. Shown once a contract has left draft. The server decides
 * everything (who may sign, what a viewer sees — `GET …/signing`); this draws
 * it, and says plainly what an in-app signature is.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy, FileCheck2 } from 'lucide-react';
import { confirmToast, toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { SignerView, SigningView } from '@/lib/labelos/contract-signing-view';
import { issueSignerLink, loadSigning, revokeSignerLink, saveProviderUrl, signAsMember, supersedeContract } from '@/lib/labelos/contract-signing-client';
import { SignatureInput } from './SignatureInput';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] active:bg-white/[0.14] disabled:opacity-40';
const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none disabled:opacity-60';

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

export function StateChip({ status }: { status: SignerView['status'] }) {
  const text = status === 'signed' ? 'Signed' : status === 'stale' ? 'No longer counts' : 'Waiting';
  return (
    <span
      className={cn(
        'rounded-md border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em]',
        status === 'signed' ? 'border-[#6DC6A4]/40 text-[#6DC6A4]' : status === 'stale' ? 'border-[#c8a47a]/40 text-[#c8a47a]' : 'border-white/20 text-white/60',
      )}
      data-testid={`signer-state-${status}`}
    >
      {text}
    </span>
  );
}

export function ContractSigningPanel({ orgId, contractId, onChanged }: { orgId: string; contractId: string; onChanged?: () => void }) {
  const router = useRouter();
  const [view, setView] = useState<SigningView | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ partyId: string; url: string } | null>(null);
  const [provider, setProvider] = useState('');

  const reload = useCallback(async () => {
    const res = await loadSigning(orgId, contractId);
    if (!res.ok) return setFailed(res.error);
    setFailed(null);
    if ('schemaReady' in res && res.schemaReady === false) return setNotReady(true);
    const v = res as unknown as SigningView;
    setNotReady(false);
    setView(v);
    setProvider(v.providerUrl ?? '');
  }, [orgId, contractId]);

  useEffect(() => {
    let live = true;
    void loadSigning(orgId, contractId).then((res) => {
      if (!live) return;
      if (!res.ok) return setFailed(res.error);
      if ('schemaReady' in res && res.schemaReady === false) return setNotReady(true);
      const v = res as unknown as SigningView;
      setView(v);
      setProvider(v.providerUrl ?? '');
    });
    return () => {
      live = false;
    };
  }, [orgId, contractId]);

  if (failed) return <p role="alert" className="text-[11px] text-[#ff8b73]" data-testid="signing-failed">{failed}</p>;
  if (notReady) return <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-3 text-[11px] text-white/60" data-testid="signing-not-ready">Signing is not set up yet: the database migration for it (178) is not applied.</p>;
  if (!view) return <p className="text-[11px] text-white/40" data-testid="signing-loading">Loading the signatures…</p>;

  const { contract } = view;
  const sent = contract.status === 'sent';
  const absolute = (path: string) => `${window.location.origin}${path}`;

  const sign = async (partyId: string, input: { name: string; drawing?: string }) => {
    setBusy(`sign-${partyId}`);
    const res = await signAsMember(orgId, contractId, { party_id: partyId, version: contract.version, document_sha256: view.documentSha256, name: input.name, ...(input.drawing ? { drawing: input.drawing } : {}) });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.completed ? 'Signed — every party has signed' : 'Signed');
    setSigning(null);
    await reload();
    onChanged?.();
  };

  const makeLink = async (partyId: string) => {
    setBusy(`link-${partyId}`);
    const res = await issueSignerLink(orgId, contractId, partyId);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setIssued({ partyId, url: absolute(res.path) });
    await reload();
  };

  const revoke = async (partyId: string) => {
    const ok = await confirmToast('Revoke this signing link?', 'The link stops working at once.', { confirmLabel: 'Revoke', danger: true });
    if (!ok) return;
    setBusy(`link-${partyId}`);
    const res = await revokeSignerLink(orgId, contractId, partyId);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    if (issued?.partyId === partyId) setIssued(null);
    await reload();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copied');
    } catch {
      toast.error('Copy it from the box instead');
    }
  };

  const saveProvider = async () => {
    setBusy('provider');
    const res = await saveProviderUrl(orgId, contractId, provider.trim() === '' ? null : provider.trim());
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.url ? 'Address saved' : 'Address removed');
    await reload();
  };

  const supersede = async () => {
    const ok = await confirmToast('Replace this contract?', 'It is voided and a new draft copy is started. The signatures stay on this one as the record.', { confirmLabel: 'Replace', danger: true });
    if (!ok) return;
    setBusy('supersede');
    const res = await supersedeContract(orgId, contractId);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success('Replaced — the new draft is open');
    if (res.new_id) router.push(window.location.pathname.replace(/[^/]+\/?$/, res.new_id));
    else await reload();
  };

  const p = view.progress;
  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-[#0D0D0A] p-4 sm:p-5" aria-label="Signatures" data-testid="signing-panel">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className={LABEL}>Signatures</h2>
          <p className="mt-1 text-[11px] text-white/70" data-testid="signing-progress">
            {contract.status === 'void' ? 'This contract is void.' : p.complete ? 'Every party has signed.' : `${p.signed} of ${p.total} parties have signed${p.stale > 0 ? `, ${p.stale} signature${p.stale === 1 ? '' : 's'} no longer count${p.stale === 1 ? 's' : ''}` : ''}.`}
          </p>
        </div>
        <Link className={cn(BTN, 'inline-flex items-center gap-1.5')} href={`${contractId}/certificate`} data-testid="signing-certificate-link">
          <FileCheck2 size={11} aria-hidden="true" />Certificate
        </Link>
      </header>

      <p className="text-[10px] leading-relaxed text-white/40" data-testid="signing-statement">
        In-app signature: each signer types (or draws) their name here after reading the text. It is not a qualified electronic signature.
      </p>

      {sent && view.blocked && (
        <p role="status" className="rounded-lg border border-[#c8a47a]/30 bg-white/[0.04] px-3 py-2 text-[11px] text-[#c8a47a]" data-testid="signing-blocked">{view.blocked.error}</p>
      )}
      {view.signers.some((s) => s.status === 'stale') && contract.status !== 'void' && (
        <p role="status" className="rounded-lg border border-[#c8a47a]/30 bg-white/[0.04] px-3 py-2 text-[11px] text-[#c8a47a]" data-testid="signing-stale-note">
          Some signatures were made against a different copy than the one this contract was sent with, so they no longer count. The contract can be replaced with a new draft.
        </p>
      )}

      <ul className="space-y-3">
        {view.signers.map((s) => (
          <li key={s.partyId} className="space-y-2 rounded-lg border border-white/10 p-3" data-testid={`signer-${s.partyId}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] text-white/80">{s.name}</p>
                <p className="text-[10px] text-white/40">{s.roleLabel}</p>
              </div>
              <StateChip status={s.status} />
            </div>
            {s.signature && (
              <p className="text-[10px] text-white/50" data-testid={`signer-receipt-${s.partyId}`}>
                {s.signature.signerName} · {when(s.signature.signedAt)} · {s.signature.method === 'drawn' ? 'typed and drawn' : 'typed'}{s.signature.via === 'link' ? ' · through a link' : s.signature.countersign ? ' · countersigned for the label' : ''}
                {s.status === 'stale' ? ' · signed an earlier text' : ''}
              </p>
            )}

            {sent && s.status !== 'signed' && view.youCanSignFor.includes(s.partyId) && (
              signing === s.partyId ? (
                <SignatureInput busy={busy === `sign-${s.partyId}`} label={s.name} confirmLabel={`Sign as ${s.name}`} onSign={(i) => void sign(s.partyId, i)} testId={`sign-${s.partyId}`} />
              ) : (
                <button type="button" className={BTN} onClick={() => setSigning(s.partyId)} data-testid={`sign-open-${s.partyId}`}>Sign as {s.name}</button>
              )
            )}

            {sent && view.canManage && s.status !== 'signed' && s.link && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={BTN} disabled={busy === `link-${s.partyId}`} onClick={() => void makeLink(s.partyId)} data-testid={`link-issue-${s.partyId}`}>
                    {s.link.active ? 'Make a new signing link' : 'Make a signing link'}
                  </button>
                  {s.link.active && <button type="button" className={BTN} onClick={() => void revoke(s.partyId)} data-testid={`link-revoke-${s.partyId}`}>Revoke link</button>}
                  {s.link.active && s.link.expiresAt && <span className="text-[10px] text-white/40">Works until {when(s.link.expiresAt)}</span>}
                </div>
                {issued?.partyId === s.partyId && (
                  <div className="space-y-1.5" data-testid="link-issued">
                    <p className="text-[10px] text-white/50">Send this to {s.name}. It is shown once — make a new one if it is lost.</p>
                    <div className="flex gap-2">
                      <input readOnly className={FIELD} value={issued.url} onFocus={(e) => e.currentTarget.select()} aria-label="Signing link" data-testid="link-issued-url" />
                      <button type="button" className={cn(BTN, 'inline-flex items-center gap-1.5')} onClick={() => void copy(issued.url)}><Copy size={11} aria-hidden="true" />Copy</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {view.canManage && contract.status !== 'void' && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <label className="block space-y-1.5">
            <span className={LABEL}>External e-signature address (optional)</span>
            <div className="flex gap-2">
              <input className={FIELD} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="https://…" inputMode="url" data-testid="signing-provider" />
              <button type="button" className={BTN} disabled={busy === 'provider' || provider.trim() === (view.providerUrl ?? '')} onClick={() => void saveProvider()} data-testid="signing-provider-save">Save</button>
            </div>
          </label>
          <p className="text-[10px] text-white/40">For a signature made at an e-signature provider instead. The app only keeps the address and shows it on the certificate; it does not connect to the provider.</p>
        </div>
      )}
      {!view.canManage && view.providerUrl && (
        <p className="text-[11px] text-white/60">External e-signature: <a className="underline" href={view.providerUrl} target="_blank" rel="noopener noreferrer">{view.providerUrl}</a></p>
      )}

      {view.canManage && (contract.status === 'sent' || contract.status === 'signed') && (
        <div className="border-t border-white/10 pt-4">
          <button type="button" className={BTN} disabled={busy === 'supersede'} onClick={() => void supersede()} data-testid="signing-supersede">Replace with a new draft</button>
        </div>
      )}
      {p.complete && <p className="inline-flex items-center gap-1.5 text-[11px] text-[#6DC6A4]"><Check size={12} aria-hidden="true" />Fully signed</p>}
    </section>
  );
}
