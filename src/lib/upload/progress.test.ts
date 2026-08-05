import { describe, it, expect } from 'vitest';
import {
  findLiveDuplicate,
  bytesFromParts,
  displayedBytes,
  computeSpeedBps,
  computeEtaSec,
  backoffMs,
  isRetriableStatus,
  isLiveStatus,
  sameFile,
} from './progress';

const MIB = 1024 * 1024;

describe('sameFile / isLiveStatus', () => {
  const base = { fileName: 'beat.wav', fileSize: 100, fileLastModified: 5 };

  it('matches on all three identity fields', () => {
    expect(sameFile(base, { ...base })).toBe(true);
    expect(sameFile(base, { ...base, fileSize: 101 })).toBe(false);
    expect(sameFile(base, { ...base, fileLastModified: 6 })).toBe(false);
    expect(sameFile(base, { ...base, fileName: 'other.wav' })).toBe(false);
  });

  it('treats only in-flight statuses as live', () => {
    expect(isLiveStatus('uploading')).toBe(true);
    expect(isLiveStatus('paused')).toBe(true);
    // The recovery states must NOT be live, or re-dropping a failed file
    // would be swallowed as a duplicate and the user could never retry.
    expect(isLiveStatus('error')).toBe(false);
    expect(isLiveStatus('interrupted')).toBe(false);
    expect(isLiveStatus('success')).toBe(false);
    expect(isLiveStatus('aborted')).toBe(false);
  });
});

describe('findLiveDuplicate', () => {
  const file = { fileName: 'beat.wav', fileSize: 100, fileLastModified: 5 };

  it('finds the same file already uploading', () => {
    const uploads = [{ id: 'a', ...file, status: 'uploading' }];
    expect(findLiveDuplicate(uploads, file)).toBe('a');
  });

  it('ignores a failed upload so the user can re-drop to recover', () => {
    const uploads = [{ id: 'a', ...file, status: 'error' }];
    expect(findLiveDuplicate(uploads, file)).toBeNull();
  });

  it('ignores a completed upload so the same file can be uploaded twice on purpose', () => {
    const uploads = [{ id: 'a', ...file, status: 'success' }];
    expect(findLiveDuplicate(uploads, file)).toBeNull();
  });

  it('does not match a different file', () => {
    const uploads = [{ id: 'a', ...file, fileSize: 999, status: 'uploading' }];
    expect(findLiveDuplicate(uploads, file)).toBeNull();
  });
});

describe('bytesFromParts', () => {
  it('counts whole parts at full size', () => {
    expect(bytesFromParts({
      completedPartNumbers: [1, 2], partSize: 8 * MIB, totalParts: 13, fileSize: 101 * MIB,
    })).toBe(16 * MIB);
  });

  it('counts the final short part at its real length, not a full partSize', () => {
    // 101 MiB in 8 MiB parts = 13 parts; the 13th holds 5 MiB.
    const all = Array.from({ length: 13 }, (_, i) => i + 1);
    expect(bytesFromParts({
      completedPartNumbers: all, partSize: 8 * MIB, totalParts: 13, fileSize: 101 * MIB,
    })).toBe(101 * MIB);
  });

  it('does not read 100% when only the short final part is missing', () => {
    const allButLast = Array.from({ length: 12 }, (_, i) => i + 1);
    const bytes = bytesFromParts({
      completedPartNumbers: allButLast, partSize: 8 * MIB, totalParts: 13, fileSize: 101 * MIB,
    });
    expect(bytes).toBe(96 * MIB);
    expect(bytes).toBeLessThan(101 * MIB);
  });

  it('caps at fileSize when the stored part list is corrupt', () => {
    expect(bytesFromParts({
      completedPartNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 99], partSize: 8 * MIB, totalParts: 3, fileSize: 20 * MIB,
    })).toBe(20 * MIB);
  });

  it('is zero for a nonsense partSize rather than NaN', () => {
    expect(bytesFromParts({
      completedPartNumbers: [1], partSize: 0, totalParts: 1, fileSize: 10,
    })).toBe(0);
  });
});

