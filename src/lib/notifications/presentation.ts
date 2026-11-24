/**
 * How a PRODUCER bell notification looks and where it goes (DASH-04).
 *
 * One pure module, so the icon / label / tone / link of every kind is decided
 * in one place and a test can prove it is total. The bell (client) renders
 * from it; nothing here imports a server module.
 *
 * Label OS direct asks (`isDirectAskKind`) are the org bell's; they are listed
 * so the producer panel never falls back to a generic bell for them, but their
 * links stay `lib/labelos/notify-links`.
 */
import { isUUID } from '@/lib/uuid';
import { isDirectAskKind } from '@/lib/labelos/notify-kinds';

/** Every kind a producer-bell writer inserts today. A writer adding one fails the test until it is here. */
export const PRODUCER_NOTIFICATION_KINDS = [
  'purchase',
  'refund',
  'dispute',
  'buyer_offer',
  'fulfillment_alert',
  'share_comment',
  'portal_comment',
  'artist_reaction',
  'artist_message',
  'artist_request',
  'portal_upload',
] as const;
export type ProducerNotificationKind = (typeof PRODUCER_NOTIFICATION_KINDS)[number];

export type NotificationTone = 'positive' | 'neutral' | 'warning' | 'danger';

export type NotificationIcon =
  | 'shopping-bag'
  | 'rotate-ccw'
  | 'alert-triangle'
  | 'shield-check'
  | 'tag'
  | 'package-x'
  | 'message-square'
  | 'heart'
  | 'message-circle'
  | 'hand-helping'
  | 'file-up'
  | 'list-checks'
  | 'bell';

export interface NotificationPresentation {
  /** Short mono label, e.g. "Sale". */
  label: string;
  icon: NotificationIcon;
  tone: NotificationTone;
  /** In-app path the row opens, or null when the row has nowhere to go. */
  href: string | null;
}

export interface PresentableNotification {
  kind: string;
  data?: unknown;
}

function dataOf(n: PresentableNotification): Record<string, unknown> {
  return n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : {};
}

function uuidField(d: Record<string, unknown>, key: string): string | null {
  const v = d[key];
  return isUUID(v) ? v : null;
}

/** A dispute row's outcome: the explicit `outcome` the webhook writes, else derived from the Stripe status on older rows. */
export type DisputeOutcome = 'opened' | 'won' | 'lost' | 'inquiry_closed';

export function disputeOutcome(n: PresentableNotification): DisputeOutcome {
  const d = dataOf(n);
  const explicit = d.outcome;
  if (explicit === 'won' || explicit === 'lost' || explicit === 'inquiry_closed' || explicit === 'opened') return explicit;
  const status = d.dispute_status;
  if (status === 'won') return 'won';
  if (status === 'warning_closed') return 'inquiry_closed';
  if (typeof status === 'string' && status) return 'lost';
  return 'opened';
}

/** A refund row is partial when the writer says so, or (older rows) when it recorded the refunded amount of the charge. */
export function isPartialRefund(n: PresentableNotification): boolean {
  const d = dataOf(n);
  return d.outcome === 'partial' || (d.outcome === undefined && 'amount_refunded' in d);
}

function artistHref(d: Record<string, unknown>, tab: string): string | null {
  const contact = uuidField(d, 'contact_id');
  if (contact) return `/contacts/${contact}?tab=${tab}`;
  const project = uuidField(d, 'project_id');
  return project ? `/projects/${project}` : null;
}

export function presentNotification(n: PresentableNotification): NotificationPresentation {
  const d = dataOf(n);
  switch (n.kind) {
    case 'purchase':
      return { label: 'Sale', icon: 'shopping-bag', tone: 'positive', href: '/sales' };
    case 'refund':
      return isPartialRefund(n)
        ? { label: 'Partial refund', icon: 'rotate-ccw', tone: 'warning', href: '/sales' }
        : { label: 'Refund', icon: 'rotate-ccw', tone: 'danger', href: '/sales' };
    case 'dispute': {
      const outcome = disputeOutcome(n);
      if (outcome === 'won') return { label: 'Dispute won', icon: 'shield-check', tone: 'positive', href: '/sales' };
      if (outcome === 'inquiry_closed') return { label: 'Inquiry closed', icon: 'shield-check', tone: 'positive', href: '/sales' };
      if (outcome === 'lost') return { label: 'Dispute lost', icon: 'alert-triangle', tone: 'danger', href: '/sales' };
      return { label: 'Dispute', icon: 'alert-triangle', tone: 'danger', href: '/sales' };
    }
    case 'buyer_offer':
      return { label: 'Offer', icon: 'tag', tone: 'neutral', href: '/sales?view=offers' };
    case 'fulfillment_alert':
      return d.alert_kind === 'mp3_unavailable'
        ? { label: 'Delivery issue', icon: 'package-x', tone: 'warning', href: '/library' }
        : { label: 'Delivery issue', icon: 'package-x', tone: 'warning', href: '/sales' };
    case 'share_comment': {
      const project = uuidField(d, 'project_id');
      return { label: 'Comment', icon: 'message-square', tone: 'neutral', href: project ? `/projects/${project}` : null };
    }
    case 'portal_comment':
      return { label: 'Comment', icon: 'message-square', tone: 'neutral', href: artistHref(d, 'activity') };
    case 'artist_reaction':
      return {
        label: d.decision === 'passed' ? 'Passed' : 'Interested',
        icon: 'heart',
        tone: d.decision === 'passed' ? 'neutral' : 'positive',
        href: artistHref(d, 'beats'),
      };
    case 'artist_message':
      return { label: 'Message', icon: 'message-circle', tone: 'neutral', href: artistHref(d, 'messages') };
    case 'artist_request':
      return { label: 'Request', icon: 'hand-helping', tone: 'neutral', href: artistHref(d, 'messages') };
    case 'portal_upload':
      return { label: 'Upload', icon: 'file-up', tone: 'positive', href: artistHref(d, 'files') };
    default:
      // A Label OS ask is the org bell's; anything else unknown is a plain, linkless row.
      return isDirectAskKind(n.kind)
        ? { label: 'Task', icon: 'list-checks', tone: 'neutral', href: null }
        : { label: 'Notice', icon: 'bell', tone: 'neutral', href: null };
  }
}

/** Money as `$1,234.50`. Non-finite input reads as `$0.00` rather than "NaN". */
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatUsd(amount: number | string | null | undefined): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return USD.format(typeof n === 'number' && Number.isFinite(n) ? n : 0);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const SHORT_DATE_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Relative up to 7 days, then a short date. Future times (clock skew) read "just now". */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  const d = new Date(t);
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return (sameYear ? SHORT_DATE : SHORT_DATE_YEAR).format(d);
}

/** Full timestamp for `title` and screen readers. */
export function formatFullTimestamp(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return '';
  return t.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
