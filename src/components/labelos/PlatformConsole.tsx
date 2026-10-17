'use client';

/**
 * The platform console (LABEL-47) at `/platform`: the operator licenses Label
 * OS to an independent artist / producer or to a label, and decides what each
 * licensee gets — its modules and its seat and artist caps — and invites its
 * owner. Talks only to /api/platform/*, which answers 404 to anyone but a
 * platform operator; the page itself is not rendered for them either.
 *
 * Every action here is audited in the organization it acts on (the server
 * writes the event with the change). Plans, prices and billing are not here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { toast } from '@/hooks/useToast';
import { slugify } from '@/lib/slug';
import { ACCOUNT_FACES, FACE_LABELS, type AccountFace } from '@/lib/labelos/account';
import { MODULES, MODULE_LABELS, type Module } from '@/lib/labelos/entitlements';
import { parseCapInput, usageLabel, type LicenseeView } from '@/lib/labelos/platform';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-5 sm:p-6';
const INPUT =
  'min-h-11 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[12px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const CHIP = 'min-h-9 rounded-lg border px-3 text-[11px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40';
const chip = (on: boolean) =>
  `${CHIP} ${on ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/70 hover:border-white/20 hover:bg-white/[0.10]'}`;

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, body: body as T };
    return { ok: false, error: typeof body?.error === 'string' ? body.error : `Request failed (${res.status})` };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}

function ModulePicker({ value, onChange, idPrefix }: { value: Set<Module>; onChange: (next: Set<Module>) => void; idPrefix: string }) {
  return (
    <fieldset>
      <legend className={`${LABEL} mb-2`}>Modules</legend>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {MODULES.map((m) => (
          <label key={m} htmlFor={`${idPrefix}-${m}`} className="flex min-h-9 cursor-pointer items-center gap-3 text-[12px] text-white/80">
            <Checkbox
              id={`${idPrefix}-${m}`}
              checked={value.has(m)}
              onChange={(e) => {
                const next = new Set(value);
                if (e.target.checked) next.add(m);
                else next.delete(m);
                onChange(next);
              }}
            />
            {MODULE_LABELS[m]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CapField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint: string }) {
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <input id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} placeholder="No limit" aria-describedby={`${id}-hint`} className={`${INPUT} mt-2`} />
      <p id={`${id}-hint`} className="mt-1 text-[10px] text-white/40">{hint}</p>
    </div>
  );
}

function CreateLicensee({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [face, setFace] = useState<AccountFace>('label');
  const [modules, setModules] = useState<Set<Module>>(new Set(MODULES));
  const [seats, setSeats] = useState('');
  const [artists, setArtists] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const s = parseCapInput(seats, 1);
    const a = parseCapInput(artists, 0);
    if (!s.ok) return setError(`Seats: ${s.error}`);
    if (!a.ok) return setError(`Artists: ${a.error}`);
    setBusy(true);
    const res = await api<{ org: { name: string }; invitation: { sent: boolean; emailSent?: boolean; error?: string } | null }>('/api/platform/licensees', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        slug: (slugTouched ? slug : slugify(name)).trim(),
        face,
        modules: [...modules],
        max_seats: s.value,
        ...(face === 'label' ? { max_artists: a.value } : {}),
        ...(ownerEmail.trim() ? { owner_email: ownerEmail.trim() } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const inv = res.body.invitation;
    toast.success(`${res.body.org.name} created`, inv ? (inv.sent ? 'Owner invitation sent' : inv.error) : 'No owner invited yet');
    setName('');
    setSlug('');
    setSlugTouched(false);
    setSeats('');
    setArtists('');
    setOwnerEmail('');
    setModules(new Set(MODULES));
    onCreated();
  }

  return (
    <section className={CARD} aria-labelledby="new-licensee">
      <h2 id="new-licensee" className="text-[15px] font-medium text-white/90">New licensee</h2>
      <form
        className="mt-5 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset>
          <legend className={`${LABEL} mb-2`}>Account</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Account">
            {ACCOUNT_FACES.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={face === f} className={chip(face === f)} onClick={() => setFace(f)}>
                {FACE_LABELS[f]}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-4 sm:flex-row">
          <label htmlFor="licensee-name" className="block min-w-0 flex-1">
            <span className={LABEL}>Name</span>
            <input id="licensee-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Night Shift Records" className={`${INPUT} mt-2`} />
          </label>
          <label htmlFor="licensee-slug" className="block min-w-0 flex-1">
            <span className={LABEL}>Address</span>
            <input
              id="licensee-slug"
              value={slugTouched ? slug : slugify(name)}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              maxLength={60}
              placeholder="night-shift"
              className={`${INPUT} mt-2 font-mono`}
            />
          </label>
        </div>
        <ModulePicker value={modules} onChange={setModules} idPrefix="new-module" />
        <div className="flex flex-col gap-4 sm:flex-row">
          <CapField id="licensee-seats" label="Seats" value={seats} onChange={setSeats} hint="Staff logins. Roster artists do not take one." />
          {face === 'label' && <CapField id="licensee-artists" label="Artists" value={artists} onChange={setArtists} hint="Artists on the roster." />}
        </div>
        <label htmlFor="licensee-owner" className="block">
          <span className={LABEL}>Owner’s email</span>
          <input id="licensee-owner" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} maxLength={254} placeholder="Optional — you can invite later" className={`${INPUT} mt-2`} />
        </label>
        {error && (
          <p role="alert" className="text-[11px] text-[var(--error-text)]">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Create licensee
          </Button>
        </div>
      </form>
    </section>
  );
}

function LicenseeCard({ licensee, onChanged }: { licensee: LicenseeView; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [modules, setModules] = useState<Set<Module>>(new Set(licensee.modules));
  const [seats, setSeats] = useState(licensee.maxSeats === null ? '' : String(licensee.maxSeats));
  const [artists, setArtists] = useState(licensee.maxArtists === null ? '' : String(licensee.maxArtists));
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idBase = `lic-${licensee.id}`;

  async function save() {
    setError(null);
    const s = parseCapInput(seats, 1);
    const a = parseCapInput(artists, 0);
    if (!s.ok) return setError(`Seats: ${s.error}`);
    if (!a.ok) return setError(`Artists: ${a.error}`);
    setBusy(true);
    const res = await api(`/api/platform/licensees/${licensee.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ modules: [...modules], max_seats: s.value, max_artists: licensee.face === 'label' ? a.value : null }),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success('Licence saved', licensee.name);
    setEditing(false);
    onChanged();
  }

  async function invite() {
    setError(null);
    setBusy(true);
    const res = await api<{ emailSent: boolean }>(`/api/platform/licensees/${licensee.id}/invitations`, { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success('Owner invited', res.body.emailSent ? email.trim() : 'The email could not be sent; the invitation is waiting.');
    setEmail('');
    setInviting(false);
    onChanged();
  }

  return (
    <li className={CARD} aria-labelledby={`${idBase}-name`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${idBase}-name`} className="truncate text-[15px] font-medium text-white/90">{licensee.name}</h3>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            {FACE_LABELS[licensee.face]} · /o/{licensee.slug}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!licensee.setupDone && <span className="rounded-lg border border-white/20 px-2 py-1 text-[10px] text-white/70">Not set up yet</span>}
          {licensee.owners === 0 && <span className="rounded-lg border border-white/20 px-2 py-1 text-[10px] text-white/70">No owner yet</span>}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[12px] sm:grid-cols-4">
        <div>
          <dt className={LABEL}>Seats</dt>
          <dd className="mt-1 text-white/80">{usageLabel(licensee.seatsUsed, licensee.maxSeats)}</dd>
        </div>
        {licensee.face === 'label' && (
          <div>
            <dt className={LABEL}>Artists</dt>
            <dd className="mt-1 text-white/80">{usageLabel(licensee.artists, licensee.maxArtists)}</dd>
          </div>
        )}
        <div className="col-span-2">
          <dt className={LABEL}>Modules</dt>
          <dd className="mt-1 text-white/80">
            {licensee.modules.length === MODULES.length ? 'All' : licensee.modules.length === 0 ? 'None' : licensee.modules.map((m) => MODULE_LABELS[m]).join(', ')}
            {!licensee.licensed && <span className="text-white/40"> · default</span>}
          </dd>
        </div>
      </dl>

      {licensee.pendingOwnerInvites.length > 0 && (
        <p className="mt-3 text-[11px] text-white/60">
          Owner invited: {licensee.pendingOwnerInvites.map((i) => i.email).join(', ')}
        </p>
      )}

      {editing && (
        <form
          className="mt-5 flex flex-col gap-5 border-t border-white/10 pt-5"
          aria-label={`Licence for ${licensee.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ModulePicker value={modules} onChange={setModules} idPrefix={`${idBase}-module`} />
          <div className="flex flex-col gap-4 sm:flex-row">
            <CapField id={`${idBase}-seats`} label="Seats" value={seats} onChange={setSeats} hint="A lower cap stops new seats; nobody is removed." />
            {licensee.face === 'label' && <CapField id={`${idBase}-artists`} label="Artists" value={artists} onChange={setArtists} hint="A lower cap stops new artists; nobody is removed." />}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>Save licence</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {inviting && (
        <form
          className="mt-5 flex flex-col gap-2 border-t border-white/10 pt-5 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void invite();
          }}
        >
          <label htmlFor={`${idBase}-owner`} className="block min-w-0 flex-1">
            <span className="sr-only">Owner’s email for {licensee.name}</span>
            <input id={`${idBase}-owner`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" maxLength={254} className={INPUT} />
          </label>
          <Button type="submit" variant="primary" size="md" loading={busy} disabled={!email.trim()}>Send invitation</Button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[11px] text-[var(--error-text)]">
          {error}
        </p>
      )}

      {!editing && !inviting && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setEditing(true)} aria-label={`Edit licence of ${licensee.name}`}>Edit licence</Button>
          <Button type="button" size="sm" onClick={() => setInviting(true)} aria-label={`Invite the owner of ${licensee.name}`}>Invite owner</Button>
        </div>
      )}
    </li>
  );
}

type Load = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; licensees: LicenseeView[] };

export function PlatformConsole() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  // Bumped after every change; the effect below refetches.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    void api<{ licensees: LicenseeView[] }>('/api/platform/licensees').then((res) => {
      if (!alive) return;
      setLoad(res.ok ? { state: 'ready', licensees: res.body.licensees } : { state: 'failed', message: res.error });
    });
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
      <CreateLicensee onCreated={refresh} />
      <section aria-labelledby="licensees-heading">
        <h2 id="licensees-heading" className={`${LABEL} mb-3`}>Licensees</h2>
        {load.state === 'loading' && <p role="status" className="text-[11px] text-white/60">Loading licensees…</p>}
        {load.state === 'failed' && <p role="alert" className="text-[11px] text-[var(--error-text)]">{load.message}</p>}
        {load.state === 'ready' && load.licensees.length === 0 && <p className="text-[11px] text-white/60">No licensees yet.</p>}
        {load.state === 'ready' && load.licensees.length > 0 && (
          <ul className="flex flex-col gap-4">
            {load.licensees.map((l) => (
              // The key carries the licence, so a saved change re-seeds the card's form.
              <LicenseeCard key={`${l.id}:${l.modules.join(',')}:${l.maxSeats}:${l.maxArtists}`} licensee={l} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
