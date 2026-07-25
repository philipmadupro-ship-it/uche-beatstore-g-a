export type LicenseAvailabilityTrack = {
  title?: string | null;
  exclusive_sold?: boolean | null;
  has_wav?: boolean | null;
  wav_url?: string | null;
  stems_status?: string | null;
};

export type LicenseAvailabilityLicense = {
  is_exclusive?: boolean | null;
  stems_included?: boolean | null;
};

export type LicenseAvailabilityResult =
  | { available: true }
  | { available: false; reason: 'exclusive-sold' | 'exclusive-files-missing'; message: string };

export function stemsReady(stemsStatus: string | null | undefined) {
  return stemsStatus === 'ready' || stemsStatus === 'done' || stemsStatus === 'complete';
}

export function hasExclusiveDeliverable(track: LicenseAvailabilityTrack) {
  return Boolean(track.has_wav) || Boolean(track.wav_url) || stemsReady(track.stems_status);
}

export function licenseAvailability(
  track: LicenseAvailabilityTrack,
  license: LicenseAvailabilityLicense,
): LicenseAvailabilityResult {
  const title = track.title || 'This beat';

  if (track.exclusive_sold) {
    return {
      available: false,
      reason: 'exclusive-sold',
      message: `${title} is no longer available for licensing because exclusive rights have sold.`,
    };
  }

  if ((license.is_exclusive || license.stems_included) && !hasExclusiveDeliverable(track)) {
    return {
      available: false,
      reason: 'exclusive-files-missing',
      message: `${title} needs a WAV master or ready stems before this license can be purchased.`,
    };
  }

  return { available: true };
}
