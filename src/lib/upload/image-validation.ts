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

/**
 * Magic-byte check: the declared MIME type is client-controlled, so the bytes
 * must actually be the format we are about to store and serve.
 */
export function matchesImageSignature(bytes: Uint8Array, mimeType: AcceptedImageMimeType): boolean {
  const at = (offset: number, sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  switch (mimeType) {
    case 'image/jpeg': return at(0, [0xff, 0xd8, 0xff]);
    case 'image/png': return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp': return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
  }
}
