'use client';

import { useState, useEffect } from 'react';
import { Send, Mail, Clock } from 'lucide-react';
import { Contact, Track, BeatSend } from '@/lib/types';
import { toast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

interface NudgeModalProps {
  contact: Contact;
  latestSend: BeatSend;
  onClose: () => void;
  onSuccess: () => void;
}

export function NudgeModal({ contact, latestSend, onClose, onSuccess }: NudgeModalProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(true);

  // Fetch track details so we can construct a smart follow-up message listing the tracks sent
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tracks');
        const data = await res.json();
        const allTracks: Track[] = Array.isArray(data) ? data : data.tracks || [];
        // Filter to tracks sent in this campaign
        const matched = allTracks.filter((t) => latestSend.track_ids.includes(t.id));
        setTracks(matched);

        // Pre-compose a smart, polite, premium follow-up text
        const trackTitles = matched.map((t) => `"${t.title.toUpperCase()}"`).join(', ');
        const initialText = `Hi ${contact.name},\n\nHope all is well! I'm just following up on the tracks I shared with you last week${trackTitles ? ` (${trackTitles})` : ''}.\n\nI saw you had a chance to open the link, and wanted to see if any of these caught your ear or if you'd like to hear something in a different style!\n\nLet me know what you think.\n\nBest,`;
        setMessage(initialText);
      } catch (err) {
        console.error('Failed to load tracks for nudge builder:', err);
      } finally {
        setLoadingTracks(false);
      }
    })();
  }, [contact, latestSend]);

  const handleSendNudge = async () => {
    if (!message.trim() || !contact.email) return;
    setSending(true);

    try {
      // 1. Dispatch the polite follow-up email via our Resend email client integration
      const emailRes = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: contact.id,
          email: contact.email,
          trackIds: latestSend.track_ids,
          shareToken: latestSend.share_token,
          message: message.trim(),
        }),
      });

      if (!emailRes.ok) {
        const errText = await emailRes.text();
        throw new Error(errText || 'Failed to send follow-up email');
      }

      // 2. Bump the pipeline status of the campaign send to "negotiating" or "interested"
      const statusRes = await fetch(`/api/beat_sends/${latestSend.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'negotiating' }),
      });

      if (!statusRes.ok) {
        console.warn('Follow-up email succeeded, but failed to auto-transition CRM status.');
      }

      toast.success('Follow-up email sent and pipeline bumped to negotiating!');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Nudge send failed:', err);
      toast.error('Nudge failed to send', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Nudge campaign follow-up"
      description="Review the draft before sending a polite follow-up email."
      icon={<Mail size={18} aria-hidden="true" />}
      size="lg"
    >
      <div className="space-y-5">
        {/* Campaign Info */}
        <Card className="space-y-2 p-3.5 font-mono text-[11px] text-[var(--text-readable)]">
          <div className="flex justify-between">
            <span>Recipient:</span>
            <span className="font-bold text-[var(--text-primary)]">{contact.name} ({contact.email || 'no email'})</span>
          </div>
          <div className="flex justify-between">
            <span>Last Send Status:</span>
            <span className="text-amber-400 font-bold uppercase">Opened but no reply</span>
          </div>
          <div className="flex justify-between items-center">
            <span>Original Campaign Tracks:</span>
            <span className="text-[#F3E6D1] truncate max-w-[220px]">
              {loadingTracks ? 'Loading...' : tracks.map((t) => t.title.toUpperCase()).join(', ') || 'None'}
            </span>
          </div>
        </Card>

        {/* Message Editor */}
        <Field
          multiline
          label="Draft follow-up email"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={8}
          inputClassName="text-[12px] leading-relaxed normal-case tracking-normal"
        />

        {/* Footer Actions */}
        <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 text-[9px] text-[#9B9282] font-mono">
            <Clock size={10} />
            <span>Sends via Resend Client</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              onClick={onClose}
              variant="secondary"
              size="sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendNudge}
              disabled={sending || !contact.email || loadingTracks}
              loading={sending}
              variant="accent"
              size="sm"
              leadingIcon={<Send size={11} aria-hidden="true" />}
            >
              <span>Send Nudge</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
