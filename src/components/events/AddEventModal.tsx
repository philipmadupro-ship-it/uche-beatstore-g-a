'use client';

import { useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

interface AddEventModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialDate?: Date;
}

export function AddEventModal({ onClose, onSuccess, initialDate }: AddEventModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    date: initialDate ? initialDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    type: 'release',
    notes: '',
    color: '#E7D7BE'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          date: new Date(formData.date).toISOString()
        }),
      });

      if (!res.ok) throw new Error('Failed to add event');
      
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error adding event:', err);
      toast.error('Could not add event', 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Schedule event"
      description="Add a release, studio session, meeting, or deadline to the producer calendar."
      icon={<Calendar size={18} aria-hidden="true" />}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          required
          type="text"
          label="Event title"
          placeholder="E.G. DANGER BEAT RELEASE"
          inputClassName="uppercase tracking-widest"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="ml-1 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-readable)]">
              Category
            </label>
            <Dropdown
              value={formData.type}
              onChange={(val) => setFormData({ ...formData, type: val })}
              options={[
                { value: 'release', label: 'Release' },
                { value: 'studio', label: 'Studio Session' },
                { value: 'meeting', label: 'Meeting' },
                { value: 'other', label: 'Other' }
              ]}
              aria-label="Event category"
              className="min-h-11 w-full rounded-xl border-[var(--border)] bg-[var(--bg-page)] px-4 py-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent)]"
            />
          </div>
          <Field
            type="date"
            label="Date"
            inputClassName="uppercase tracking-widest"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <p className="ml-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-readable)]">
            Color palette
          </p>
          <div className="flex gap-2">
            {['#E7D7BE', '#4CAF50', '#FF9800', '#F44336', '#2196F3'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFormData({ ...formData, color: c })}
                aria-label={`Use ${c} event color`}
                aria-pressed={formData.color === c}
                className={`tap size-8 rounded-full border-2 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-page)] ${formData.color === c ? 'scale-110 border-white' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <Field
          multiline
          label="Private notes"
          placeholder="ADDITIONAL DETAILS OR LOGISTICS..."
          inputClassName="uppercase tracking-widest"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
        />

        <div className="pt-2">
          <Button
            loading={loading}
            type="submit"
            variant="accent"
            className="w-full"
            leadingIcon={<Clock size={16} aria-hidden="true" />}
          >
            {loading ? 'Processing' : 'Schedule entry'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