describe('displayedBytes', () => {
  it('adds in-flight chunk bytes to the confirmed total', () => {
    expect(displayedBytes({
      confirmedBytes: 100, inFlight: { 3: 20, 4: 30 }, fileSize: 1000,
    })).toBe(150);
  });

  it('never exceeds the file size', () => {
    expect(displayedBytes({
      confirmedBytes: 900, inFlight: { 3: 500 }, fileSize: 1000,
    })).toBe(1000);
  });

  it('never goes negative', () => {
    expect(displayedBytes({ confirmedBytes: 0, inFlight: {}, fileSize: 1000 })).toBe(0);
  });
});

describe('computeSpeedBps', () => {
  it('excludes bytes carried over from a previous run', () => {
    // 50 MB already done, 10 MB moved in 10s => 1 MB/s, not 6 MB/s.
    const bps = computeSpeedBps({
      bytesUploaded: 60_000_000, baselineBytes: 50_000_000,
      elapsedMs: 10_000, previousBps: 0,
    });
    expect(bps).toBeCloseTo(1_000_000, -3);
  });

  it('smooths towards the new reading rather than jumping', () => {
    const bps = computeSpeedBps({
      bytesUploaded: 2_000_000, baselineBytes: 0,
      elapsedMs: 1_000, previousBps: 1_000_000,
    });
    // 0.7 * 1M + 0.3 * 2M
    expect(bps).toBeCloseTo(1_300_000, -3);
  });

  it('holds the previous reading when no time has passed', () => {
    expect(computeSpeedBps({
      bytesUploaded: 10, baselineBytes: 0, elapsedMs: 0, previousBps: 42,
    })).toBe(42);
  });
});

describe('computeEtaSec', () => {
  it('divides the remaining bytes by the speed', () => {
    expect(computeEtaSec({ bytesUploaded: 50, fileSize: 150, speedBps: 10 })).toBe(10);
  });

  it('is null with no measured speed', () => {
    expect(computeEtaSec({ bytesUploaded: 50, fileSize: 150, speedBps: 0 })).toBeNull();
  });

  it('is zero, not negative, once complete', () => {
    expect(computeEtaSec({ bytesUploaded: 200, fileSize: 150, speedBps: 10 })).toBe(0);
  });
});

describe('backoffMs', () => {
  it('grows exponentially', () => {
    const noJitter = () => 0.5;
    expect(backoffMs(1, noJitter)).toBe(500);
    expect(backoffMs(2, noJitter)).toBe(1000);
    expect(backoffMs(3, noJitter)).toBe(2000);
  });

  it('caps so a long outage does not push a retry an hour out', () => {
    expect(backoffMs(20, () => 0.5)).toBe(15_000);
  });

  it('jitters within ±25% so parallel workers do not retry in lockstep', () => {
    expect(backoffMs(3, () => 0)).toBe(1500);
    expect(backoffMs(3, () => 1)).toBe(2500);
  });
});

describe('isRetriableStatus', () => {
  it('retries network-level failures — this is the wifi-blip case', () => {
    expect(isRetriableStatus(0)).toBe(true);
  });

  it('retries server errors and explicit try-again codes', () => {
    expect(isRetriableStatus(500)).toBe(true);
    expect(isRetriableStatus(503)).toBe(true);
    expect(isRetriableStatus(408)).toBe(true);
    expect(isRetriableStatus(429)).toBe(true);
  });

  it('does not burn attempts on errors that will stay wrong', () => {
    expect(isRetriableStatus(400)).toBe(false);
    expect(isRetriableStatus(401)).toBe(false);
    expect(isRetriableStatus(403)).toBe(false);
    expect(isRetriableStatus(404)).toBe(false);
  });
});
