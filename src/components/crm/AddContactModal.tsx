'use client';

import { useState } from 'react';
import { X, User, Mail, Globe, Tag, Loader2, Phone, FileText } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-[#16130e] border border-[#1f1a13] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="px-6 py-4 border-b border-[#1f1a13] flex justify-between items-center bg-[#0a0907]">
          <h2 className="text-sm font-black uppercase tracking-[0.2em] text-[#E8DCC8]">Add New Contact</h2>
          <button onClick={onClose} className="text-[#4a4338] hover:text-[#E8DCC8] transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Full Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" size={16} />
              <input
                required
                type="text"
                placeholder="E.G. METRO BOOMIN"
                className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 pl-10 pr-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Role</label>
              <input
                type="text"
                placeholder="PRODUCER"
                className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 px-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Label</label>
              <div className="relative">
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" size={14} />
                <input
                  type="text"
                  placeholder="OVO"
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 pl-10 pr-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" size={16} />
              <input
                type="email"
                placeholder="PRODUCER@EXAMLE.COM"
                className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 pl-10 pr-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" size={14} />
                <input
                  type="tel"
                  placeholder="+1 555 0100"
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 pl-10 pr-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Category</label>
              <Dropdown
                value={formData.category || 'none'}
                onChange={(val) => setFormData({ ...formData, category: val === 'none' ? '' : val })}
                options={CONTACT_CATEGORIES.map((c) => ({
                  value: c || 'none',
                  label: c ? c.toUpperCase() : 'NONE',
                }))}
                className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 px-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Instagram</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" size={14} />
                <input
                  type="text"
                  placeholder="METROBOOMIN"
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 pl-10 pr-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                  value={formData.instagram}
                  onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Twitter / X</label>
              <input
                type="text"
                placeholder="@HANDLE"
                className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 px-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                value={formData.twitter}
                onChange={(e) => setFormData({ ...formData, twitter: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338] ml-1">Notes</label>
            <div className="relative">
              <FileText className="absolute left-3 top-3 text-[#4a4338]" size={14} />
              <textarea
                rows={3}
                placeholder="ANY CONTEXT YOU'LL WANT LATER…"
                className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 pl-10 pr-4 text-xs tracking-wider text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors resize-none"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="pt-4">
            <button
              disabled={loading}
              type="submit"
              className="w-full bg-[#D4BFA0] hover:bg-[#8A7A5C] disabled:bg-[#4a4338] text-white py-4 rounded-xl text-xs font-black uppercase tracking-[0.2em] transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Processing
                </>
              ) : (
                'Create Contact'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
