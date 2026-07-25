export type CoverWaveformAnalysisResult = {
  peaksUrl: string;
  skipped?: 'already-present';
};

export async function analyzeCoverWaveform(trackId: string): Promise<CoverWaveformAnalysisResult> {
  const id = trackId.trim();
  if (!id) {
    throw new Error('Choose a track before analyzing its waveform.');
  }

  const response = await fetch(`/api/tracks/${encodeURIComponent(id)}/peaks`, {
    method: 'POST',
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
  }
  if (typeof data.peaks_url !== 'string' || !data.peaks_url) {
    throw new Error('Waveform analysis finished without a peaks file.');
  }

  return {
    peaksUrl: data.peaks_url,
    skipped: data.skipped === 'already-present' ? 'already-present' : undefined,
  };
}
