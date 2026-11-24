import { describe, it, expect } from 'vitest';
import {
  STALE_LOCK_MS, MAX_ATTEMPTS, MAX_JOB_AGE_MS,
  isStale, isExhausted, isClaimable, isActive, trackStatusFor,
  decideAfterPoll, afterFailure, isPermanentError, failureText,
  type StemJobRow,
} from './lifecycle';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const ago = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const row = (over: Partial<StemJobRow> = {}): StemJobRow => ({
  id: 'r1', track_id: 't1', job_id: null, status: 'pending', attempts: 0,
  locked_at: null, created_at: ago(60_000), ...over,
});

describe('stale detection', () => {
  it('a fresh claim is live, an old one is stale', () => {
    expect(isStale(row({ status: 'processing', locked_at: ago(60_000) }), NOW, true)).toBe(false);
    expect(isStale(row({ status: 'processing', locked_at: ago(STALE_LOCK_MS + 1) }), NOW, true)).toBe(true);
  });
  it('without lock columns the age is created_at', () => {
    expect(isStale(row({ status: 'processing', created_at: ago(STALE_LOCK_MS + 1) }), NOW, false)).toBe(true);
    expect(isStale(row({ status: 'processing', created_at: ago(1000) }), NOW, false)).toBe(false);
  });
  it('only processing rows can be stale; unreadable time is stale', () => {
    expect(isStale(row({ status: 'pending', created_at: ago(MAX_JOB_AGE_MS) }), NOW, true)).toBe(false);
    expect(isStale(row({ status: 'processing', locked_at: null, created_at: null }), NOW, true)).toBe(true);
  });
});

describe('claimability and activity', () => {
  it('pending and stale-processing are claimable; done, failed and live processing are not', () => {
    expect(isClaimable(row(), NOW, true)).toBe(true);
    expect(isClaimable(row({ status: 'processing', locked_at: ago(STALE_LOCK_MS + 1) }), NOW, true)).toBe(true);
    expect(isClaimable(row({ status: 'processing', locked_at: ago(1000) }), NOW, true)).toBe(false);
    expect(isClaimable(row({ status: 'done' }), NOW, true)).toBe(false);
    expect(isClaimable(row({ status: 'failed' }), NOW, true)).toBe(false);
  });
  it('a retry request is refused only while a live job exists', () => {
    expect(isActive(null, NOW, true)).toBe(false);
    expect(isActive(row(), NOW, true)).toBe(true);
    expect(isActive(row({ status: 'processing', locked_at: ago(1000) }), NOW, true)).toBe(true);
    expect(isActive(row({ status: 'failed' }), NOW, true)).toBe(false);
    expect(isActive(row({ status: 'done' }), NOW, true)).toBe(false);
    expect(isActive(row({ attempts: MAX_ATTEMPTS }), NOW, true)).toBe(false);
    expect(isActive(row({ created_at: ago(MAX_JOB_AGE_MS + 1) }), NOW, false)).toBe(false);
  });
});

describe('outcomes', () => {
  it('maps backend status to a driver decision', () => {
    expect(decideAfterPoll('processing', null)).toEqual({ kind: 'wait' });
    expect(decideAfterPoll('pending', null)).toEqual({ kind: 'wait' });
    expect(decideAfterPoll('done', null)).toEqual({ kind: 'ingest' });
    expect(decideAfterPoll('error', 'boom')).toEqual({ kind: 'fail', error: 'boom' });
    expect(decideAfterPoll('error', null).kind).toBe('fail');
  });
  it('retries until the attempt cap, then fails', () => {
    expect(afterFailure(row({ attempts: 0 }), 'x', NOW, true)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(afterFailure(row({ attempts: MAX_ATTEMPTS - 1 }), 'x', NOW, true)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
  });
  it('a permanent error fails at once; reduced mode is bounded by age', () => {
    expect(afterFailure(row(), 'x', NOW, true, true).status).toBe('failed');
    expect(afterFailure(row(), 'x', NOW, false).status).toBe('pending');
    expect(afterFailure(row({ created_at: ago(MAX_JOB_AGE_MS + 1) }), 'x', NOW, false).status).toBe('failed');
    expect(isExhausted(row({ attempts: 99 }), NOW, false)).toBe(false);
  });
  it('mirrors onto the track status and words failures', () => {
    expect(trackStatusFor('pending')).toBe('pending');
    expect(trackStatusFor('processing')).toBe('pending');
    expect(trackStatusFor('done')).toBe('done');
    expect(trackStatusFor('failed')).toBe('failed');
    expect(isPermanentError('Stored object is not supported audio (html)')).toBe(true);
    expect(isPermanentError('Demucs service error: 503')).toBe(false);
    expect(failureText({ last_error: null })).toMatch(/Retry/);
    expect(failureText({ last_error: 'boom' })).toBe('boom');
  });
});
