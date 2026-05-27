/**
 * License-contract template engine.
 *
 * Producers write a markdown-flavoured contract in /store-editor with
 * mustache-style placeholders like {{buyer_name}} or {{license_type}}.
 * At purchase time the Stripe webhook substitutes the placeholders with
 * the real values and PDF-renders the result (see lib/contracts/pdf.ts).
 *
 * The same VARIABLES list powers the editor's "click to insert" toolbar
 * AND the substitution pass — so the docs the producer sees and the
 * keys we look for can never drift.
 */

export interface ContractVariables {
  buyer_name: string;
  buyer_email: string;
  track_titles: string;        // joined "Track A, Track B" — works for both single-track and cart-of-N
  license_type: string;        // "Lease" | "Exclusive"
  purchase_date: string;       // ISO-date, formatted nice
  purchase_id: string;         // license_purchases.id (short prefix)
  producer_name: string;
  producer_email: string;      // contact_email on creator_profiles
  price: string;               // "$135.00"
}

export const VARIABLE_LIST: Array<{ key: keyof ContractVariables; label: string; sample: string }> = [
  { key: 'buyer_name',     label: 'Buyer name',          sample: 'Jordan Reese' },
  { key: 'buyer_email',    label: "Buyer's email",       sample: 'jordan@example.com' },
  { key: 'track_titles',   label: 'Track(s) purchased',  sample: 'Yeat Synth · 808 Bloom' },
  { key: 'license_type',   label: 'License tier',        sample: 'Lease' },
  { key: 'purchase_date',  label: 'Purchase date',       sample: 'May 27, 2026' },
  { key: 'purchase_id',    label: 'Receipt ID',          sample: '7f80b367' },
  { key: 'producer_name',  label: 'Producer name',       sample: 'Uche2crazyyyy' },
  { key: 'producer_email', label: "Producer's email",    sample: 'uche2crazyyy@gmail.com' },
  { key: 'price',          label: 'Total paid',          sample: '$135.00' },
];

/**
 * Default template shown when a producer hasn't customised theirs.
 * Plain-English, lawyer-light. Producers should review + edit, but it
 * covers the basics so the buyer always gets something.
 */
export const DEFAULT_TEMPLATE_MD = `# License Agreement

This document confirms that **{{buyer_name}}** ({{buyer_email}}) purchased a **{{license_type}}** license to the following musical work(s):

**{{track_titles}}**

Granted by **{{producer_name}}** on {{purchase_date}}.

## Grant of Rights

The Producer grants the Licensee a non-exclusive (for Lease) or exclusive (for Exclusive) right to use the above work in original musical compositions, subject to the terms below.

For Lease licenses:
- Up to 5,000 audio streams across all platforms
- Up to 5,000 digital downloads / physical units
- Non-commercial and small-scale commercial use permitted
- Producer must be credited as "prod. {{producer_name}}" in the work's metadata
- Producer retains all underlying composition and master rights

For Exclusive licenses:
- Unlimited distribution and commercial use
- WAV stems delivered upon purchase
- Producer agrees not to re-sell or re-list the work after this date
- Producer retains the right to use the work in their own portfolio
- All other rights revert to the Licensee

## Restrictions

- The Licensee may not resell, sublicense, or redistribute the raw work
- The Licensee may not register the work to a publishing administrator without producer's written consent
- The Licensee may not claim authorship of the underlying composition

## Receipt

Receipt ID: {{purchase_id}}
Amount paid: {{price}}
Producer contact: {{producer_email}}

---

This agreement is binding upon payment and is governed by the laws of the producer's jurisdiction. Both parties acknowledge receipt of this document upon delivery via email.
`;

/**
 * Replace every {{var}} in the template. Unknown variables are left
 * as-is rather than blanked out, so a producer who customises with a
 * variable we haven't defined yet sees their literal text instead of
 * empty space (easier to spot + fix).
 */
export function fillTemplate(template: string, vars: ContractVariables): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (match, key) => {
    if (key in vars) return String(vars[key as keyof ContractVariables]);
    return match;
  });
}
