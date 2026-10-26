/**
 * /setup — a new account says what it is and gets its organization
 * (LABEL-48; lib/labelos/setup.ts, the wizard in lib/labelos/setup-wizard.ts).
 *
 * Reached from sign-up (the face picked there arrives as `?type=` or in the
 * account's `user_metadata`) and from src/proxy.ts, which sends a signed-in
 * account that is neither the producer nor a member here instead of to the
 * buyer page. Behind LABEL_OS_ENABLED (the proxy 404s it while off).
 *
 * Signed out → /login; already a member → /o; the producer → /library.
 */
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasAnyLabelOsMembership } from '@/lib/labelos/membership-gate';
import { isLabelOsEnabled } from '@/lib/labelos/flag';
import { SETUP_PATH, faceFromMetadata, isSetupFace } from '@/lib/labelos/setup';
import { PageSignOut } from '@/components/auth/PageSignOut';
import { OrgSetupWizard } from '@/components/labelos/OrgSetupWizard';

export const dynamic = 'force-dynamic';

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ type?: string | string[] }> }) {
  if (!isLabelOsEnabled()) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(SETUP_PATH)}`);

  const { data: profile } = await supabase.from('creator_profiles').select('user_id').eq('user_id', user.id).maybeSingle();
  if (profile) redirect('/library');
  if (await hasAnyLabelOsMembership(supabase, user.id)) redirect('/o');

  const { type } = await searchParams;
  const asked = Array.isArray(type) ? type[0] : type;
  const initialFace = isSetupFace(asked) ? asked : faceFromMetadata(user.user_metadata);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090907] px-4 py-10 text-white">
      <PageSignOut />
      <OrgSetupWizard userId={user.id} initialFace={initialFace} email={user.email ?? null} />
    </div>
  );
}
