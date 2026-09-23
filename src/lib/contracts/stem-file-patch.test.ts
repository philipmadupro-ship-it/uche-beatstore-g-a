import { describe, it, expect } from 'vitest';
import { StemFilePatchBodySchema } from './index';

/**
 * Renaming a stem is the alternative to deleting the file and uploading it
 * again, so the body has to be strict about what it will accept — a patch that
 * silently applies nothing would leave the producer thinking the rename took.
 */
describe('StemFilePatchBodySchema', () => {
  it('accepts a rename', () => {
    const r = StemFilePatchBodySchema.safeParse({ file_id: 'f1', label: 'Adlibs' });
    expect(r.success).toBe(true);
  });

  it('accepts a recategorise, including topline', () => {
    expect(StemFilePatchBodySchema.safeParse({ file_id: 'f1', category: 'fx' }).success).toBe(true);
    expect(StemFilePatchBodySchema.safeParse({ file_id: 'f1', category: 'topline' }).success).toBe(true);
  });

  it('rejects a body that changes nothing', () => {
    const r = StemFilePatchBodySchema.safeParse({ file_id: 'f1' });
    expect(r.success).toBe(false);
  });

  it('requires a file_id — the route scopes the update by it', () => {
    expect(StemFilePatchBodySchema.safeParse({ label: 'Adlibs' }).success).toBe(false);
  });

  it('rejects an empty or overlong label', () => {
    expect(StemFilePatchBodySchema.safeParse({ file_id: 'f1', label: '' }).success).toBe(false);
    expect(StemFilePatchBodySchema.safeParse({ file_id: 'f1', label: 'x'.repeat(121) }).success).toBe(false);
  });

  it('rejects a category outside the route allow-list', () => {
    expect(StemFilePatchBodySchema.safeParse({ file_id: 'f1', category: 'guitar' }).success).toBe(false);
  });

  it('is strict — an unknown key is a rejected body, not a silent drop', () => {
    expect(StemFilePatchBodySchema.safeParse({ file_id: 'f1', label: 'x', url: 'https://evil' }).success).toBe(false);
  });
});
