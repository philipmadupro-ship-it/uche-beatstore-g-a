export type StoreLicenseType = 'lease' | 'exclusive';

export type PurchaseLineItem = {
  track_id: string;
  license_id: string;
  license_type: StoreLicenseType;
  file_types: string[];
  stems_included: boolean;
  is_exclusive: boolean;
};

const STEM_FORMATS = new Set(['vocals', 'drums', 'bass', 'other']);

export function normalizeLicenseFileTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  )];
}

export function legacyLicenseFileTypes(licenseType: StoreLicenseType): string[] {
  return licenseType === 'exclusive' ? ['MP3', 'WAV', 'STEMS'] : ['MP3'];
}

export function parsePurchaseLineItem(value: unknown): PurchaseLineItem | null {
  if (typeof value !== 'object' || value === null) return null;

  const item = value as Record<string, unknown>;
  if (typeof item.track_id !== 'string') return null;

  const licenseType: StoreLicenseType =
    item.license_type === 'exclusive' || item.is_exclusive === true ? 'exclusive' : 'lease';
  const hasPersistedFileTypes = Array.isArray(item.file_types);
  const fileTypes = hasPersistedFileTypes
    ? normalizeLicenseFileTypes(item.file_types)
    : legacyLicenseFileTypes(licenseType);
  const stemsIncluded = typeof item.stems_included === 'boolean'
    ? item.stems_included
    : !hasPersistedFileTypes && licenseType === 'exclusive';

  return {
    track_id: item.track_id,
    license_id: typeof item.license_id === 'string' ? item.license_id : licenseType,
    license_type: licenseType,
    file_types: fileTypes,
    stems_included: stemsIncluded,
    is_exclusive: typeof item.is_exclusive === 'boolean'
      ? item.is_exclusive
      : licenseType === 'exclusive',
  };
}

export function canDownloadFormat(item: PurchaseLineItem, format: string): boolean {
  const normalizedFormat = format.trim().toLowerCase();
  if (STEM_FORMATS.has(normalizedFormat)) return item.stems_included;
  if (normalizedFormat === 'wav' || normalizedFormat === 'wav-main') {
    return item.file_types.includes('WAV');
  }
  if (normalizedFormat === 'mp3') return item.file_types.includes('MP3');

  return item.file_types.includes(normalizedFormat.toUpperCase());
}
