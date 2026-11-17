import React, { useState } from 'react';
import { Building2, Loader2, Save, X } from 'lucide-react';
import type { BusinessProfile } from '../types';

interface ProfileModalProps {
  profile: BusinessProfile | null;
  userEmail: string;
  onSave: (data: Omit<BusinessProfile, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  profile,
  userEmail,
  onSave,
  onClose,
}) => {
  const [title, setTitle] = useState(profile?.title || '');
  const [taxId, setTaxId] = useState(profile?.taxId || '');
  const [taxOffice, setTaxOffice] = useState(profile?.taxOffice || '');
  const [address, setAddress] = useState(profile?.address || '');
  const [city, setCity] = useState(profile?.city || '');
  const [district, setDistrict] = useState(profile?.district || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [email, setEmail] = useState(profile?.email || userEmail || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('İşletme unvanı veya ad soyad zorunludur.');
      return;
    }
    const cleanTax = taxId.replace(/\D/g, '');
    if (cleanTax && cleanTax.length !== 10 && cleanTax.length !== 11) {
      setError('VKN 10 haneli, TCKN 11 haneli olmalıdır.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        taxId: cleanTax,
        taxOffice: taxOffice.trim(),
        address: address.trim(),
        city: city.trim(),
        district: district.trim(),
        phone: phone.trim(),
        email: email.trim(),
        iban: profile?.iban || '',
        defaultInvoiceNote: profile?.defaultInvoiceNote || '',
        defaultGibMode: 'live',
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Profil kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-semibold text-slate-100">İşletme Bilgileri</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          <p className="text-xs text-slate-400">
            Bu bilgiler fatura önizlemelerinde satıcı bilgisi olarak kullanılır.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              İşletme Unvanı / Ad Soyad *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn: Yıldız Teknik Hırdavat Ltd. Şti."
              className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                VKN / TCKN
              </label>
              <input
                type="text"
                maxLength={11}
                value={taxId}
                onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ''))}
                placeholder="10 veya 11 hane"
                className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Vergi Dairesi
              </label>
              <input
                type="text"
                value={taxOffice}
                onChange={(e) => setTaxOffice(e.target.value)}
                placeholder="Örn: Kadıköy"
                className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">İl</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="İstanbul"
                className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">İlçe</label>
              <input
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="Kadıköy"
                className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Adres</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Mahalle, cadde, sokak, no"
              className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Telefon</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05XX XXX XX XX"
                className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">E-posta</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@isletme.com"
                className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Kaydet
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
