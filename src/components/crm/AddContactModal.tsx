'use client';

import { useState } from 'react';
import { User, Mail, Globe, Tag, Phone, FileText } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

// Order matters — the first five (after the blank) are the CRM
// "segments" the /contacts page filters by (rappers / producers / a&r
// / friends). The rest are legacy categories kept for back-compat
// with imported CSVs and pre-segmentation contacts.
const CONTACT_CATEGORIES = [
  '', 'rapper', 'producer', 'a&r', 'label', 'friend',
  'artist', 'manager', 'dj', 'curator', 'engineer', 'press', 'other',
] as const;

interface AddContactModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function AddContactModal({ onClose, onSuccess }: AddContactModalProps) {
  const [loading, setLoading] = useState(false);
  // The Contact schema supports far more than the previous 5 fields. The
  // category and notes columns in particular drive the CRM filters /
  // search — without them, hand-added contacts couldn't be filtered.
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: '',
    label: '',
    category: '',
    instagram: '',
    twitter: '',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Strip empty strings so we don't write blank columns. Postgres
      // treats '' and null differently, and the contact filters in
      // ContactsView treat null as "field not set" but '' as "set".
      const payload = Object.fromEntries(
        Object.entries(formData).filter(([, v]) => v !== ''),
      );
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to add contact (HTTP ${res.status})`);
      }
      
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error adding contact:', err);
      toast.error('Could not add contact', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Add new contact"
      description="Capture the artist, role, socials, and notes you will need before sending beats."
      icon={<User size={18} aria-hidden="true" />}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          required
          type="text"
          label="Full name"
          placeholder="E.G. METRO BOOMIN"
          icon={<User size={16} />}
          inputClassName="uppercase tracking-widest"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            type="text"
            label="Role"
            placeholder="PRODUCER"
            inputClassName="uppercase tracking-widest"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
          />
          <Field
            type="text"
            label="Label"
            placeholder="OVO"
            icon={<Tag size={14} />}
            inputClassName="uppercase tracking-widest"
            value={formData.label}
            onChange={(e) => setFormData({ ...formData, label: e.target.value })}
          />
        </div>

        <Field
          type="email"
          label="Email address"
          placeholder="PRODUCER@EXAMPLE.COM"
          icon={<Mail size={16} />}
          inputClassName="uppercase tracking-widest"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            type="tel"
            label="Phone"
            placeholder="+1 555 0100"
            icon={<Phone size={14} />}
            inputClassName="uppercase tracking-widest"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
          <div className="space-y-1.5">
            <label className="ml-1 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-readable)]">
              Category
            </label>
            <Dropdown
              value={formData.category || 'none'}
              onChange={(val) => setFormData({ ...formData, category: val === 'none' ? '' : val })}
              options={CONTACT_CATEGORIES.map((c) => ({
                value: c || 'none',
                label: c ? c.toUpperCase() : 'NONE',
              }))}
              aria-label="Contact category"
              className="min-h-11 w-full rounded-xl border-[var(--border)] bg-[var(--bg-page)] px-4 py-3 text-xs uppercase tracking-widest text-[var(--text-primary)] focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            type="text"
            label="Instagram"
            placeholder="METROBOOMIN"
            icon={<Globe size={14} />}
            inputClassName="uppercase tracking-widest"
            value={formData.instagram}
            onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
          />
          <Field
            type="text"
            label="Twitter / X"
            placeholder="@HANDLE"
            inputClassName="uppercase tracking-widest"
            value={formData.twitter}
            onChange={(e) => setFormData({ ...formData, twitter: e.target.value })}
          />
        </div>

        <Field
          multiline
          rows={3}
          label="Notes"
          placeholder="ANY CONTEXT YOU'LL WANT LATER..."
          icon={<FileText size={14} />}
          inputClassName="tracking-wider"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
        />

        <div className="pt-2">
          <Button loading={loading} type="submit" variant="accent" className="w-full">
            {loading ? 'Processing' : 'Create contact'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
