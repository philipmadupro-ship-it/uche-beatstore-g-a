/**
 * Does this buyer own this track? A paid, still-active track license, or an
 * active project bundle that contains it — the same two grants (and the same
 * revocation rules) the delivery pages enforce, so a refunded or disputed
 * purchase stops granting anything here too.
 */
import type { createServiceClient } from '@/lib/auth/ownership';
import { isLicenseDownloadActive } from '@/lib/store/buyer-purchases';
import { isProjectAccessActive } from '@/lib/store/project-access';

type Admin = ReturnType<typeof createServiceClient>;

export async function buyerOwnsTrack(admin: Admin, email: string, trackId: string): Promise<boolean> {
  const [licenseRes, bundleRes] = await Promise.all([
    admin
      .from('license_purchases')
      .select('download_unlocked')
      .eq('buyer_email', email)
      .contains('track_ids', [trackId]),
    admin
      .from('project_access_links')
      .select('project_id, expires_at')
      .eq('buyer_email', email),
  ]);
  if (licenseRes.error) throw licenseRes.error;
  if (bundleRes.error) throw bundleRes.error;

  const licenses = (licenseRes.data ?? []) as Array<{ download_unlocked?: boolean | null }>;
  if (licenses.some(isLicenseDownloadActive)) return true;

  const projectIds = [...new Set(
    ((bundleRes.data ?? []) as Array<{ project_id?: unknown; expires_at?: string | null }>)
      .filter((r) => isProjectAccessActive(r))
      .map((r) => r.project_id)
      .filter((id): id is string => typeof id === 'string'),
  )];
  if (projectIds.length === 0) return false;

  const { data, error } = await admin
    .from('project_tracks')
    .select('track_id')
    .in('project_id', projectIds)
    .eq('track_id', trackId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
