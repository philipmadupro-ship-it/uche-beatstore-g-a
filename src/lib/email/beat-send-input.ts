/**
 * ONE place that turns "what the producer is sending" into the subject, the
 * From and the template options of a beat-send email.
 *
 * The SendBeatModal preview and every route that emails a share
 * (`/api/email`, the project invite route) call this with the same inputs, so
 * the preview cannot describe an email the server does not send. The preview
 * differs from the real send in exactly one thing: the share URL, which does
 * not exist until the link is created (`previewShareUrl`).
 *
 * Pure: no env, no I/O. Callers read `RESEND_FROM_EMAIL` and the profile name
 * and hand them in.
 */
import { defaultSubject, type BeatSendEmailOpts } from './beat-send-template';

export type BeatSendKind = 'tracks' | 'project';
export type BeatSendRole = 'viewer' | 'commenter' | 'editor';

export const DEFAULT_PRODUCER_NAME = 'U2C Beatstore';
export const DEFAULT_FROM_ADDRESS = 'onboarding@resend.dev';
/** Stands in for the token in the preview; the real one is minted at send. */
export const PREVIEW_SHARE_TOKEN = 'your-link-token';

export interface BeatSendInputArgs {
  kind: BeatSendKind;
  /** The link the button opens (real, or `previewShareUrl` for the preview). */
  shareUrl: string;
  recipientName: string;
  /** Single track title, "N tracks", or the project name. */
  packTitle: string;
  /** Tracks in the pack; null when unknown (shown as "project"). */
  trackCount: number | null;
  coverUrl?: string | null;
  message?: string | null;
  allowDownloads: boolean;
  /** The share row's `expires_at`; null = never. */
  expiresAt: string | null;
  /** `share.full_playback`; null/undefined = not known, nothing is said. */
  fullPlayback?: boolean | null;
  /** The project share's role; track shares have none. */
  role?: BeatSendRole | null;
  tracks?: Array<{ title: string; bpm?: number | null; key?: string | null; type?: string | null }>;
  /** `creator_profiles.display_name`. */
  producerName?: string | null;
  /** Custom subject typed by the producer; blank = the default. */
  subject?: string | null;
  /** `RESEND_FROM_EMAIL`. */
  fromAddress?: string | null;
}

export interface BeatSendEmailInput {
  subject: string;
  /** Exactly the `from` handed to Resend. */
  from: string;
  producerName: string;
  /** The options `buildBeatSendEmail` renders. */
  template: BeatSendEmailOpts;
}

export function sharePathFor(kind: BeatSendKind, token: string): string {
  return kind === 'project' ? `/projects/share/${token}` : `/share/${token}`;
}

/** The link as the email will carry it, with a placeholder token. */
export function previewShareUrl(kind: BeatSendKind, origin: string): string {
  return `${origin.replace(/\/+$/, '')}${sharePathFor(kind, PREVIEW_SHARE_TOKEN)}`;
}

export function trackCountLabel(count: number | null, kind: BeatSendKind): string {
  if (count == null) return kind === 'project' ? 'project' : '';
  return `${count} track${count === 1 ? '' : 's'}`;
}

export function playbackLabel(fullPlayback: boolean | null | undefined): string {
  if (fullPlayback === true) return 'Full tracks';
  if (fullPlayback === false) return '75-second previews';
  return '';
}

/** What a commenter / editor may do; a viewer needs no note. */
export function accessNoteFor(role: BeatSendRole | null | undefined): string | null {
  if (role === 'commenter') return 'You can leave feedback on this project.';
  if (role === 'editor') return 'You can comment and edit.';
  return null;
}

export function beatSendEmailInput(args: BeatSendInputArgs): BeatSendEmailInput {
  const producerName = args.producerName?.trim() || DEFAULT_PRODUCER_NAME;
  const packTitle = args.packTitle.trim() || 'New music';
  const subject = args.subject?.trim()
    ? args.subject.trim().slice(0, 200)
    : defaultSubject(producerName, packTitle, args.kind);
  const packMeta = [trackCountLabel(args.trackCount, args.kind), playbackLabel(args.fullPlayback)]
    .filter(Boolean)
    .join(' · ');

  return {
    subject,
    from: args.fromAddress?.trim() || DEFAULT_FROM_ADDRESS,
    producerName,
    template: {
      recipientName: args.recipientName,
      shareUrl: args.shareUrl,
      packTitle,
      packMeta,
      coverUrl: args.coverUrl ?? null,
      message: (args.message ?? '').trim(),
      allowDownloads: args.allowDownloads,
      expiresAt: args.expiresAt,
      kind: args.kind,
      tracks: args.kind === 'tracks' ? (args.tracks ?? []) : [],
      producerName,
      accessNote: accessNoteFor(args.role),
    },
  };
}
