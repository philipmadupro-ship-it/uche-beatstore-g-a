/**
 * /account/password — a team account chooses its own password
 * (docs/bstudio-label-os/25-team-accounts.md, phase 1).
 *
 * The org shell sends a team account here while it is on the password its
 * organization gave it (first sign-in, or after a reset). It also works any
 * time later for a team account that wants to change it. Anyone who is not a
 * team account goes to /o (their password is managed by the normal reset
 * flow). Behind LABEL_OS_ENABLED; signed out → /login.
 */
import { notFound, redirect } from 'next/navigation';
import { sessionIdentity } from '@/lib/auth/org-access';
import { createServiceClient } from '@/lib/auth/ownership';
import { isLabelOsEnabled } from '@/lib/labelos/flag';
import { ownManagedAccount } from '@/lib/labelos/team-accounts-store';
import { PageSignOut } from '@/components/auth/PageSignOut';
import { AccountPasswordForm } from '@/components/labelos/AccountPasswordForm';

export const dynamic = 'force-dynamic';

export default async function AccountPasswordPage() {
  if (!isLabelOsEnabled()) notFound();
  const session = await sessionIdentity();
  if (!session) redirect(`/login?next=${encodeURIComponent('/account/password')}`);

  let required = false;
  try {
    const own = await ownManagedAccount(createServiceClient(), session.userId);
    if (own.status !== 'managed' || own.account.disabled) redirect('/o');
    required = own.account.mustChangePassword;
  } catch (err) {
    // redirect() throws by design; let it through.
    if (err && typeof err === 'object' && 'digest' in err) throw err;
    redirect('/o');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090907] px-4 py-10 text-white">
      <PageSignOut />
      <AccountPasswordForm email={session.email} required={required} />
    </div>
  );
}
