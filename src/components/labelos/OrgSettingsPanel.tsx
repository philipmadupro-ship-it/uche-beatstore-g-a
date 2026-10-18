'use client';

/**
 * `/o/<slug>/settings/organization` (LABEL-51), owner only. The switches that
 * used to be SQL-only: the release approval gates, the signed-split rule, the
 * Needs-attention thresholds and which departments are on.
 *
 * One form, one Save. Turning the legal gate off asks first, because it is an
 * explicit, audited skip shown on every release it affects (decision 5). The
 * route is the safeguard (owner role, licence, audit); this panel is the
 * pause and the plain wording. A department the licence does not include is
 * listed as such and cannot be switched here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { confirmToast, toast } from '@/hooks/useToast';
import { MODULES, MODULE_LABELS, type Module } from '@/lib/labelos/entitlements';
import { SWITCHABLE_MODULES, parseDepartmentsOff, patchFromDraft, type OrgSettingsView } from '@/lib/labelos/org-settings';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-5 sm:p-6';

type Loaded = { settings: OrgSettingsView; licensed: Module[]; switchable: Module[] };

function ToggleRow({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Checkbox id={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[13px] text-white/80">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-white/60">{hint}</span>
      </label>
    </div>
  );
}

export function OrgSettingsPanel({ orgId }: { orgId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<OrgSettingsView | null>(null);
  const [days, setDays] = useState({ release: '', stalled: '' });
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const adopt = useCallback((body: Loaded) => {
    setLoaded(body);
    setDraft(body.settings);
    setDays({ release: String(body.settings.attention_release_days), stalled: String(body.settings.attention_stalled_days) });
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/org/${orgId}/settings`, { cache: 'no-store' })
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 403 || res.status === 404) return setStatus('denied');
        if (!res.ok) return setStatus('error');
        adopt((await res.json()) as Loaded);
        setStatus('ready');
      })
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
    };
  }, [orgId, adopt]);

  const daysValid = (v: string) => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 365;
  const next: OrgSettingsView | null = useMemo(() => {
    if (!draft) return null;
    return {
      ...draft,
      attention_release_days: daysValid(days.release) ? Number(days.release) : draft.attention_release_days,
      attention_stalled_days: daysValid(days.stalled) ? Number(days.stalled) : draft.attention_stalled_days,
    };
  }, [draft, days]);
  const patch = loaded && next ? patchFromDraft(loaded.settings, next) : {};
  const dirty = Object.keys(patch).length > 0;
  const invalid = !daysValid(days.release) || !daysValid(days.stalled);

  if (status === 'loading') return <p className="text-[11px] text-white/60" role="status">Loading settings…</p>;
  if (status === 'denied') return <p className="text-[11px] text-white/70" data-testid="settings-denied">Only the owner of this organization can change its settings.</p>;
  if (status === 'error' || !loaded || !draft || !next) return <p className="text-[11px] text-white/70">The settings could not be loaded. Try again in a moment.</p>;

  const set = <K extends keyof OrgSettingsView>(key: K, value: OrgSettingsView[K]) => setDraft({ ...draft, [key]: value });
  const off = new Set(draft.departments_off);
  const toggleDepartment = (m: Module, on: boolean) => {
    const next = new Set(draft.departments_off);
    if (on) next.delete(m);
    else next.add(m);
    setDraft({ ...draft, departments_off: parseDepartmentsOff([...next]) });
  };

  const save = async () => {
    if (!dirty || invalid) return;
    if (patch.legal_gate === 'off') {
      const ok = await confirmToast(
        'Skip legal approval?',
        'Releases will no longer need a legal approval. Every release it affects says so, and the change is recorded. Credits & splits still have to be complete.',
        { confirmLabel: 'Skip legal approval', danger: true },
      );
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/${orgId}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not save the settings.');
        return;
      }
      adopt(body as Loaded);
      toast.success('Settings saved');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const unlicensed = MODULES.filter((m) => !loaded.licensed.includes(m) && !off.has(m));

  return (
    <div className="space-y-4" data-testid="org-settings">
      <section className={CARD} aria-labelledby="gates-h">
        <h2 id="gates-h" className={`${LABEL} mb-1`}>Release approvals</h2>
        <p className="text-[11px] leading-relaxed text-white/60">Which approvals a release needs before it can be delivered. Metadata, artwork, masters and credits &amp; splits always gate.</p>
        <div className="divide-y divide-white/10">
          <ToggleRow id="legal-gate" label="Require legal approval" hint="Off is an explicit skip, shown on every release it affects." checked={draft.legal_gate === 'on'} onChange={(v) => set('legal_gate', v ? 'on' : 'off')} />
          <ToggleRow id="marketing-gate" label="Require marketing approval" hint="Off skips the marketing sign-off on a release." checked={draft.marketing_gate === 'on'} onChange={(v) => set('marketing_gate', v ? 'on' : 'off')} />
          <ToggleRow id="signed-split" label="Require a signed master split" hint="A contract can only be signed once the master split sheet is signed." checked={draft.require_signed_master_split} onChange={(v) => set('require_signed_master_split', v)} />
        </div>
      </section>

      <section className={CARD} aria-labelledby="attention-h">
        <h2 id="attention-h" className={`${LABEL} mb-1`}>Needs attention</h2>
        <p className="mb-4 text-[11px] leading-relaxed text-white/60">When the Overview starts listing a release or a song. Whole days, 1 to 365.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Release target within (days)" inputMode="numeric" value={days.release} onChange={(e) => setDays({ ...days, release: e.target.value })} error={daysValid(days.release) ? undefined : 'Enter 1 to 365'} />
          <Field label="Song stalled for more than (days)" inputMode="numeric" value={days.stalled} onChange={(e) => setDays({ ...days, stalled: e.target.value })} error={daysValid(days.stalled) ? undefined : 'Enter 1 to 365'} />
        </div>
      </section>

      <section className={CARD} aria-labelledby="departments-h">
        <h2 id="departments-h" className={`${LABEL} mb-1`}>Departments</h2>
        <p className="text-[11px] leading-relaxed text-white/60">Switch off a department this organization does not use. Its pages and actions are hidden and refused for everyone; the data stays. You can only switch off what your licence includes.</p>
        <div className="divide-y divide-white/10">
          {/* A department already off stays listed even if the licence lapsed, so the owner can see and clear it. */}
          {SWITCHABLE_MODULES.filter((m) => loaded.switchable.includes(m) || off.has(m)).map((m) => (
            <ToggleRow key={m} id={`dept-${m}`} label={MODULE_LABELS[m]} hint={off.has(m) ? (loaded.licensed.includes(m) ? 'Off' : 'Off · not in your licence') : 'On'} checked={!off.has(m)} onChange={(v) => toggleDepartment(m, v)} />
          ))}
        </div>
        {off.has('contracts') && draft.legal_gate === 'on' && (
          <p className="mt-3 text-[11px] leading-relaxed text-white/70" data-testid="contracts-legal-warning">
            Contracts &amp; legal is off but legal approval is still required. Nobody will be able to give it, so a release can only go out with the owner&apos;s override. Switch legal approval off as well, or keep the department on.
          </p>
        )}
        {unlicensed.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-white/50" data-testid="unlicensed">
            Not in your licence: {unlicensed.map((m) => MODULE_LABELS[m]).join(', ')}.
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} disabled={!dirty || invalid || saving} loading={saving}>Save settings</Button>
        {!dirty && !error && <span className="text-[11px] text-white/50">No changes</span>}
        {error && <span role="alert" className="text-[11px] text-[#ffb7a8]">{error}</span>}
      </div>
    </div>
  );
}
