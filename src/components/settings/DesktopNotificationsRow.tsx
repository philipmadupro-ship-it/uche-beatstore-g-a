'use client';

import { useEffect, useState } from 'react';
import { toast } from '@/hooks/useToast';
import {
  desktopPermission,
  desktopPrefEnabled,
  setDesktopPref,
  type DesktopPermission,
} from '@/lib/notifications/desktop';

/**
 * Switch for OS-level notifications.
 *
 * Two conditions have to hold, and the row says which one is missing rather
 * than silently doing nothing: the browser must have granted permission, and
 * the producer must have asked for this. Permission alone is not consent to
 * keep interrupting someone.
 *
 * Both live on the device, not the account. Notification permission is granted
 * per browser, so a server-side flag would claim the studio Mac's answer also
 * covers the laptop, where the OS was never asked.
 *
 * Reads happen after mount because `Notification.permission` and localStorage
 * do not exist during the server render, and rendering a state the client then
 * contradicts is a hydration mismatch.
 */
export function DesktopNotificationsRow() {
  const [permission, setPermission] = useState<DesktopPermission>('unsupported');
  const [enabled, setEnabled] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    setPermission(desktopPermission());
    setEnabled(desktopPrefEnabled());
  }, []);

  const on = enabled && permission === 'granted';

  const toggle = async () => {
    if (on) {
      setDesktopPref(false);
      setEnabled(false);
      return;
    }

    if (permission === 'unsupported') {
      toast.warning('This browser has no notification support');
      return;
    }

    if (permission === 'denied') {
      // Only the user can undo this, and only in browser settings — the API
      // will not prompt again once denied, so saying "allow" would be a lie.
      toast.warning(
        'Notifications are blocked for this site',
        'Allow them in your browser’s site settings, then switch this on again.',
      );
      return;
    }

    if (permission === 'default') {
      setAsking(true);
      try {
        const result = await Notification.requestPermission();
        setPermission(result as DesktopPermission);
        if (result !== 'granted') {
          toast.warning('Notifications not enabled');
          return;
        }
      } finally {
        setAsking(false);
      }
    }

    setDesktopPref(true);
    setEnabled(true);
    // Prove it works immediately: a switch that claims to be on and produces
    // nothing until a sale happens is untestable by the person flipping it.
    try {
      new Notification('Notifications are on', {
        body: 'Sales and opened links will show up here.',
        icon: '/icon.svg',
        tag: 'antigravity-test',
      });
    } catch {/* granted but refused by the OS; the switch is still on */}
  };

  const description =
    permission === 'unsupported' ? 'Not supported in this browser'
      : permission === 'denied' ? 'Blocked — allow this site in browser settings'
      : on ? 'Sales and opened links, while a tab is open'
      : 'Get told about sales without watching the tab';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={asking || permission === 'unsupported'}
      className="flex w-full cursor-pointer items-center justify-between bg-white/[0.02] px-6 py-4 text-left transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50"
      onClick={toggle}
    >
      <div>
        <p className="text-[12px] font-medium text-white">Desktop notifications</p>
        <p className="mt-0.5 text-[10px] text-[var(--text-readable)]">{description}</p>
      </div>
      <div className={`w-9 h-5 rounded-full relative transition-colors ${on ? 'bg-[#6DC6A4]' : 'bg-white/[0.05] border border-white/20'}`}>
        <div className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${on ? 'right-[3px] bg-[#090907]' : 'left-[3px] bg-white/40'}`} />
      </div>
    </button>
  );
}
