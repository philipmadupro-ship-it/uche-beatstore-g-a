import { NextRequest, NextResponse } from 'next/server';
import { scopedList, insertOwned, isErrorResponse } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ContactResolveBodySchema } from '@/lib/contracts';

/**
 * POST /api/contacts/resolve — find-or-create a contact by email.
 *
 * Powers the "send to an email not in your CRM" flow. Sending to a fresh
 * address auto-creates a contact so the send is tracked and the person enters
 * the CRM (the Mailchimp model). Matching is case-insensitive on email; an
 * existing contact is reused rather than duplicated.
 */
export async function POST(req: NextRequest) {
  const parsed = await readBody(req, ContactResolveBodySchema);
  if (!parsed.ok) return parsed.res;
  const email = parsed.data.email.trim();
  const emailLc = email.toLowerCase();

  // Find existing (case-insensitive) among the caller's contacts.
  const existing = await scopedList<{ id: string; email: string | null; name: string }>('contacts', { orderBy: 'name', ascending: true });
  if (isErrorResponse(existing)) return existing;
  const match = existing.find((c) => (c.email ?? '').toLowerCase() === emailLc);
  if (match) return NextResponse.json({ contact: match, created: false });

  // Create a minimal contact. Default name = the email's local part, so the
  // CRM row is readable until the producer fills in details.
  const fallbackName = parsed.data.name?.trim() || email.split('@')[0] || email;
  const result = await insertOwned('contacts', { name: fallbackName, email });
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ contact: result, created: true });
}
