'use client';

import { SignOutButton } from '@/components/auth/SignOutButton';

/**
 * The way out for pages that have no TopBar: /setup, /account/password,
 * /join/<token> and the platform console. The same helper as everywhere else
 * (useAuth.signOut: clears the session, lands on /login), pinned top-right.
 */
export function PageSignOut({ redirectTo }: { redirectTo?: string }) {
  return (
    <div className="fixed right-4 top-4 z-30">
      <SignOutButton variant="button" redirectTo={redirectTo} />
    </div>
  );
}
