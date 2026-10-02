'use client';

/**
 * The producer's way into their organizations from /settings (LABEL-09).
 * The top-bar switcher stays hidden for someone with exactly one org, which
 * is every producer until they join something; this card is how that
 * producer reaches their org's members page to rename it or invite people.
 *
 * With LABEL_OS_ENABLED off it renders nothing and requests nothing, so the
 * settings page is exactly what it was.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Building2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useLabelOsEnabled } from './LabelOsFlag';
import { ROLE_LABELS } from '@/lib/labelos/invitations';
import { ORG_KIND_LABELS, type MyOrgsResponse } from '@/lib/labelos/switcher';

export function OrgsSettingsCard() {
  const enabled = useLabelOsEnabled();
  const [orgs, setOrgs] = useState<MyOrgsResponse['orgs']>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch('/api/org', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: MyOrgsResponse | null) => {
        if (alive && j && Array.isArray(j.orgs)) setOrgs(j.orgs);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (!enabled || orgs.length === 0) return null;

  return (
    <section aria-labelledby="orgs-settings-heading">
      <div className="mb-4 flex items-center gap-2">
        <Building2 size={14} className="text-white/40" aria-hidden="true" />
        <h2 id="orgs-settings-heading" className="text-[11px] font-bold uppercase tracking-wider text-white">
          Organizations
        </h2>
      </div>
      <div className="space-y-3">
        {orgs.map((o) => (
          <Link key={o.id} href={`/o/${o.slug}/settings/members`} className="group block">
            <Card interactive className="flex items-center gap-5 p-6">
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-readable)]">
                  {ORG_KIND_LABELS[o.kind]} · {ROLE_LABELS[o.role]}
                </p>
                <h3 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{o.name}</h3>
                <p className="mt-0.5 text-[11px] text-[var(--text-readable)]">Members, invitations and the organization’s name.</p>
              </div>
              <ArrowRight size={16} className="shrink-0 text-white/40 transition-colors group-hover:text-[var(--text-primary)]" aria-hidden="true" />
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
