export type StoreEditorAttentionKind = 'library' | 'waveforms';

export interface StoreEditorTrackIssueCount {
  count: number;
  firstId: string | null;
}

export interface StoreEditorIssueSummary {
  noCover?: StoreEditorTrackIssueCount;
  noPrice?: StoreEditorTrackIssueCount;
  noBpmKey?: StoreEditorTrackIssueCount;
  missingPeaks?: StoreEditorTrackIssueCount;
}

export interface StoreEditorAttentionTrack {
  id: string;
  store_listed: boolean;
  cover_url: string | null;
  peaks_url: string | null;
  bpm: number | null;
  key: string | null;
}

export interface StoreEditorAttentionIssue {
  label: string;
  count: number;
  firstId: string;
  kind: StoreEditorAttentionKind;
}

function countIssue<TTrack extends StoreEditorAttentionTrack>(
  tracks: TTrack[],
  predicate: (track: TTrack) => boolean,
): StoreEditorTrackIssueCount {
  const matches = tracks.filter(predicate);
  return { count: matches.length, firstId: matches[0]?.id ?? null };
}

function issueFromSummary(
  summary: StoreEditorTrackIssueCount | undefined,
  fallback: StoreEditorTrackIssueCount,
): StoreEditorTrackIssueCount {
  return summary ?? fallback;
}

export function getStoreEditorAttentionIssues<TTrack extends StoreEditorAttentionTrack>({
  tracks,
  summary,
  hasReadyPrice,
}: {
  tracks: TTrack[];
  summary?: StoreEditorIssueSummary | null;
  hasReadyPrice: (track: TTrack) => boolean;
}): StoreEditorAttentionIssue[] {
  const listed = tracks.filter((track) => track.store_listed);
  const noCover = issueFromSummary(
    summary?.noCover,
    countIssue(listed, (track) => !track.cover_url),
  );
  const noPrice = issueFromSummary(
    summary?.noPrice,
    countIssue(listed, (track) => !hasReadyPrice(track)),
  );
  const noBpmKey = issueFromSummary(
    summary?.noBpmKey,
    countIssue(listed, (track) => track.bpm == null && !track.key),
  );
  const missingPeaks = issueFromSummary(
    summary?.missingPeaks,
    countIssue(listed, (track) => !track.peaks_url),
  );

  return [
    noCover.count > 0 && noCover.firstId && {
      label: 'no cover art',
      count: noCover.count,
      firstId: noCover.firstId,
      kind: 'library' as const,
    },
    noPrice.count > 0 && noPrice.firstId && {
      label: 'no price set',
      count: noPrice.count,
      firstId: noPrice.firstId,
      kind: 'library' as const,
    },
    noBpmKey.count > 0 && noBpmKey.firstId && {
      label: 'no BPM or key',
      count: noBpmKey.count,
      firstId: noBpmKey.firstId,
      kind: 'library' as const,
    },
    missingPeaks.count > 0 && {
      label: 'need real waveforms',
      count: missingPeaks.count,
      firstId: missingPeaks.firstId ?? '',
      kind: 'waveforms' as const,
    },
  ].filter(Boolean) as StoreEditorAttentionIssue[];
}
