/**
 * Closing a finance period (LABEL-64). Pure rules shared by the route and the screen.
 *
 * Closing freezes a period: it takes no new import and no new statement (the database enforces
 * it, under the same lock imports use). Rules:
 *  - a period with a DRAFT statement does not close (`drafts_open`): approve or void it first;
 *  - nor does one with earnings lines still waiting for review (`lines_waiting`): a closed period cannot allocate them;
 *  - a period that has earnings but a payee with no live statement still closes — that payee is
 *    listed as a warning, because after the close their earnings can only be statemented by
 *    reopening, which is the owner's;
 *  - closing needs `finance.approve`; reopening is the OWNER's (role `owner`, not a capability).
 */

export type PeriodCloseFacts = {
  status: string;
  draftStatements: number;
  /** Lines of the period's imports still waiting for review. */
  linesWaiting: number;
  /** Payees with an allocation in the period and no non-void statement for it. */
  payeesWithoutStatement: number;
};

export type CloseCheck =
  | { ok: true; warnings: string[] }
  | { ok: false; code: 'already_closed' | 'drafts_open' | 'lines_waiting'; message: string };

export function closeCheck(f: PeriodCloseFacts): CloseCheck {
  if (f.status === 'closed') return { ok: false, code: 'already_closed', message: 'This period is already closed.' };
  if (f.draftStatements > 0) {
    return {
      ok: false,
      code: 'drafts_open',
      message: `${f.draftStatements} draft statement${f.draftStatements === 1 ? '' : 's'} in this period. Approve or void ${f.draftStatements === 1 ? 'it' : 'them'} first.`,
    };
  }
  if (f.linesWaiting > 0) {
    return {
      ok: false,
      code: 'lines_waiting',
      message: `${f.linesWaiting} earnings line${f.linesWaiting === 1 ? ' is' : 's are'} still waiting for review. Resolve ${f.linesWaiting === 1 ? 'it' : 'them'} first: a closed period cannot allocate them.`,
    };
  }
  const warnings: string[] = [];
  if (f.payeesWithoutStatement > 0) {
    warnings.push(
      `${f.payeesWithoutStatement} payee${f.payeesWithoutStatement === 1 ? ' has' : 's have'} earnings in this period but no statement. After closing, a statement can only be made by reopening the period.`,
    );
  }
  return { ok: true, warnings };
}

export const mayCloseRole = (capabilities: ReadonlySet<string>, scoped: boolean): boolean => capabilities.has('finance.approve') && !scoped;
export const mayReopenRole = (role: string): boolean => role === 'owner';

export type PeriodOverview = {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: string;
  closedAt: string | null;
  draftStatements: number;
  linesWaiting: number;
  payeesWithoutStatement: number;
  imports: number;
};

export function periodOverviewView(p: PeriodOverview, opts: { canClose: boolean; canReopen: boolean }) {
  const check = closeCheck({ status: p.status, draftStatements: p.draftStatements, linesWaiting: p.linesWaiting, payeesWithoutStatement: p.payeesWithoutStatement });
  return {
    id: p.id,
    label: p.label,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    status: p.status,
    closedAt: p.closedAt,
    imports: p.imports,
    draftStatements: p.draftStatements,
    linesWaiting: p.linesWaiting,
    payeesWithoutStatement: p.payeesWithoutStatement,
    canClose: opts.canClose && check.ok,
    closeBlocked: check.ok ? null : check.code === 'already_closed' ? null : check.message,
    closeWarnings: check.ok ? check.warnings : [],
    canReopen: opts.canReopen && p.status === 'closed',
  };
}
export type PeriodOverviewView = ReturnType<typeof periodOverviewView>;
