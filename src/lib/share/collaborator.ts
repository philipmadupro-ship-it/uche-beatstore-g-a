/**
 * Who a share-page comment really came from (SHARE-07).
 *
 * A guest types a name on a public page; that proves nothing. The only
 * identity a share has is the one the PRODUCER gave it when they invited a
 * contact (`project_shares.contact_id`). The server stamps that onto the
 * comment, and the producer — only the producer — sees it beside the typed
 * name. Pure, so the wording and the validation are tested, not asserted
 * inside three routes.
 */

/** "Nova (Alex)": the typed name first, the invited contact in brackets. Producer-facing only. */
export function attributedAuthor(typedName: string, contactName: string | null | undefined): string {
  const typed = typedName.trim();
  const contact = contactName?.trim() ?? '';
  if (!contact) return typed;
  if (!typed) return contact;
  // Same name twice ("Alex (Alex)") says nothing extra.
  if (typed.toLowerCase() === contact.toLowerCase()) return contact;
  return `${typed} (${contact})`;
}

/**
 * The address a Reply goes to: the producer's PUBLIC contact address only.
 * Never the account email — it is private and would reach every recipient.
 * A malformed value is dropped rather than sent to Resend.
 */
export function replyToFor(contactEmail: string | null | undefined): string | undefined {
  const email = contactEmail?.trim();
  if (!email || email.length > 320) return undefined;
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email) ? email : undefined;
}

/** What the invite writes onto the share: the contact picked, and the address actually used. */
export function inviteSharePatch(input: { contactId: string | null; recipient: string }): Record<string, string> {
  const patch: Record<string, string> = { invited_email: input.recipient.trim() };
  if (input.contactId) patch.contact_id = input.contactId;
  return patch;
}

export interface ContactRef {
  id: string;
  name: string;
}

/** A contact reference for the producer's own JSON; null when there is none. */
export function contactRefOf(row: { id?: unknown; name?: unknown } | null | undefined): ContactRef | null {
  if (!row || typeof row.id !== 'string' || !row.id) return null;
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Contact';
  return { id: row.id, name };
}
