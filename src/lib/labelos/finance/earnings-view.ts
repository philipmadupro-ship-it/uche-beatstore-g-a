/**
 * What an earnings row looks like to the person reading it (LABEL-62). Pure;
 * rows are built field by field, never spread. Money leaves as a DECIMAL STRING
 * of minor units. A review line carries its reason as a code AND words.
 */
import { isReviewReason, REVIEW_REASON_LABEL, type ReviewReason } from './earnings-calc';
import { minorFromDb } from './money';

type ImportInput = {
  id: string; period_id: string | null; source: string; file_name: string | null; currency: string; row_count: number; total_minor: unknown; status: string; created_at: string;
};
type LineInput = {
  id: string; import_id: string; line_no: number; isrc: string | null; upc: string | null; title: string | null; store: string | null; territory: string | null;
  gross_minor: unknown; currency: string; track_id: string | null; song_track_id: string | null; income_class: string; review_reason: ReviewReason | string | null;
};
type TotalInput = { payee_id: string; artist_contact_id: string | null; currency: string; share_minor: bigint; payable_minor: bigint; retained_minor: bigint; recouped_minor: bigint; net_minor: bigint };

export const importView = (r: ImportInput) => ({
  id: r.id,
  period_id: r.period_id,
  source: r.source,
  file_name: r.file_name,
  currency: r.currency.trim(),
  row_count: r.row_count,
  total_minor: minorFromDb(r.total_minor).toString(),
  status: r.status,
  created_at: r.created_at,
});

export const reviewLineView = (l: LineInput) => {
  const reason = isReviewReason(l.review_reason) ? l.review_reason : null;
  return {
    id: l.id,
    import_id: l.import_id,
    line_no: l.line_no,
    isrc: l.isrc,
    upc: l.upc,
    title: l.title,
    store: l.store,
    territory: l.territory,
    gross_minor: minorFromDb(l.gross_minor).toString(),
    currency: l.currency.trim(),
    matched: l.track_id !== null,
    income_class: l.income_class,
    reason,
    reason_label: reason ? REVIEW_REASON_LABEL[reason] : null,
  };
};

export const totalView = (t: TotalInput) => ({
  payee_id: t.payee_id,
  artist_contact_id: t.artist_contact_id,
  currency: t.currency,
  share_minor: t.share_minor.toString(),
  payable_minor: t.payable_minor.toString(),
  retained_minor: t.retained_minor.toString(),
  recouped_minor: t.recouped_minor.toString(),
  net_minor: t.net_minor.toString(),
});
