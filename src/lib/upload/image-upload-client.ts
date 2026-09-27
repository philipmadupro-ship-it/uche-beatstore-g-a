import { imageUploadErrorMessage, imageUploadLimits, validateImageUpload } from './image-validation';
import { prepareImageForUpload } from './image-resize';

/**
 * Checks what the picker may accept. Size here is the SOURCE ceiling: files
 * over the upload limit are shrunk in the browser before they are sent.
 */
export function getImageUploadPreflightError(file: Pick<File, 'type' | 'size'>): string | null {
  const validation = validateImageUpload(file, imageUploadLimits.maxSourceBytes);
  return validation.ok ? null : imageUploadErrorMessage(validation.error, imageUploadLimits.maxSourceBytes);
}

/**
 * Turn a failed upload response into something a producer can act on. The
 * platform answers an oversized body with a non-JSON 413 before the route
 * runs, which used to surface as a bare "HTTP 413".
 */
export function uploadResponseError(status: number, data: unknown): string {
  const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined;
  if (typeof error === 'string' && error) return error;
  if (status === 413) return imageUploadErrorMessage('too-large');
  if (status === 401 || status === 403) return 'Sign in again to upload artwork.';
  return `Upload failed (HTTP ${status}). Try again.`;
}

export async function uploadImageFile(file: File): Promise<string> {
  const preflightError = getImageUploadPreflightError(file);
  if (preflightError) {
    throw new Error(preflightError);
  }

  const prepared = await prepareImageForUpload(file);
  const formData = new FormData();
  formData.append('file', prepared);
  const response = await fetch('/api/upload/image', { method: 'POST', body: formData });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.url !== 'string') {
    throw new Error(uploadResponseError(response.status, data));
  }

  return data.url;
}

/**
 * Upload, then attach the URL to its row with `attach`. When the attach does
 * not take (returns false or throws), the uploaded object is discarded so a
 * failed save never leaves an orphan in the bucket. Resolves to the URL on
 * success and null when `attach` reported failure; upload and attach errors
 * propagate unchanged.
 */
export async function uploadAndAttachImage(
  file: File,
  attach: (url: string) => Promise<boolean>,
): Promise<string | null> {
  const url = await uploadImageFile(file);
  let attached = false;
  try {
    attached = await attach(url);
  } finally {
    if (!attached) void discardUploadedImage(url);
  }
  return attached ? url : null;
}

/**
 * Best-effort removal of an uploaded image nothing ended up pointing at —
 * the upload succeeded but the row PATCH that would reference it failed.
 * The server refuses if any row does reference it, so a PATCH that
 * committed but lost its response cannot have its artwork deleted.
 */
export async function discardUploadedImage(url: string): Promise<void> {
  try {
    await fetch('/api/upload/image', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    // Cleanup only; the producer already has the save error in front of them.
  }
}
