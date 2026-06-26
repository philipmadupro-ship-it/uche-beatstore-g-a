/**
 * Shapes for the data Stripe hands us back on the webhook.
 *
 * The webhook trusts whatever we stuffed into `session.metadata` at
 * checkout time — but metadata is a flat string map, `cart_items` is a
 * JSON string we re-parse, and a malformed value (a non-array blob, an
 * item missing `track_id`, a `seller_user_id` that isn't a UUID) used to
 * flow straight into a DB query. PostgREST would just return no rows, so
 * the failure was silent rather than loud.
 *
 * Centralising the parse here means: per-item schema validation, the same
 * tolerant "drop bad items, never throw" contract the route already
 * depended on, and one place to unit-test the edge cases.
 */
import { z } from 'zod';

/** A single line item as serialised into `metadata.cart_items`. */
export const CartItemSchema = z.object({
  // track_id is the only field the old filter actually required; keep that
  // bar (non-empty string) so we don't silently widen acceptance.
  track_id: z.string().min(1),
  // license_id may be a custom-license UUID or a legacy type string
  // ('lease', 'exclusive-rights', …). Default to '' so resolveTypeFromRaw
  // gets a string either way.
  license_id: z.string().default(''),
  license_type: z.string().default(''),
});

export type CartItem = z.infer<typeof CartItemSchema>;

/**
 * Parse `metadata.cart_items` (a JSON string) into validated line items.
 * Invalid JSON, a non-array root, or individual bad items all degrade to
 * being dropped — the function never throws and returns `[]` in the worst
 * case, matching the route's prior fail-soft behaviour.
 */
export function parseCartItems(raw: string | undefined | null): CartItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: CartItem[] = [];
  for (const candidate of parsed) {
    const result = CartItemSchema.safeParse(candidate);
    if (result.success) out.push(result.data);
  }
  return out;
}
