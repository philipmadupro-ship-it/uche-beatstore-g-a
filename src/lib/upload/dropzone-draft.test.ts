import { describe, expect, it } from 'vitest';
import {
  readUploadTypeDraft,
  uploadFileExtension,
  uploadRejectionMessage,
  writeUploadTypeDraft,
} from './dropzone-draft';

function storage(seed: string | null = null) {
  let value = seed;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    value: () => value,
  };
}

describe('upload dropzone draft helpers', () => {
  it('persists and restores valid upload types', () => {
    const store = storage();
    writeUploadTypeDraft('remix', store);
    expect(store.value()).toBe('remix');
    expect(readUploadTypeDraft('beat', store)).toBe('remix');
  });

  it('falls back when persisted type is invalid or storage is unavailable', () => {
    expect(readUploadTypeDraft('instrumental', storage('podcast'))).toBe('instrumental');
    expect(readUploadTypeDraft('song', null)).toBe('song');
  });

  it('normalizes file extensions for upload cards', () => {
    expect(uploadFileExtension('bounce.final.WAV')).toBe('wav');
    expect(uploadFileExtension('untitled')).toBe('audio');
  });

  it('formats actionable rejection messages', () => {
    expect(uploadRejectionMessage([{ code: 'file-invalid-type' }])).toContain('Unsupported audio format');
    expect(uploadRejectionMessage([{ code: 'file-too-large' }])).toContain('500 MB');
    expect(uploadRejectionMessage([{ code: 'custom', message: 'Try again' }])).toBe('Try again');
  });
});
