import { describe, it, expect } from 'vitest';
import { uploadRowActions, isUploadActive, canEditUploadedTrack } from './row-actions';

describe('isUploadActive', () => {
  it('covers every status where bytes are moving', () => {
    expect(isUploadActive('uploading')).toBe(true);
    expect(isUploadActive('preparing')).toBe(true);
    expect(isUploadActive('finalizing')).toBe(true);
  });

  it('excludes queued — nothing is in flight yet', () => {
    expect(isUploadActive('queued')).toBe(false);
    expect(isUploadActive('paused')).toBe(false);
    expect(isUploadActive('success')).toBe(false);
  });
});

describe('uploadRowActions', () => {
  it('offers pause then cancel while running', () => {
    expect(uploadRowActions('uploading')).toEqual(['pause', 'cancel']);
    expect(uploadRowActions('finalizing')).toEqual(['pause', 'cancel']);
  });

  it('offers resume on a paused row', () => {
    expect(uploadRowActions('paused')).toEqual(['resume', 'cancel']);
  });

  it('offers retry on a failure and re-pick on an interruption', () => {
    expect(uploadRowActions('error')).toEqual(['retry', 'dismiss']);
    expect(uploadRowActions('interrupted')).toEqual(['repick', 'dismiss']);
  });

  it('offers only dismiss once done', () => {
    expect(uploadRowActions('success')).toEqual(['dismiss']);
  });

  it('never offers both cancel and dismiss — they look alike and mean opposites', () => {
    const statuses = ['queued', 'preparing', 'uploading', 'finalizing', 'success', 'error', 'paused', 'interrupted'] as const;
    for (const s of statuses) {
      const actions = uploadRowActions(s);
      expect(actions.includes('cancel') && actions.includes('dismiss')).toBe(false);
    }
  });

  it('always puts the destructive action last', () => {
    const statuses = ['uploading', 'paused', 'error', 'interrupted'] as const;
    for (const s of statuses) {
      const actions = uploadRowActions(s);
      const destructive = actions.findIndex((a) => a === 'cancel' || a === 'dismiss');
      expect(destructive).toBe(actions.length - 1);
    }
  });

  it('renders nothing for an aborted row', () => {
    expect(uploadRowActions('aborted')).toEqual([]);
  });
});

describe('canEditUploadedTrack', () => {
  it('needs a success AND a real track id', () => {
    expect(canEditUploadedTrack({ status: 'success', track: { id: 'abc' } })).toBe(true);
  });

  it('refuses when /complete returned no track', () => {
    expect(canEditUploadedTrack({ status: 'success', track: null })).toBe(false);
    expect(canEditUploadedTrack({ status: 'success', track: {} })).toBe(false);
    expect(canEditUploadedTrack({ status: 'success', track: { id: '' } })).toBe(false);
  });

  it('refuses while the upload is still running', () => {
    expect(canEditUploadedTrack({ status: 'uploading', track: { id: 'abc' } })).toBe(false);
  });
});
