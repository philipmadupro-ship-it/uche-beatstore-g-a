'use client';

/**
 * `/o/<slug>/settings/members` (LABEL-09, 07 §2.6): who is in the org, and —
 * for owners and admins — changing their role, functions and single
 * abilities, removing them, inviting people and revoking invitations. The
 * org's name is renamed in place here (org.manage).
 *
 * Every choice offered comes from the same pure rules the routes enforce
 * (`lib/labelos/members`, `lib/labelos/invitations`), so nothing here is a
 * control the server would refuse. Interaction hierarchy: the name and the
 * role are direct (InlineText, Dropdown); functions and remove live in the
 * row's ⋯ ActionMenu (remove confirms with confirmToast); abilities are a
 * popover of switches; inviting is the one modal.
 *
 * Artist scope (LABEL-10, 06 §2.5): the ⋯ menu switches a member between
 * the whole organization and selected artists (PATCH scope); for a member
 * limited to some artists, the Artists popover is the roster picker
 * (PUT /members/artists). Role `artist` is always limited.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageHeader';
import { ListContainer } from '@/components/ui/ListRow';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { InlineText } from '@/components/ui/InlineText';
import { Popover } from '@/components/ui/Popover';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';
import { InviteMemberModal } from '@/components/labelos/InviteMemberModal';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { confirmToast, toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import {
  FUNCTIONS_BY_ORG_KIND,
  ROLE_TAKES_OVERRIDES,
  ROLE_USES_FUNCTIONS,
  ROLES,
  capabilitiesFor,
  type Capability,
  type OrgFunction,
  type Role,
} from '@/lib/labelos/capabilities';
import { FUNCTION_LABELS, ROLE_LABELS, describeGrant } from '@/lib/labelos/invitations';
import {
  CAPABILITY_LABELS,
  assignableRoles,
  planMemberRemoval,
  switchableCapabilities,
  toggleCapability,
  type MemberState,
} from '@/lib/labelos/members';
import { memberLabel } from '@/lib/labelos/member-identity';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

type Member = {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string;
  functions: string[];
  scope: string;
  cap_grants: string[];
  cap_revokes: string[];
  joined_at: string;
  is_you: boolean;
  /** The roster contacts an artists-scoped member sees; null when not shown or whole org. */
  contact_ids: string[] | null;
};

type RosterEntry = { id: string; name: string };

type Invitation = {
  id: string;
  email: string;
  role: string;
  functions: string[];
  expires_at: string;
};

type Patch = Partial<Pick<Member, 'role' | 'functions' | 'scope' | 'cap_grants' | 'cap_revokes'>>;

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';

function asRole(r: string): Role | null {
  return ROLES.find((x) => x === r) ?? null;
}

function toState(m: Member): MemberState {
  return { userId: m.user_id, role: m.role, functions: m.functions, scope: m.scope, capGrants: m.cap_grants, capRevokes: m.cap_revokes };
}

