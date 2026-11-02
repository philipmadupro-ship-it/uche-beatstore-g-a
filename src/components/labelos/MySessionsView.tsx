'use client';

/**
 * "My sessions" (LABEL-69): the projects a collaborator has been admitted to,
 * grouped by organization, each with the asks waiting on them — confirm a
 * credit, acknowledge a split line, sign a contract. Every action is an
 * existing route a project member already reaches (credits PATCH, split
 * signatures POST); this view adds none.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/useToast';
import { PROJECT_ROLE_LABELS } from '@/lib/labelos/project-members';
import type { ExternalProjectRole } from '@/lib/labelos/capabilities';
import type { OrgSession, SessionAsk } from '@/lib/labelos/my-sessions';

const BUTTON =
  'inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';

export function MySessionsView({ sessions }: { sessions: OrgSession[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (ask: SessionAsk, orgId: string) => {
    setBusy(ask.key);
    try {
      let res: Response;
      if (ask.kind === 'credit' && ask.trackId) {
        res = await fetch(`/api/org/${orgId}/tracks/${ask.trackId}/credits/${ask.refId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'confirm' }),
        });
      } else if (ask.kind === 'split' && ask.trackId && ask.sheetId) {
        res = await fetch(`/api/org/${orgId}/tracks/${ask.trackId}/splits/${ask.sheetId}/signatures`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'acknowledged', line_id: ask.refId }),
        });
      } else return;
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Something went wrong');
        return;
      }
      toast.success(ask.kind === 'credit' ? 'Credit confirmed' : 'Split acknowledged');
      router.refresh();
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setBusy(null);
    }
  };

  if (sessions.length === 0) {
    return (
      <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40" data-testid="shared-empty">
        Nothing is shared with you right now.
      </p>
    );
  }

  return (
    <div className="space-y-8" data-testid="my-sessions">
      {sessions.map((org) => (
        <section key={org.orgId} aria-labelledby={`org-${org.orgId}`} className="space-y-3" data-testid={`session-org-${org.orgId}`}>
          <h2 id={`org-${org.orgId}`} className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            {org.orgName}
            {org.askCount > 0 && <span className="rounded-lg border border-white/20 px-1.5 py-0.5 text-white/70">{org.askCount} waiting</span>}
          </h2>
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
            {org.projects.map((p) => (
              <li key={p.id} className="px-4 py-3" data-testid={`session-project-${p.id}`}>
                <Link href={p.href} className="flex items-center gap-3 transition-colors hover:text-white">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{p.name}</span>
                  <span className="shrink-0 rounded-lg border border-white/20 px-2 py-0.5 text-[11px] text-white/70">
                    {PROJECT_ROLE_LABELS[p.role as ExternalProjectRole] ?? p.role}
                  </span>
                </Link>
                {p.asks.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {p.asks.map((a) => (
                      <li key={a.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 px-3 py-2" data-testid={`ask-${a.kind}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] text-white/80">{a.label}</span>
                          {a.trackTitle && <span className="block truncate text-[11px] text-white/40">{a.trackTitle}</span>}
                        </span>
                        {a.kind === 'contract' ? (
                          <span className="text-[11px] text-white/60">Use the signing link in your email</span>
                        ) : (
                          <button type="button" className={BUTTON} disabled={busy === a.key} onClick={() => void act(a, org.orgId)}>
                            {a.kind === 'credit' ? 'Confirm' : 'Acknowledge'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
