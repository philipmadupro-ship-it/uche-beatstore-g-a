/**
 * What the buyer is told when a file they clicked cannot be served.
 *
 * An `<a download>` pointed at a route that answers 403 JSON does not show the
 * JSON: Chrome files a "Failed - Forbidden" in its download shelf and Safari may
 * navigate away, while the page itself carries on as if it saved. The page
 * therefore asks the route first (`probeDownload`) and shows this on failure.
 *
 * 4xx bodies are our own sentences ("File download not permitted by this
 * license", the review hold), so they are shown as written. Anything else — a
 * 5xx, a network drop — gets a fixed line: the route never returns internals,
 * but this must not depend on that.
 */
export const DOWNLOAD_FALLBACK_MESSAGE = 'The download could not start. Try again in a moment.';

export function downloadFailureMessage(status: number, serverError?: string | null): string {
  const text = typeof serverError === 'string' ? serverError.trim() : '';
  if (status >= 400 && status < 500 && text) return text;
  if (status === 404) return 'This file is not available right now. Contact the producer if it persists.';
  if (status === 401 || status === 403) return 'Download access is no longer available for this purchase.';
  return DOWNLOAD_FALLBACK_MESSAGE;
}

export type DownloadProbe = { ok: true } | { ok: false; message: string };

/**
 * Ask the gated route for the first byte. `Range: bytes=0-0` makes a success
 * cost one byte instead of the file, and the body is cancelled either way so a
 * server that ignores Range (a local source) does not stream the whole master
 * into a discarded response.
 */
export async function probeDownload(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadProbe> {
  try {
    const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: true };
    }
    let serverError: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      serverError = typeof body.error === 'string' ? body.error : null;
    } catch {
      // Not JSON (a proxy error page): fall back to the status alone.
    }
    return { ok: false, message: downloadFailureMessage(res.status, serverError) };
  } catch {
    return { ok: false, message: DOWNLOAD_FALLBACK_MESSAGE };
  }
}
