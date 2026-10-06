/**
 * The closed union of direct-ask notification kinds (LABEL-23, 08 §B6,
 * 13 R-19). Kept apart from `notify.ts` (the server-side writer) so a client
 * component can read the vocabulary without the writer's imports.
 */
export const DIRECT_ASK_KINDS = ['task_assigned', 'approval_requested', 'mention', 'credit_named_you', 'invitation'] as const;
export type DirectAskKind = (typeof DIRECT_ASK_KINDS)[number];

export function isDirectAskKind(v: unknown): v is DirectAskKind {
  return typeof v === 'string' && (DIRECT_ASK_KINDS as readonly string[]).includes(v);
}
