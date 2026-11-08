/**
 * The email a buyer gets when their payment landed on an exclusive that had
 * already sold to someone else (`needs_refund_review`, see purchase-access.ts).
 *
 * The normal delivery email says "your license is now active and your files
 * are ready" and attaches the license agreement. For this buyer both are false:
 * the rights are not theirs and /store/download will refuse them. So they get
 * the truth instead — payment received, on hold, the producer will be in touch
 * — with no download button and no contract.
 */
export function buildHeldPurchaseEmail(params: { totalPaid: string }): { subject: string; html: string } {
  return {
    subject: 'Your purchase is being reviewed',
    html: `
      <div style="font-family: sans-serif; background: #090907; color: #FFFFFF; padding: 40px; border-radius: 20px; max-width: 560px;">
        <h1 style="text-transform: uppercase; letter-spacing: 0.3em; font-size: 13px; color: #FFFFFF; margin: 0 0 20px;">
          Purchase on hold
        </h1>
        <p style="font-size: 15px; line-height: 1.7; color: #FFFFFF;">
          We received your payment of ${params.totalPaid}, but the exclusive license you bought was sold to another buyer at almost the same moment, so we can't deliver the files.
        </p>
        <p style="font-size: 15px; line-height: 1.7; color: #FFFFFF;">
          The producer has been notified and will be in touch about a refund or an alternative. You don't need to do anything.
        </p>
        <p style="margin-top: 48px; font-size: 10px; color: #706B61; text-transform: uppercase; letter-spacing: 0.5em;">
          Questions? Reply to this email or contact support.
        </p>
      </div>
    `,
  };
}
