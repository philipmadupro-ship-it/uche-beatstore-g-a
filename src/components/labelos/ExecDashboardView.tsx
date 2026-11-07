'use client';

/**
 * The executive overview (LABEL-67): pipeline, releases by month, blocked releases, approvals waiting,
 * income against cost, top songs, task load by department. Every figure is the server's; this draws them.
 * A section the viewer may not read is named, not drawn as zeros. The CSV is the same numbers as a file.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { showMoney } from '@/lib/labelos/earnings-client';
import type { ExecView } from '@/lib/labelos/exec-dashboard';
import { SONG_STAGE_LABEL, type SongStage } from '@/lib/labelos/song-stage';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[var(--surface-primary)] px-4 py-6 text-center text-[11px] text-white/60';
const CARD = 'rounded-xl border border-white/10 bg-[var(--surface-primary)] p-4';

const stageLabel = (s: string) => SONG_STAGE_LABEL[s as SongStage] ?? s;

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function Section({ id, title, children, testid }: { id: string; title: string; children: React.ReactNode; testid: string }) {
  return (
    <section aria-labelledby={id} className={`${CARD} min-w-0`} data-testid={testid}>
      <h2 id={id} className={`${LABEL} mb-3`}>{title}</h2>
      {children}
    </section>
  );
}

const Withheld = ({ what }: { what: string }) => <p className="text-[11px] text-white/50" data-testid="exec-withheld">{what}</p>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-white/50">{children}</p>;

export function ExecDashboardView({ orgId, slug }: { orgId: string; slug: string }) {
  const [data, setData] = useState<ExecView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/org/${orgId}/exec`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as ExecView & { error?: string };
        if (!live) return;
        if (!res.ok) return setError(body.error ?? 'Could not load the executive overview');
        setData(body);
      } catch {
        if (live) setError('Could not load the executive overview');
      }
    })();
    return () => {
      live = false;
    };
  }, [orgId]);

  if (error) return <p className={NOTICE} data-testid="exec-failed">{error}</p>;
  if (!data) return <p className="text-[11px] text-white/40" data-testid="exec-loading">Loading the executive overview…</p>;

  const maxMonth = Math.max(1, ...data.months.map((m) => m.total));
  return (
    <div className="min-w-0 space-y-6" data-testid="exec-dashboard" data-scoped={data.scoped ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-white/50">
          {data.scoped ? 'You see the songs and releases of your artists only.' : 'Across the whole roster.'}
        </p>
        <a
          href={`/api/org/${orgId}/exec?format=csv`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
          data-testid="exec-export"
        >
          <Download size={14} aria-hidden /> Export CSV
        </a>
      </div>
      {!data.schemaReady && <p className={NOTICE} data-testid="exec-not-ready">Releases are not set up yet: the release database migrations are not applied.</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section id="ex-pipe" title="Pipeline by stage" testid="exec-pipeline">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {data.pipeline.map((p) => (
              <li key={p.stage} data-stage={p.stage}>
                <p className="text-[18px] text-white" data-testid="pipeline-count">{p.count}</p>
                <p className={LABEL}>{stageLabel(p.stage)}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="ex-months" title="Releases by month" testid="exec-months">
          {data.months.length === 0 ? <Empty>No dated releases yet.</Empty> : (
            <ul className="space-y-2">
              {data.months.map((m) => (
                <li key={m.month} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-month={m.month}>
                  <span className="w-20 shrink-0 text-[11px] text-white/60">{monthLabel(m.month)}</span>
                  <span className="h-2 rounded bg-white/30" style={{ width: `${(m.total / maxMonth) * 100}%`, minWidth: 8 }} aria-hidden />
                  <span className="text-[11px] text-white/80" data-testid="month-total">{m.total}</span>
                  <span className="text-[10px] text-white/40">{m.delivered} out · {m.ready} ready · {m.inProgress} in progress</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="ex-blocked" title={`Blocked releases · ${data.blocked.length}`} testid="exec-blocked">
          {data.blocked.length === 0 ? <Empty>Nothing is blocked.</Empty> : (
            <ul className="space-y-2">
              {data.blocked.map((b) => (
                <li key={b.id} className="break-words text-[11px] text-white/80" data-testid="blocked-row">
                  <Link href={`/o/${slug}/releases/${b.id}`} className="text-white underline-offset-2 hover:underline">{b.title}</Link>
                  <span className="text-white/40"> · {[b.artistName, b.date].filter(Boolean).join(' · ')} · blocked on {b.gates.map((x) => x.replace(/_/g, " ")).join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="ex-wait" title={`Approvals waiting · ${data.waiting.length}`} testid="exec-waiting">
          {data.waiting.length === 0 ? <Empty>No approval is waiting.</Empty> : (
            <ul className="space-y-2">
              {data.waiting.map((w) => (
                <li key={w.releaseId} className="break-words text-[11px] text-white/80" data-testid="waiting-row">
                  <Link href={`/o/${slug}/releases/${w.releaseId}`} className="text-white underline-offset-2 hover:underline">{w.title}</Link>
                  <span className="text-white/40"> · {[w.artistName, w.gates.map((x) => x.replace(/_/g, " ")).join(', ')].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="ex-money" title="Income against cost" testid="exec-money">
          {data.money === null ? <Withheld what="Money is shown to people who read finance across the whole roster." /> : data.money.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
            <div className="space-y-4">
              {data.money.map((m) => (
                <dl key={m.currency} className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4" data-currency={m.currency} data-testid="money-row">
                  <Cell label={`Income · ${m.currency}`} value={showMoney(m.income, m.currency)} />
                  <Cell label="Royalties" value={showMoney(m.royalties, m.currency)} />
                  <Cell label="Marketing spent" value={showMoney(m.spent, m.currency)} />
                  <Cell label="Margin" value={showMoney(m.margin, m.currency)} />
                </dl>
              ))}
            </div>
          )}
        </Section>

        <Section id="ex-top" title="Top songs by income" testid="exec-top">
          {data.topSongs === null ? <Withheld what="Shown with the money." /> : data.topSongs.length === 0 ? <Empty>No income is attributed to a song yet.</Empty> : (
            <ol className="space-y-1.5">
              {data.topSongs.map((s) => (
                <li key={`${s.currency}-${s.id}`} className="flex flex-wrap justify-between gap-x-3 text-[11px] text-white/80" data-testid="top-song">
                  <span className="min-w-0 break-words">{s.title}{s.artistName && <span className="text-white/40"> · {s.artistName}</span>}</span>
                  <span className="shrink-0 text-white/60">{showMoney(s.gross, s.currency)}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section id="ex-tasks" title="Task load by department" testid="exec-tasks">
          {data.tasks === null ? <Withheld what="Task load is shown across the whole roster only." /> : data.tasks.length === 0 ? <Empty>No open task.</Empty> : (
            <ul className="space-y-1.5">
              {data.tasks.map((t) => (
                <li key={t.department} className="flex flex-wrap justify-between gap-x-3 text-[11px] text-white/80" data-testid="task-dept" data-department={t.department}>
                  <span>{t.department}</span>
                  <span className="text-white/60">{t.open} open{t.overdue > 0 && <span className="text-red-400"> · {t.overdue} overdue</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="text-[16px] text-white">{value}</dd>
      <dt className={LABEL}>{label}</dt>
    </div>
  );
}