function knownFunctions(list: string[]): OrgFunction[] {
  return list.filter((f): f is OrgFunction => f in FUNCTION_LABELS);
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export default function OrgMembersPage() {
  const shell = useOrgShell();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);

  const orgId = shell?.org.id ?? '';
  const manage = shell?.can('members.manage') ?? false;
  const canRename = shell?.can('org.manage') ?? false;

  const loadInvitations = useCallback(async () => {
    if (!manage) return;
    const res = await fetch(`/api/org/${orgId}/invitations`, { cache: 'no-store' });
    if (res.ok) setInvitations(((await readJson(res)).invitations as Invitation[]) ?? []);
  }, [orgId, manage]);

  // The roster to pick from, for whoever may change a member's artists.
  // Without catalog.read the route refuses; the picker then says so.
  useEffect(() => {
    if (!orgId || !manage) return;
    let alive = true;
    fetch(`/api/org/${orgId}/contacts?view=roster`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = await readJson(res);
        if (alive) setRoster(((body.contacts as RosterEntry[]) ?? []).map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {
        if (alive) setRoster([]);
      });
    return () => {
      alive = false;
    };
  }, [orgId, manage]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/org/${orgId}/members`, { cache: 'no-store' });
        const body = await readJson(res);
        if (!alive) return;
        if (!res.ok) setLoadError(typeof body.error === 'string' ? body.error : 'Could not load members.');
        else setMembers((body.members as Member[]) ?? []);
      } catch {
        if (alive) setLoadError('Could not reach the server. Reload to try again.');
      }
    })();
    void loadInvitations();
    return () => {
      alive = false;
    };
  }, [orgId, loadInvitations]);

  const ownerCount = useMemo(() => (members ?? []).filter((m) => m.role === 'owner').length, [members]);

  if (!shell) return null;
  const { org } = shell;
  const actor = { userId: (members ?? []).find((m) => m.is_you)?.user_id ?? '', role: shell.role };

  const rename = async (next: string) => {
    const res = await fetch(`/api/org/${org.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      toast.error('Could not rename', typeof body.error === 'string' ? body.error : undefined);
      return false;
    }
    shell.setOrgName((body.org as { name: string }).name);
    return true;
  };

  const change = async (m: Member, patch: Patch) => {
    setBusy(m.user_id);
    try {
      const res = await fetch(`/api/org/${org.id}/members`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: m.user_id, ...patch }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        toast.error('Could not change the member', typeof body.error === 'string' ? body.error : undefined);
        return;
      }
      const next = body.member as Partial<Member>;
      // Limited to artists just now: read which ones (rows a past limit left).
      let contactIds: string[] | null | undefined;
      if (next.scope === 'artists' && m.scope !== 'artists') {
        const list = await fetch(`/api/org/${org.id}/members/artists?user_id=${encodeURIComponent(m.user_id)}`, { cache: 'no-store' });
        contactIds = list.ok ? (((await readJson(list)).contact_ids as string[]) ?? []) : [];
      } else if (next.scope === 'org') {
        contactIds = null;
      }
      setMembers((cur) =>
        (cur ?? []).map((x) =>
          x.user_id === m.user_id
            ? {
                ...x,
                role: next.role ?? x.role,
                functions: next.functions ?? x.functions,
                scope: next.scope ?? x.scope,
                cap_grants: next.cap_grants ?? x.cap_grants,
                cap_revokes: next.cap_revokes ?? x.cap_revokes,
                contact_ids: contactIds === undefined ? x.contact_ids : contactIds,
              }
            : x,
        ),
      );
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setBusy(null);
    }
  };

  const setArtists = async (m: Member, contactIds: string[]) => {
    setBusy(m.user_id);
    try {
      const res = await fetch(`/api/org/${org.id}/members/artists`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: m.user_id, contact_ids: contactIds }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        toast.error('Could not change the artists', typeof body.error === 'string' ? body.error : undefined);
        return;
      }
      const saved = (body.contact_ids as string[]) ?? [];
      setMembers((cur) => (cur ?? []).map((x) => (x.user_id === m.user_id ? { ...x, contact_ids: saved } : x)));
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: Member) => {
    const who = memberLabel(m);
    const ok = await confirmToast(
      m.is_you ? `Leave ${org.name}?` : `Remove ${who}?`,
      m.is_you ? 'You lose access to this organization straight away.' : `${who} loses access to ${org.name} straight away. Their work stays.`,
      { confirmLabel: m.is_you ? 'Leave' : 'Remove', danger: true },
    );
    if (!ok) return;
    setBusy(m.user_id);
    try {
      const res = await fetch(`/api/org/${org.id}/members?user_id=${encodeURIComponent(m.user_id)}`, { method: 'DELETE' });
      const body = await readJson(res);
      if (!res.ok) {
        toast.error('Could not remove', typeof body.error === 'string' ? body.error : undefined);
        return;
      }
      if (m.is_you) {
        // Somewhere they still belong: another org's home, else `/`, which
        // sends the producer to the dashboard and anyone else to their
        // account. A full load, so the proxy re-checks membership.
        const next = await fetch('/api/org', { cache: 'no-store' })
          .then((r) => (r.ok ? (r.json() as Promise<{ orgs?: { home: string }[] }>) : null))
          .catch(() => null);
        window.location.assign(next?.orgs?.[0]?.home ?? '/');
        return;
      }
      setMembers((cur) => (cur ?? []).filter((x) => x.user_id !== m.user_id));
      toast.success(`${who} removed`);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (inv: Invitation) => {
    const ok = await confirmToast(`Revoke the invitation to ${inv.email}?`, 'The link stops working. You can invite them again.', {
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/org/${org.id}/invitations/${inv.id}`, { method: 'DELETE' });
    const body = await readJson(res);
    if (!res.ok) {
      toast.error('Could not revoke', typeof body.error === 'string' ? body.error : undefined);
      return;
    }
    setInvitations((cur) => cur.filter((x) => x.id !== inv.id));
    toast.success('Invitation revoked');
  };

  return (
    <PageContainer>
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
            {ORG_KIND_LABELS[org.kind]} · Members
          </p>
          {canRename ? (
            <InlineText
              value={org.name}
              onSave={rename}
              label="Organization name"
              maxLength={80}
              className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]"
              inputClassName="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]"
            />
          ) : (
            <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">
              {org.name}
            </h1>
          )}
          <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
            {manage ? 'Who is in this organization and what each person can do.' : 'Who is in this organization.'}
          </p>
        </div>
        {manage && (
          <Button variant="secondary" size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus size={14} aria-hidden="true" />
            Invite
          </Button>
        )}
      </header>

      {loadError && (
        <p role="alert" className="mb-6 text-sm text-[var(--error-text)]">
          {loadError}
        </p>
      )}

      {members === null && !loadError ? (
        <p role="status" className="text-sm text-white/60">
          Loading members…
        </p>
      ) : (
        members && (
          <section aria-labelledby="members-heading">
            <h2 id="members-heading" className={`${LABEL} mb-3`}>
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </h2>
            <ListContainer>
              {members.map((m) => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  orgKind={org.kind}
                  manage={manage}
                  actor={actor}
                  ownerCount={ownerCount}
                  busy={busy === m.user_id}
                  roster={roster}
                  onChange={(p) => change(m, p)}
                  onArtists={(ids) => setArtists(m, ids)}
                  onRemove={() => remove(m)}
                />
              ))}
            </ListContainer>
          </section>
        )
      )}

      {manage && invitations.length > 0 && (
        <section aria-labelledby="invitations-heading" className="mt-10">
          <h2 id="invitations-heading" className={`${LABEL} mb-3`}>
            Pending invitations
          </h2>
          <ListContainer>
            {invitations.map((inv) => {
              const role = asRole(inv.role);
              return (
                <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-white/80">{inv.email}</p>
                    <p className={`${LABEL} mt-1`}>
                      {role ? describeGrant(role, knownFunctions(inv.functions)) : inv.role} · until {shortDate(inv.expires_at)}
                    </p>
                  </div>
                  <ActionMenu
                    label={`Invitation to ${inv.email}`}
                    sections={[{ id: 'danger', danger: true, items: [{ id: 'revoke', label: 'Revoke invitation', onSelect: () => revoke(inv) }] }]}
                  />
                </div>
              );
            })}
          </ListContainer>
        </section>
      )}

      {manage && (
        <InviteMemberModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          orgId={org.id}
          orgKind={org.kind}
          orgName={org.name}
          onInvited={() => void loadInvitations()}
        />
      )}
    </PageContainer>
  );
}

function MemberRow({
  member: m,
  orgKind,
  manage,
  actor,
  ownerCount,
  busy,
  roster,
  onChange,
  onArtists,
  onRemove,
}: {
  member: Member;
  orgKind: NonNullable<ReturnType<typeof useOrgShell>>['org']['kind'];
  manage: boolean;
  actor: { userId: string; role: Role };
  ownerCount: number;
  busy: boolean;
  roster: RosterEntry[] | null;
  onChange: (patch: Patch) => void;
  onArtists: (contactIds: string[]) => void;
  onRemove: () => void;
}) {
  const role = asRole(m.role);
  const state = toState(m);
  const functions = knownFunctions(m.functions);
  const who = memberLabel(m);
  const roles = manage && role ? assignableRoles(orgKind, actor, state, ownerCount) : [];
  const removable = manage && planMemberRemoval(actor, state, ownerCount).ok;
  const usesFunctions = !!role && ROLE_USES_FUNCTIONS[role];
  const switchable = manage && role && ROLE_TAKES_OVERRIDES[role] ? switchableCapabilities(orgKind, role) : [];
  const limited = m.scope === 'artists' || role === 'artist';
  // Only a plain member chooses between the two: an artist is always
  // limited, an owner/admin never (planMemberChange holds the same rule).
  const scopeChoosable = manage && role === 'member' && !m.is_you;
  const artistCount = m.contact_ids?.length ?? null;

  const sections: MenuSection[] = [];
  if (scopeChoosable) {
    sections.push({
      id: 'scope',
      label: 'Sees',
      items: [
        { id: 'scope-org', label: 'Whole organization', checked: !limited, disabled: busy, onSelect: () => { if (limited) onChange({ scope: 'org' }); } },
        { id: 'scope-artists', label: 'Selected artists', checked: limited, disabled: busy, onSelect: () => { if (!limited) onChange({ scope: 'artists' }); } },
      ],
    });
  }
  if (manage && usesFunctions && roles.length > 0) {
    sections.push({
      id: 'functions',
      label: 'Functions',
      items: FUNCTIONS_BY_ORG_KIND[orgKind].map((fn) => {
        const on = functions.includes(fn);
        return {
          id: `fn-${fn}`,
          label: FUNCTION_LABELS[fn],
          checked: on,
          disabled: busy,
          onSelect: () => {
            onChange({ functions: on ? functions.filter((f) => f !== fn) : [...functions, fn] });
            return 'keep-open' as const;
          },
        };
      }),
    });
  }
  if (removable) {
    sections.push({
      id: 'danger',
      danger: true,
      items: [{ id: 'remove', label: m.is_you ? 'Leave organization' : 'Remove from organization', onSelect: onRemove }],
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-4" data-testid={`member-${m.user_id}`}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13px] font-medium text-white/80">
          <span className="truncate">{who}</span>
          {m.is_you && <span className="shrink-0 rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/70">You</span>}
        </p>
        <p className={`${LABEL} mt-1 truncate`}>
          {[m.email && m.email !== who ? m.email : null, functions.length ? functions.map((f) => FUNCTION_LABELS[f]).join(' · ') : null, limited ? (artistCount === null ? 'Selected artists' : `${artistCount} ${artistCount === 1 ? 'artist' : 'artists'}`) : null, `Joined ${shortDate(m.joined_at)}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {roles.length > 1 && role ? (
          <Dropdown<Role>
            value={role}
            onChange={(next) => next !== role && onChange({ role: next })}
            options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            aria-label={`Role of ${who}`}
            disabled={busy}
            menuWidth={160}
          />
        ) : (
          <span className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70">{role ? ROLE_LABELS[role] : m.role}</span>
        )}
        {manage && limited && (
          <ArtistsPopover member={m} roster={roster} busy={busy} onArtists={onArtists} who={who} />
        )}
        {switchable.length > 0 && role && (
          <AbilitiesPopover member={m} orgKind={orgKind} role={role} switchable={switchable} busy={busy} onChange={onChange} who={who} />
        )}
        {sections.length > 0 && <ActionMenu label={`Actions for ${who}`} sections={sections} busy={busy} />}
      </div>
    </div>
  );
}

function AbilitiesPopover({
  member: m,
  orgKind,
  role,
  switchable,
  busy,
  onChange,
  who,
}: {
  member: Member;
  orgKind: NonNullable<ReturnType<typeof useOrgShell>>['org']['kind'];
  role: Role;
  switchable: Capability[];
  busy: boolean;
  onChange: (patch: Patch) => void;
  who: string;
}) {
  const overrides = { grant: m.cap_grants, revoke: m.cap_revokes };
  const effective = capabilitiesFor(orgKind, role, m.functions, overrides);
  const preset = capabilitiesFor(orgKind, role, m.functions, null);
  const changed = switchable.filter((c) => effective.has(c) !== preset.has(c)).length;

  return (
    <Popover
      width={300}
      align="right"
      label={`Abilities of ${who}`}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={busy}
          className={cn(
            'min-h-9 rounded-lg border px-3 text-xs transition-colors duration-[var(--dur-fast)] disabled:opacity-40',
            open
              ? 'border-white/30 bg-white/[0.14] text-white'
              : 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10]',
          )}
        >
          {changed === 0 ? 'Abilities' : `Abilities · ${changed} changed`}
        </button>
      )}
    >
      <div className="max-h-[60vh] overflow-y-auto p-2">
        <p className="px-2 pb-2 pt-1 text-[11px] leading-5 text-[var(--text-readable)]">
          What {describeGrant(role, knownFunctions(m.functions))} brings, with single abilities switched on or off for {who}.
        </p>
        <ul className="space-y-0.5">
          {switchable.map((cap) => {
            const on = effective.has(cap);
            const differs = on !== preset.has(cap);
            return (
              <li key={cap}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  disabled={busy}
                  onClick={() => {
                    const next = toggleCapability(orgKind, role, m.functions, overrides, cap, !on);
                    onChange({ cap_grants: next.grant, cap_revokes: next.revoke });
                  }}
                  className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-[11px] transition-colors hover:bg-white/[0.08] disabled:opacity-40"
                >
                  <span className={cn('min-w-0 flex-1', on ? 'text-white/80' : 'text-white/40')}>
                    {CAPABILITY_LABELS[cap]}
                    {differs && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">changed</span>}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
                      on ? 'border-white/30 bg-white/[0.14]' : 'border-white/10 bg-white/[0.04]',
                    )}
                  >
                    <span className={cn('absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all', on ? 'left-3.5 bg-white' : 'left-0.5 bg-white/40')} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Popover>
  );
}

/**
 * The roster picker (LABEL-10): which of the org's artists a limited member
 * sees. Each switch saves the whole list (PUT /members/artists). None
 * selected is allowed and means the member sees no artist.
 */
function ArtistsPopover({
  member: m,
  roster,
  busy,
  onArtists,
  who,
}: {
  member: Member;
  roster: RosterEntry[] | null;
  busy: boolean;
  onArtists: (contactIds: string[]) => void;
  who: string;
}) {
  const selected = new Set(m.contact_ids ?? []);
  const count = selected.size;
  return (
    <Popover
      width={300}
      align="right"
      label={`Artists ${who} sees`}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={busy}
          className={cn(
            'min-h-9 rounded-lg border px-3 text-xs transition-colors duration-[var(--dur-fast)] disabled:opacity-40',
            open
              ? 'border-white/30 bg-white/[0.14] text-white'
              : 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10]',
          )}
        >
          {count === 0 ? 'Artists · none' : `Artists · ${count}`}
        </button>
      )}
    >
      <div className="max-h-[60vh] overflow-y-auto p-2">
        <p className="px-2 pb-2 pt-1 text-[11px] leading-5 text-[var(--text-readable)]">
          {who} sees only the artists switched on here{count === 0 ? ' — none yet, so nothing at all' : ''}.
        </p>
        {roster === null ? (
          <p role="status" className="px-2 py-2 text-[11px] text-white/60">Loading the roster…</p>
        ) : roster.length === 0 ? (
          <p className="px-2 py-2 text-[11px] text-white/60">This organization has no artists on its roster yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {roster.map((a) => {
              const on = selected.has(a.id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => onArtists(on ? [...selected].filter((id) => id !== a.id) : [...selected, a.id])}
                    className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-[11px] transition-colors hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    <span className={cn('min-w-0 flex-1 truncate', on ? 'text-white/80' : 'text-white/40')}>{a.name}</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
                        on ? 'border-white/30 bg-white/[0.14]' : 'border-white/10 bg-white/[0.04]',
                      )}
                    >
                      <span className={cn('absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all', on ? 'left-3.5 bg-white' : 'left-0.5 bg-white/40')} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Popover>
  );
}
