import { imageUploadErrorMessage, validateImageUpload } from './image-validation';

export function getImageUploadPreflightError(file: Pick<File, 'type' | 'size'>): string | null {
  const validation = validateImageUpload(file);
  return validation.ok ? null : imageUploadErrorMessage(validation.error);
}

export async function uploadImageFile(file: File): Promise<string> {
  const preflightError = getImageUploadPreflightError(file);
  if (preflightError) {
    throw new Error(preflightError);
  }

  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/upload/image', { method: 'POST', body: formData });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.url !== 'string') {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
  }

  return data.url;
}
