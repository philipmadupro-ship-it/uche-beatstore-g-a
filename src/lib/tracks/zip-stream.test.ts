import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { zipStream } from './zip-stream';

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) { c.close(); return; }
      c.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

describe('zipStream', () => {
  it('streams every entry, in order, byte for byte', async () => {
    const big = 'x'.repeat(100_000);
    const zip = await collect(zipStream([
      { name: '01 Song.wav', open: async () => chunked(big, 7_000) },
      { name: '02 Beat - MIDNIGHT.mp3', open: async () => new TextEncoder().encode('beat') },
      { name: 'README.txt', open: async () => new TextEncoder().encode('hello') },
    ]));
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(['01 Song.wav', '02 Beat - MIDNIGHT.mp3', 'README.txt']);
    expect(strFromU8(files['01 Song.wav'])).toBe(big);
    expect(strFromU8(files['02 Beat - MIDNIGHT.mp3'])).toBe('beat');
  });
  it('leaves out an entry that cannot be opened and says so', async () => {
    const skipped: string[] = [];
    const zip = await collect(zipStream([
      { name: 'a.wav', open: async () => null },
      { name: 'b.wav', open: async () => { throw new Error('boom'); } },
      { name: 'c.wav', open: async () => new Uint8Array([1, 2, 3]) },
    ], { onSkip: (n, r) => skipped.push(`${n}:${r}`) }));
    expect(Object.keys(unzipSync(zip))).toEqual(['c.wav']);
    expect(skipped).toEqual(['a.wav:unavailable', 'b.wav:boom']);
  });
});
