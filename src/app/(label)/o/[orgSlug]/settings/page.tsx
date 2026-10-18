'use client';

/**
 * `/o/<slug>/settings` — the admin centre (doc 25, phase 3). One page for the
 * people who run the org: the team in numbers, seats and artists against the
 * licence, recent team changes, and a link to every page that manages
 * something. It changes nothing itself; each section's own page does.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageHeader';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { adminSections, atLimit, mayOpenAdminCentre, usageLine } from '@/lib/labelos/admin-centre';
import type { AdminSummary } from '@/lib/labelos/admin-centre-store';
import { MODULE_LABELS, isModule } from '@/lib/labelos/entitlements';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';
import { cn } from '@/lib/utils';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/60';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-4';

function Stat({ label, value, note, warn, testId }: { label: string; value: string; note?: string; warn?: boolean; testId: string }) {
  return (
    <div className={CARD} data-testid={testId}>
      <p className={LABEL}>{label}</p>
      <p className="mt-2 text-[13px] text-white/80">{value}</p>
      {note && <p className={cn('mt-1 text-[11px]', warn ? 'text-[#ffb7a8]' : 'text-white/60')}>{note}</p>}
    </div>
  );
}

function when(at: string): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function AdminCentrePage() {
  const shell = useOrgShell();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orgId = shell?.org.id;
  const viewer = shell ? { role: shell.role, orgKind: shell.org.kind, capabilities: shell.capabilities, modules: shell.modules } : null;
  const allowed = viewer ? mayOpenAdminCentre(viewer) : false;

  useEffect(() => {
    if (!orgId || !allowed) return;
    let live = true;
    fetch(`/api/org/${orgId}/admin`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setError(typeof body.error === 'string' ? body.error : 'Could not load the admin centre');
        else setSummary(body as AdminSummary);
      })
      .catch(() => live && setError('Could not load the admin centre'));
    return () => {
      live = false;
    };
  }, [orgId, allowed]);

  if (!shell || !viewer) return null;
  const { org } = shell;
  const sections = adminSections(viewer, org.slug);
  const team = summary?.team;

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className={cn(LABEL, 'mb-2')}>{ORG_KIND_LABELS[org.kind]} · Admin</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Admin centre</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">Everything about how {org.name} is run, in one place.</p>
      </header>

      {!allowed ? (
        <p className="text-[11px] text-white/70" data-testid="admin-denied">Only the owner and admins of this organization can open the admin centre.</p>
      ) : (
        <div className="space-y-8" data-testid="admin-centre">
          {error && (
            <p role="alert" className="text-[11px] text-[#ffb7a8]">
              {error}
            </p>
          )}

          <section aria-label="At a glance" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              testId="admin-stat-team"
              label="Team"
              value={team ? `${team.members} ${team.members === 1 ? 'person' : 'people'}` : '—'}
              note={team ? `${team.owners} owner${team.owners === 1 ? '' : 's'} · ${team.admins} admin${team.admins === 1 ? '' : 's'} · ${team.staff} in departments` : undefined}
            />
            <Stat
              testId="admin-stat-seats"
              label="Seats"
              value={summary ? usageLine(summary.seats.used, summary.seats.max, { one: 'seat', many: 'seats' }) : '—'}
              note={summary && atLimit(summary.seats.used, summary.seats.max) ? 'All seats are used.' : 'Pending invitations hold a seat.'}
              warn={!!summary && atLimit(summary.seats.used, summary.seats.max)}
            />
            <Stat
              testId="admin-stat-artists"
              label={org.kind === 'artist' ? 'Artist' : 'Roster artists'}
              value={summary ? usageLine(summary.artists.count, summary.artists.max, { one: 'artist', many: 'artists' }) : '—'}
              note={summary && atLimit(summary.artists.count, summary.artists.max) ? 'The licence allows no more.' : undefined}
              warn={!!summary && atLimit(summary.artists.count, summary.artists.max)}
            />
            <Stat
              testId="admin-stat-invitations"
              label="Invitations"
              value={team ? `${team.pendingInvitations} waiting` : '—'}
              note={team ? `${team.teamAccounts} team account${team.teamAccounts === 1 ? '' : 's'}` : undefined}
            />
          </section>

          {team && (team.mustSetPassword > 0 || team.switchedOff > 0) && (
            <section aria-label="Team accounts" className={cn(CARD, 'flex flex-wrap items-center gap-x-6 gap-y-2')} data-testid="admin-accounts">
              {team.mustSetPassword > 0 && (
                <p className="text-[11px] text-white/80">
                  {team.mustSetPassword} team account{team.mustSetPassword === 1 ? ' has' : 's have'} not chosen a password yet.
                </p>
              )}
              {team.switchedOff > 0 && (
                <p className="text-[11px] text-white/80">
                  {team.switchedOff} team account{team.switchedOff === 1 ? ' is' : 's are'} switched off.
                </p>
              )}
              <Link href={`/o/${org.slug}/settings/members`} className="text-[11px] text-white/60 underline-offset-2 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
                Open Team
              </Link>
            </section>
          )}

          <section aria-labelledby="admin-manage">
            <h2 id="admin-manage" className={cn(LABEL, 'mb-3')}>
              Manage
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map((s) => (
                <li key={s.key}>
                  <Link
                    href={s.href}
                    data-testid={`admin-section-${s.key}`}
                    className="group flex h-full items-start justify-between gap-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <span>
                      <span className="block text-[13px] text-white/80">{s.label}</span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-white/60">{s.description}</span>
                    </span>
                    <ArrowRight size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-white/40 group-hover:text-white/80" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <section aria-labelledby="admin-licence" className={CARD} data-testid="admin-licence">
              <h2 id="admin-licence" className={LABEL}>
                Licence
              </h2>
              <p className="mt-2 text-[11px] text-white/60">
                {summary && !summary.licence.licensed ? 'The standard licence: everything this kind of organization includes.' : 'What this organization is licensed for.'}
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {(summary?.licence.modules ?? []).map((m) => (
                  <li key={m} className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] text-white/80">
                    {isModule(m) ? MODULE_LABELS[m] : m}
                  </li>
                ))}
              </ul>
            </section>

            {summary?.recent && (
              <section aria-labelledby="admin-recent" className={CARD} data-testid="admin-recent">
                <h2 id="admin-recent" className={LABEL}>
                  Recent team changes
                </h2>
                {summary.recent.length === 0 ? (
                  <p className="mt-2 text-[11px] text-white/60">No changes yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {summary.recent.map((c) => (
                      <li key={c.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                        <span className="min-w-0 text-white/80">
                          {c.actor} {c.phrase}
                          {c.subject && <span className="text-white/60"> · {c.subject}</span>}
                        </span>
                        <time dateTime={c.at} className="shrink-0 font-mono text-[10px] text-white/40">
                          {when(c.at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
