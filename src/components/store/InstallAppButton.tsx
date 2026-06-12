'use client';

/**
 * "Install app" pill — captures the browser's `beforeinstallprompt`
 * event and shows a discrete install button only when the platform
 * supports PWA install (Chrome, Edge, Brave, modern Android). Hides
 * itself once installed or dismissed. iOS doesn't fire the event;
 * those users install via Share → Add to Home Screen and never see
 * the button — that's the correct behaviour, not a bug.
 */

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'antigravity-install-dismissed';

export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }
    if (localStorage.getItem(DISMISSED_KEY) === '1') return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || !deferred) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await deferred.prompt();
          const choice = await deferred.userChoice;
          if (choice.outcome === 'dismissed') {
            localStorage.setItem(DISMISSED_KEY, '1');
          }
        } finally {
          setDeferred(null);
        }
      }}
      className="hidden sm:flex fixed bottom-[7rem] sm:bottom-[8rem] left-4 sm:left-6 z-[60] items-center gap-1.5 px-3 py-2 rounded-full bg-[#171511]/85 backdrop-blur-xl border border-white/[0.10] text-[#F7EBDD] text-[10px] font-mono uppercase tracking-[0.18em] hover:bg-[#211F1A]/90 transition-colors"
      title="Install this app to your home screen"
    >
      <Download size={11} />
      Install app
    </button>
  );
}
