export const imageUploadLimits = {
  maxSizeBytes: 8 * 1024 * 1024,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const;

export type AcceptedImageMimeType = (typeof imageUploadLimits.acceptedMimeTypes)[number];
export type ImageUploadValidationError = 'unsupported-type' | 'too-large';

export type ImageUploadValidation =
  | { ok: true; extension: 'jpg' | 'png' | 'webp'; mimeType: AcceptedImageMimeType }
  | { ok: false; error: ImageUploadValidationError };

const mimeToExtension: Record<AcceptedImageMimeType, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function validateImageUpload(file: Pick<File, 'type' | 'size'>): ImageUploadValidation {
  if (!imageUploadLimits.acceptedMimeTypes.includes(file.type as AcceptedImageMimeType)) {
    return { ok: false, error: 'unsupported-type' };
  }

  if (file.size > imageUploadLimits.maxSizeBytes) {
    return { ok: false, error: 'too-large' };
  }

  const mimeType = file.type as AcceptedImageMimeType;
  return { ok: true, extension: mimeToExtension[mimeType], mimeType };
}

export function imageUploadErrorMessage(error: ImageUploadValidationError) {
  if (error === 'unsupported-type') {
    return 'Use JPG, PNG, or WebP artwork.';
  }
  return 'Keep artwork under 8 MB.';
}
