import { deleteStoredObject, readStoredObjectHead } from '@/lib/storage/upload';
import { sniffAudioBuffer } from '@/lib/upload/processing';

/**
 * Check an assembled multipart upload is really audio before a track row
 * points at it. The multipart path never sees the bytes (the browser PUTs
 * parts straight to R2), so the extension check in /init was the only gate
 * until the background processing job ran, by which time the track existed.
 *
 * Reads 16 bytes with a ranged GET, never the whole (up to 500MB) file. A
 * rejected object is deleted so a failed upload leaves nothing behind.
 * Returns ok for sources it cannot inspect (local dev filesystem).
 */
export async function verifyStoredAudio(source: string): Promise<{ ok: true } | { ok: false; format: string }> {
  const head = await readStoredObjectHead(source, 16);
  if (!head) return { ok: true };
  const sniff = sniffAudioBuffer(head);
  if (sniff.ok) return { ok: true };
  await deleteStoredObject(source).catch(() => undefined);
  return { ok: false, format: sniff.format };
}
