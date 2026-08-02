'use client';

/**
 * Contains a crash inside one globally-mounted widget.
 *
 * The dashboard layout mounts several always-on widgets — the player, the
 * uploads tray, the media-session bridge, the stem warmup. React unmounts the
 * ENTIRE tree when a render or effect throws, so before this existed, one bad
 * value in any of them blanked every dashboard route at once. That is not
 * hypothetical: a single malformed upload entry in localStorage threw inside
 * `UploadsTray`'s hydrate effect and took down library, projects, sales and
 * settings together — on every reload, because the bad value was persisted.
 *
 * The root cause of that specific crash is fixed in `persisted-uploads.ts`.
 * This is the second layer: an accessory widget failing should cost the user
 * that widget, never the page they were working on.
 *
 * Deliberately silent in the UI. These are ambient widgets — a player bar that
 * failed to render has no useful "try again" for the user, and an error card
 * bolted to the bottom of every page would be worse than its absence. The
 * failure goes to the logger instead, where it can actually be acted on.
 */

import { Component, type ReactNode } from 'react';
import { createLogger } from '@/lib/log';

const log = createLogger('ui.widget-boundary');

interface Props {
  /** Widget name, for the log line. */
  name: string;
  children: ReactNode;
  /** Rendered in place of the widget after a crash. Defaults to nothing. */
  fallback?: ReactNode;
}

interface State {
  failed: boolean;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    log.error('widget crashed and was contained', {
      widget: this.props.name,
      error: error.message,
      stack: error.stack,
      componentStack: info?.componentStack ?? null,
    });
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
