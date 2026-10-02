/**
 * What a CLOSED Stripe dispute does to the buyer's access.
 *
 * `charge.dispute.created` revokes downloads at once (the money is frozen
 * until the bank rules). When the dispute CLOSES the outcome decides:
 *
 *  - `won`            the seller kept the money: the buyer paid and the sale
 *                     stands, so access comes back.
 *  - `warning_closed` an early inquiry (a retrieval request / warning) that
 *                     closed without ever becoming a chargeback: nothing was
 *                     taken, so access comes back.
 *  - `lost`           the bank took the money back: access stays revoked.
 *  - `charge_refunded` the charge was refunded instead: it is a refunded sale
 *                     now, and a refund revokes — never restore it.
 *
 * Anything else (an open status in a "closed" event, or one Stripe adds later)
 * changes nothing: leaving access revoked is recoverable by the producer,
 * handing files back on a sale we cannot tell is safe is not.
 */
export type DisputeStatus = string | null | undefined;
export type DisputeClosedEffect = 'restore' | 'keep-revoked' | 'ignore';

export function disputeClosedEffect(status: DisputeStatus): DisputeClosedEffect {
  switch (status) {
    case 'won':
    case 'warning_closed':
      return 'restore';
    case 'lost':
    case 'charge_refunded':
      return 'keep-revoked';
    default:
      return 'ignore';
  }
}
