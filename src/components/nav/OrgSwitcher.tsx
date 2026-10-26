'use client';

/**
 * The organization switcher in the top bar's left cluster (LABEL-09, 07 §1).
 *
 * Renders nothing unless Label OS is on AND the user has more than one place
 * to be (`shouldShowSwitcher`: two orgs, or an org plus something shared).
 * The producer who belongs only to their own studio sees the top bar exactly
 * as before; with the flag off this component makes no request at all.
 *
 * A list of destinations, not commands, so it is a labelled `<nav>` of links
 * in a `ui/Popover` (the same reasoning as the top bar's hub popovers), not
 * `role="menu"`. Which org is current comes from the URL; the server
 * re-authorises every request by the org in its path.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { useLabelOsEnabled } from '@/components/labelos/LabelOsFlag';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { ROLE_LABELS } from '@/lib/labelos/invitations';
import { ORG_KIND_LABELS, currentOrg, shouldShowSwitcher, type MyOrgsResponse } from '@/lib/labelos/switcher';
import { cn } from '@/lib/utils';

export function OrgSwitcher() {
  const enabled = useLabelOsEnabled();
  const pathname = usePathname();
  // A rename on the members page updates the shell; the shell's name wins
  // over the list fetched when the bar mounted.
  const shellOrg = useOrgShell()?.org;
  const [data, setData] = useState<MyOrgsResponse | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch('/api/org', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: MyOrgsResponse | null) => {
        if (alive && j && Array.isArray(j.orgs)) setData({ orgs: j.orgs, shared: Array.isArray(j.shared) ? j.shared : [] });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (!enabled || !data || !shouldShowSwitcher(data.orgs, data.shared)) return null;
  const orgs = shellOrg ? data.orgs.map((o) => (o.id === shellOrg.id ? { ...o, name: shellOrg.name } : o)) : data.orgs;
  const current = currentOrg(orgs, pathname);

  return (
    <Popover
      width={264}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={current ? `Organization: ${current.name}. Switch organization` : 'Switch organization'}
          className={cn(
            // Icon-only on a phone: the bar's right cluster (session, search,
            // bell, menu, profile) already fills 390px, and a named pill
            // pushed the menu button off-screen. The name stays in the label.
            'flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium tracking-tight transition-colors sm:max-w-[14rem] sm:justify-start sm:px-2.5',
            open
              ? 'border-white/30 bg-white/[0.14] text-white'
              : 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10] hover:text-white',
          )}
        >
          <Building2 size={15} aria-hidden="true" className="shrink-0 sm:hidden" />
          <span className="hidden truncate sm:inline">{current?.name ?? 'Organizations'}</span>
          <ChevronsUpDown size={13} aria-hidden="true" className="hidden shrink-0 text-white/60 sm:block" />
        </button>
      )}
    >
      {(close) => (
        <nav className="p-1" aria-label="Organizations">
          <p className="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Organizations</p>
          {orgs.map((o) => {
            const active = current?.id === o.id;
            return (
              <Link
                key={o.id}
                href={o.home}
                onClick={close}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'tap flex min-h-10 items-center gap-3 rounded-lg px-2.5 text-[13px] transition-colors',
                  active ? 'bg-white/[0.08] text-white' : 'text-white/80 hover:bg-white/[0.08] hover:text-white',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium tracking-tight">{o.name}</span>
                  <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                    {ORG_KIND_LABELS[o.kind]} · {ROLE_LABELS[o.role]}
                  </span>
                </span>
                {active && <Check size={14} aria-hidden="true" className="shrink-0 text-white" />}
              </Link>
            );
          })}
          {data.shared.length > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Shared with me</p>
              {data.shared.map((p) => (
                <Link
                  key={p.id}
                  href={p.href}
                  onClick={close}
                  className="tap flex min-h-10 items-center rounded-lg px-2.5 text-[13px] text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                  <span className="truncate">{p.name}</span>
                </Link>
              ))}
            </>
          )}
        </nav>
      )}
    </Popover>
  );
}
