import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

process.env.R2_PRIVATE_BUCKET_NAME = 'private-bucket';

import { r2, listPrivateKeys, deletePrivateKeys } from './upload';

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

let sent: Cmd[];
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => { sent = []; });
afterEach(() => { send?.mockRestore(); });

describe('listPrivateKeys', () => {
  it('follows continuation tokens until the listing is complete', async () => {
    send = vi.spyOn(r2, 'send').mockImplementation((async (cmd: Cmd) => {
      sent.push(cmd);
      return cmd.input.ContinuationToken
        ? { Contents: [{ Key: 'deliverables/b' }], IsTruncated: false }
        : { Contents: [{ Key: 'deliverables/a' }], IsTruncated: true, NextContinuationToken: 'page-2' };
    }) as never);

    expect(await listPrivateKeys('deliverables/')).toEqual(['deliverables/a', 'deliverables/b']);
    expect(sent).toHaveLength(2);
    expect(sent[0].input).toMatchObject({ Bucket: 'private-bucket', Prefix: 'deliverables/' });
    expect(sent[1].input).toMatchObject({ ContinuationToken: 'page-2' });
  });

  it('returns nothing for an empty listing', async () => {
    send = vi.spyOn(r2, 'send').mockResolvedValue({ IsTruncated: false } as never);
    expect(await listPrivateKeys('deliverables/x-')).toEqual([]);
  });
});

describe('deletePrivateKeys', () => {
  it('deletes in batches of at most 1000, from the private bucket only', async () => {
    send = vi.spyOn(r2, 'send').mockImplementation((async (cmd: Cmd) => { sent.push(cmd); return {}; }) as never);
    const keys = Array.from({ length: 2300 }, (_, i) => `deliverables/k${i}`);

    await deletePrivateKeys(keys);

    expect(sent.map((c) => (c.input.Delete as { Objects: unknown[] }).Objects.length)).toEqual([1000, 1000, 300]);
    for (const c of sent) expect(c.input.Bucket).toBe('private-bucket');
  });

  it('throws when S3 reports a per-object failure, so the caller knows it was not clean', async () => {
    send = vi.spyOn(r2, 'send').mockResolvedValue({ Errors: [{ Key: 'deliverables/a', Code: 'AccessDenied', Message: 'denied' }] } as never);
    await expect(deletePrivateKeys(['deliverables/a'])).rejects.toThrow(/denied/);
  });

  it('does nothing for an empty list', async () => {
    send = vi.spyOn(r2, 'send').mockResolvedValue({} as never);
    await deletePrivateKeys([]);
    expect(send).not.toHaveBeenCalled();
  });
});
