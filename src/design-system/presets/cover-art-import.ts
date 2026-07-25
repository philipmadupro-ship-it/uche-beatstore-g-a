import type { CoverArtArtworkSource } from './cover-art-presets';
import {
  imageUploadErrorMessage,
  imageUploadLimits,
  validateImageUpload,
  type ImageUploadValidationError,
} from '@/lib/upload/image-validation';

export const coverArtImportLimits = imageUploadLimits;

export type CoverArtImportError = ImageUploadValidationError | 'read-failed';

export type CoverArtImportValidation =
  | { ok: true }
  | { ok: false; error: CoverArtImportError };

export function validateCoverArtImport(file: Pick<File, 'type' | 'size'>): CoverArtImportValidation {
  const result = validateImageUpload(file);
  if (!result.ok) {
    return result;
  }

  return { ok: true };
}

export function coverArtImportErrorMessage(error: CoverArtImportError) {
  if (error === 'read-failed') {
    return 'Artwork could not be read.';
  }
  return imageUploadErrorMessage(error);
}

export function readCoverArtFile(file: File): Promise<CoverArtArtworkSource> {
  const validation = validateCoverArtImport(file);
  if (!validation.ok) {
    return Promise.reject(new Error(validation.error));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('read-failed'));
        return;
      }

      resolve({
        source: 'local-upload',
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl: reader.result,
      });
    };
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}
