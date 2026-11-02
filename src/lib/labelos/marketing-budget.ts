/** Budget helpers shared by the two budget routes (LABEL-65). */
import { money } from '@/lib/labelos/finance/money';
import type { BudgetRowOut } from '@/lib/labelos/marketing-plan-store';

/** A message when the amount cannot be money in that currency (outside 64 bits, unknown code); null when fine. */
export function moneyProblem(amountMinor: string, currency: string): string | null {
  try {
    money(BigInt(amountMinor), currency);
    return null;
  } catch {
    return 'That is not a valid amount in that currency.';
  }
}

/** Field by field; the amount leaves as a string. */
export const budgetLineOut = (r: BudgetRowOut) => ({ id: r.id, label: r.label, amountMinor: BigInt(r.amount_minor).toString(), currency: r.currency, status: r.status, note: r.note });
