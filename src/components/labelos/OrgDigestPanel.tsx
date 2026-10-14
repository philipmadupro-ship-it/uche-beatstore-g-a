'use client';

/**
 * Weekly digest settings for one organization (LABEL-38), at
 * `/o/<slug>/settings/digest`. Two parts:
 *
 *  - every member: a switch for their OWN weekly email (opt-in, off by
 *    default). What it holds is built for them through their own access, so
 *    the switch says so;
 *  - owner / admin (`org.manage`): the Slack incoming-webhook URL. The field
 *    is write-only — the server never sends the URL back, so the panel only
 *    knows whether one is saved, and typing a new one replaces it.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { confirmToast, toast } from '@/hooks/useToast';
import { fetchDigest, removeSlackWebhook, saveSlackWebhook, setDigestEnabled, type DigestState } from '@/lib/labelos/digest-client';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-5 sm:p-6';

export function OrgDigestPanel({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [state, setState] = useState<DigestState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    let alive = true;
    void fetchDigest(orgId).then((res) => {
      if (!alive) return;
      if (!res.ok) return setError(res.error);
      setError(null);
      setState(res);
    });
    return () => {
      alive = false;
    };
  }, [orgId]);

  async function toggle(next: boolean) {
    setBusy(true);
    const res = await setDigestEnabled(orgId, next);
    setBusy(false);
    if (!res.ok) return toast.error('Could not save', res.error);
    setState((s) => (s ? { ...s, enabled: res.enabled } : s));
    toast.success(next ? 'Weekly digest on' : 'Weekly digest off');
  }

  async function saveUrl() {
    setBusy(true);
    const res = await saveSlackWebhook(orgId, url);
    setBusy(false);
    if (!res.ok) return toast.error('Could not save the webhook', res.error);
    setUrl('');
    setState((s) => (s ? { ...s, channelConfigured: true, needsReset: false } : s));
    toast.success('Slack webhook saved');
  }

  async function removeUrl() {
    if (!(await confirmToast('Remove the Slack webhook?', 'The weekly digest stops posting to Slack.', { confirmLabel: 'Remove', danger: true }))) return;
    setBusy(true);
    const res = await removeSlackWebhook(orgId);
    setBusy(false);
    if (!res.ok) return toast.error('Could not remove the webhook', res.error);
    setState((s) => (s ? { ...s, channelConfigured: false, needsReset: false } : s));
    toast.success('Slack webhook removed');
  }

  if (error) return <p role="alert" className="text-[11px] text-white/70">{error}</p>;
  if (!state) return <p className="text-[11px] text-white/60">Loading…</p>;
  if (!state.schemaReady) return <p className="text-[11px] text-white/70">The weekly digest is not available on this server yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD} aria-labelledby="digest-me">
        <p id="digest-me" className={LABEL}>Your digest</p>
        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <Checkbox checked={state.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} aria-label="Email me the weekly digest" />
          <span>
            <span className="block text-[13px] text-white/80">Email me a weekly digest</span>
            <span className="mt-1 block max-w-xl text-[11px] leading-relaxed text-white/60">
              Once a week, what needs attention in {orgName} and what changed. It only lists what you can already open there. Nothing is sent when there is nothing to say.
            </span>
          </span>
        </label>
      </section>

      {state.canManage && (
        <section className={CARD} aria-labelledby="digest-slack">
          <p id="digest-slack" className={LABEL}>Slack</p>
          <p className="mt-3 max-w-xl text-[11px] leading-relaxed text-white/60">
            Post the digest to a Slack channel with an incoming webhook. It is built from the view of an owner or admin who has switched the digest on, so it can name anything they can see. The URL is stored encrypted and is never shown again.
          </p>
          <p className="mt-3 text-[11px] text-white/70" data-testid="slack-status">
            {state.channelConfigured ? 'A webhook is saved.' : 'No webhook is saved.'}
          </p>
          {state.needsReset && (
            <p role="alert" className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70" data-testid="slack-reset">
              The saved webhook can no longer be opened by this server (its key changed). Nothing is being posted. Paste the webhook again to fix it.
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              aria-label="Slack webhook URL"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] text-white/80 placeholder:text-white/30 focus:border-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            />
            <Button variant="secondary" size="sm" disabled={busy || url.trim().length === 0} onClick={() => void saveUrl()}>
              {state.channelConfigured ? 'Replace' : 'Save'}
            </Button>
            {state.channelConfigured && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void removeUrl()}>
                Remove
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
