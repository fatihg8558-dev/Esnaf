import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Landmark,
  Loader2,
  LogOut,
  Plus,
  Save,
  ShieldCheck,
  Tag,
  Trash2,
} from 'lucide-react';
import type {
  BusinessProfile,
  ExpenseCategory,
  GibCredential,
  GibSessionState,
} from '../types';
import { EXPENSE_CATEGORIES } from '../utils/formatters';
import { gibEncryptCredentials, gibLogin, gibLoginSaved } from '../services/gibClient';

interface SettingsViewProps {
  profile: BusinessProfile | null;
  userEmail: string;
  gibSession: GibSessionState;
  savedGibCred: GibCredential | null;
  gibAutoConnecting: boolean;
  gibAutoError: string | null;
  customExpenseCategories: ExpenseCategory[];
  onClearGibAutoError: () => void;
  onResetManualLogout: () => void;
  onEnableGibAutoConnect: () => Promise<void>;
  onSafeGibLogout: () => Promise<void>;
  onGibSessionChange: (session: GibSessionState) => void;
  onSaveGibCredential: (
    cred: Pick<GibCredential, 'userCode' | 'encryptedSecret' | 'mode' | 'autoConnect'>
  ) => Promise<void>;
  onDeleteGibCredential: () => Promise<void>;
  onAddExpenseCategory: (name: string) => Promise<void>;
  onDeleteExpenseCategory: (id: string) => Promise<void>;
  onSaveBusinessProfile: (
    input: Omit<BusinessProfile, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onNotify: (msg: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  userEmail,
  gibSession,
  savedGibCred,
  gibAutoConnecting,
  gibAutoError,
  customExpenseCategories,
  onClearGibAutoError,
  onResetManualLogout,
  onEnableGibAutoConnect,
  onSafeGibLogout,
  onGibSessionChange,
  onSaveGibCredential,
  onDeleteGibCredential,
  onAddExpenseCategory,
  onDeleteExpenseCategory,
  onSaveBusinessProfile,
  onNotify,
}) => {
  // GİB Login State
  const [userCode, setUserCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberCredentials, setRememberCredentials] = useState(true);
  const [showManualForm, setShowManualForm] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [confirmingDeleteCred, setConfirmingDeleteCred] = useState(false);
  const [deletingCred, setDeletingCred] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Expense Category State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);

  // Business Profile State
  const [title, setTitle] = useState(profile?.title || '');
  const [taxId, setTaxId] = useState(profile?.taxId || '');
  const [taxOffice, setTaxOffice] = useState(profile?.taxOffice || '');
  const [city, setCity] = useState(profile?.city || '');
  const [district, setDistrict] = useState(profile?.district || '');
  const [address, setAddress] = useState(profile?.address || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [email, setEmail] = useState(profile?.email || userEmail || '');
  const [iban, setIban] = useState(profile?.iban || '');
  const [defaultInvoiceNote, setDefaultInvoiceNote] = useState(profile?.defaultInvoiceNote || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingInvoiceDefaults, setSavingInvoiceDefaults] = useState(false);

  const [savingCredOnly, setSavingCredOnly] = useState(false);

  useEffect(() => {
    if (savedGibCred?.userCode && !userCode) {
      setUserCode(savedGibCred.userCode);
    }
  }, [savedGibCred?.userCode, userCode]);

  useEffect(() => {
    if (!profile) return;
    setTitle(profile.title || '');
    setTaxId(profile.taxId || '');
    setTaxOffice(profile.taxOffice || '');
    setCity(profile.city || '');
    setDistrict(profile.district || '');
    setAddress(profile.address || '');
    setPhone(profile.phone || '');
    setEmail(profile.email || userEmail || '');
    setIban(profile.iban || '');
    setDefaultInvoiceNote(profile.defaultInvoiceNote || '');
  }, [profile, userEmail]);

  const handleSaveCredOnly = async () => {
    const cleanCode = userCode.trim();
    if (!cleanCode || !password) {
      setLoginError('Kaydetmek için GİB kullanıcı kodu ve şifre alanlarını doldurun.');
      return;
    }
    setLoginError(null);
    onClearGibAutoError();
    setSavingCredOnly(true);
    try {
      const resp = await gibEncryptCredentials(cleanCode, password);
      if (!resp.ok || !resp.encryptedSecret) {
        setLoginError(resp.error || 'GİB bilgileri şifrelenip kaydedilemedi.');
        return;
      }
      await onSaveGibCredential({
        userCode: resp.userCode || cleanCode,
        encryptedSecret: resp.encryptedSecret,
        mode: 'live',
        autoConnect: true,
      });
      setShowManualForm(false);
      setConfirmingDeleteCred(false);
      onNotify('GİB kullanıcı kodu ve şifreniz kalıcı olarak kaydedildi (silinmez).');
    } catch (err: any) {
      setLoginError(err?.message || 'GİB bilgileri kaydedilirken hata oluştu.');
    } finally {
      setSavingCredOnly(false);
    }
  };

  const handleGibLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    onClearGibAutoError();
    setLoginLoading(true);
    try {
      const resp = await gibLogin({
        mode: 'live',
        userCode: userCode.trim(),
        password,
        rememberCredentials,
        profileFallback: profile
          ? {
              title: profile.title,
              taxId: profile.taxId,
              taxOffice: profile.taxOffice,
              address: profile.address,
              city: profile.city,
              district: profile.district,
            }
          : undefined,
      });

      if (!resp.ok || !resp.sessionId) {
        setLoginError(resp.error || 'GİB oturumu açılamadı.');
        return;
      }

      onResetManualLogout();
      onGibSessionChange({
        connected: true,
        sessionId: resp.sessionId,
        mode: 'live',
        userCode: resp.userCode || userCode.trim(),
        sellerInfo: resp.sellerInfo,
      });

      if (rememberCredentials && resp.encryptedSecret) {
        await onSaveGibCredential({
          userCode: resp.userCode || userCode.trim(),
          encryptedSecret: resp.encryptedSecret,
          mode: 'live',
          autoConnect: true,
        });
        onNotify('GİB oturumu açıldı ve şifreniz kalıcı olarak kaydedildi.');
      } else {
        onNotify('GİB canlı oturumu açıldı.');
      }

      setShowManualForm(false);
      setConfirmingDeleteCred(false);
    } catch (err: any) {
      setLoginError(err?.message || 'GİB bağlantı hatası.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSavedGibConnect = async () => {
    if (!savedGibCred) return;
    setLoginError(null);
    onClearGibAutoError();
    setConfirmingDeleteCred(false);
    setLoginLoading(true);
    try {
      const resp = await gibLoginSaved({
        mode: 'live',
        userCode: savedGibCred.userCode,
        encryptedSecret: savedGibCred.encryptedSecret,
        profileFallback: profile
          ? {
              title: profile.title,
              taxId: profile.taxId,
              taxOffice: profile.taxOffice,
              address: profile.address,
              city: profile.city,
              district: profile.district,
            }
          : undefined,
      });

      if (!resp.ok || !resp.sessionId) {
        setLoginError(resp.error || 'Kayıtlı GİB bilgileri ile oturum açılamadı.');
        return;
      }

      onResetManualLogout();
      await onEnableGibAutoConnect();
      onGibSessionChange({
        connected: true,
        sessionId: resp.sessionId,
        mode: 'live',
        userCode: resp.userCode || savedGibCred.userCode,
        sellerInfo: resp.sellerInfo,
      });
      onNotify('Kayıtlı GİB bilgileri ile oturum açıldı.');
    } catch (err: any) {
      setLoginError(err?.message || 'GİB bağlantı hatası.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleDeleteSavedCred = async () => {
    setDeletingCred(true);
    setLoginError(null);
    try {
      await onDeleteGibCredential();
      setConfirmingDeleteCred(false);
      setShowManualForm(true);
    } finally {
      setDeletingCred(false);
    }
  };

  const handleGibLogout = async () => {
    setLogoutLoading(true);
    setConfirmingDeleteCred(false);
    try {
      await onSafeGibLogout();
    } finally {
      setLogoutLoading(false);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    const existsInBuiltIn = EXPENSE_CATEGORIES.some(
      (c) => c.toLocaleLowerCase('tr') === trimmed.toLocaleLowerCase('tr')
    );
    const existsInCustom = customExpenseCategories.some(
      (c) => c.name.toLocaleLowerCase('tr') === trimmed.toLocaleLowerCase('tr')
    );
    if (existsInBuiltIn || existsInCustom) {
      setCatError('Bu gider kalemi zaten tanımlı.');
      return;
    }

    setCatError(null);
    setAddingCat(true);
    try {
      await onAddExpenseCategory(trimmed);
      setNewCategoryName('');
    } catch (err: any) {
      setCatError(err?.message || 'Gider kalemi eklenemedi.');
    } finally {
      setAddingCat(false);
    }
  };

  const handleSaveProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await onSaveBusinessProfile({
        title: title.trim() || 'Esnaf İşletmem',
        taxId: taxId.replace(/\D/g, ''),
        taxOffice: taxOffice.trim(),
        city: city.trim(),
        district: district.trim(),
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        iban: iban.trim().toUpperCase(),
        defaultInvoiceNote: defaultInvoiceNote.trim(),
        defaultGibMode: 'live',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveInvoiceDefaultsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingInvoiceDefaults(true);
    try {
      await onSaveBusinessProfile({
        title: title.trim() || profile?.title || 'Esnaf İşletmem',
        taxId: taxId.replace(/\D/g, '') || profile?.taxId || '',
        taxOffice: taxOffice.trim() || profile?.taxOffice || '',
        city: city.trim() || profile?.city || '',
        district: district.trim() || profile?.district || '',
        address: address.trim() || profile?.address || '',
        phone: phone.trim() || profile?.phone || '',
        email: email.trim() || profile?.email || userEmail || '',
        iban: iban.trim().toUpperCase(),
        defaultInvoiceNote: defaultInvoiceNote.trim(),
        defaultGibMode: 'live',
      });
    } finally {
      setSavingInvoiceDefaults(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-100">Ayarlar &amp; Entegrasyonlar</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          GİB e-Arşiv Portal giriş bilgileriniz, özel gider kalemleri ve işletme profiliniz
        </p>
      </div>

      {/* Section 1: GİB Portal Bilgileri */}
      <section className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                GİB e-Arşiv Portal Bilgileri
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                earsivportal.efatura.gov.tr kullanıcı kodu ve şifre yönetimi
              </p>
            </div>
          </div>
          <span
            className={`text-xs font-semibold whitespace-nowrap self-start sm:self-center ${
              gibSession.connected ? 'text-emerald-400' : 'text-slate-400'
            }`}
          >
            {gibSession.connected ? 'Canlı Oturum Aktif' : 'Oturum Kapalı'}
          </span>
        </div>

        {gibAutoConnecting && (
          <div className="bg-blue-500/10 border border-blue-500/30 text-blue-200 text-xs rounded-lg px-4 py-3 flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
            <span>Kayıtlı GİB bilgileri ile bağlanılıyor...</span>
          </div>
        )}

        {(loginError || gibAutoError) && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-4 py-3">
            {loginError || gibAutoError}
          </div>
        )}

        {gibSession.connected ? (
          <div className="bg-[#0B1120] border border-emerald-500/30 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Canlı GİB Portalına Bağlı
                  </div>
                  <div className="text-xs text-slate-400">
                    {gibSession.sellerInfo?.title || profile?.title || 'Esnaf İşletmem'} · Kullanıcı Kodu:{' '}
                    <span className="font-mono-num text-slate-200">{gibSession.userCode}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {savedGibCred && !confirmingDeleteCred && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteCred(true)}
                    disabled={deletingCred}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Kayıtlı Şifreyi Sil
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleGibLogout}
                  disabled={logoutLoading}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {logoutLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogOut className="w-3.5 h-3.5" />
                  )}
                  GİB Portaldan Güvenli Çıkış
                </button>
              </div>
            </div>

            {savedGibCred && confirmingDeleteCred && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-red-200">
                  Kayıtlı GİB kullanıcı kodu ve şifreniz kalıcı olarak silinecek. Onaylıyor musunuz?
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteCred(false)}
                    disabled={deletingCred}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg whitespace-nowrap"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSavedCred}
                    disabled={deletingCred}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
                  >
                    {deletingCred && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Evet, Kalıcı Olarak Sil
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : savedGibCred && !showManualForm ? (
          <div className="bg-[#0B1120] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-100">
                    Kayıtlı GİB Hesabı Hazır
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  Kullanıcı Kodu:{' '}
                  <span className="font-mono-num text-slate-200 font-semibold">
                    {savedGibCred.userCode}
                  </span>{' '}
                  · Ortam: <span className="text-blue-400 font-medium">Canlı GİB Portal</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Şifreniz AES-256 ile şifrelenmiş olarak hesabınızda saklanır; güvenli çıkışta silinmez.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSavedGibConnect}
                  disabled={loginLoading || gibAutoConnecting}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {(loginLoading || gibAutoConnecting) && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  Kayıtlı Bilgilerle Bağlan
                </button>
                {!confirmingDeleteCred && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteCred(true)}
                    disabled={deletingCred}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Kayıtlı Şifreyi Sil
                  </button>
                )}
              </div>
            </div>

            {confirmingDeleteCred && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-red-200">
                  Kayıtlı GİB kullanıcı kodu ve şifreniz kalıcı olarak silinecek. Onaylıyor musunuz?
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteCred(false)}
                    disabled={deletingCred}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg whitespace-nowrap"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSavedCred}
                    disabled={deletingCred}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
                  >
                    {deletingCred && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Evet, Kalıcı Olarak Sil
                  </button>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                Farklı bir GİB kullanıcı kodu girmek veya şifre güncellemek için formu açabilirsiniz.
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!userCode) setUserCode(savedGibCred.userCode);
                  setConfirmingDeleteCred(false);
                  setShowManualForm(true);
                }}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
              >
                Bilgileri Güncelle / Farklı Hesap
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleGibLogin} className="space-y-4">
            {savedGibCred && (
              <div className="flex items-center justify-between text-xs text-slate-400 bg-[#0B1120] border border-slate-800 rounded-lg px-3.5 py-2.5">
                <span>GİB kullanıcı kodunu güncelliyor veya farklı hesapla giriş yapıyorsunuz.</span>
                <button
                  type="button"
                  onClick={() => setShowManualForm(false)}
                  className="text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
                >
                  Kayıtlı Hesaba Dön ({savedGibCred.userCode})
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  GİB Kullanıcı Kodu *
                </label>
                <input
                  type="text"
                  value={userCode}
                  onChange={(e) => setUserCode(e.target.value)}
                  placeholder="Örn: 33333302"
                  className="w-full px-3.5 py-2.5 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  GİB Şifre *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-3.5 pr-10 py-2.5 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                    aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <label className="inline-flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberCredentials}
                onChange={(e) => setRememberCredentials(e.target.checked)}
                className="rounded border-slate-600 bg-[#0B1120] text-blue-500 focus:ring-blue-500"
              />
              <span>GİB Kullanıcı Kodu ve Şifremi Kaydet (Her seferinde sorma)</span>
            </label>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Şifreniz AES-256 ile şifrelenerek kalıcı saklanır; oturumu kapatsanız bile silinmez.
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSaveCredOnly}
                  disabled={savingCredOnly || loginLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {savingCredOnly ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Sadece Şifreyi Kaydet
                </button>
                <button
                  type="submit"
                  disabled={loginLoading || savingCredOnly}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {loginLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  GİB Portalına Bağlan &amp; Kaydet
                </button>
              </div>
            </div>
          </form>
        )}
      </section>

      {/* Section 1b: Fatura Altı Sabit Bilgileri (IBAN & Sabit Açıklama) */}
      <section className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3 border-b border-slate-800 pb-4">
          <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-cyan-400 shrink-0">
            <Landmark className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Fatura IBAN &amp; Sabit Açıklama Ayarları
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Burada kaydettiğiniz IBAN ve sabit açıklama metni, kestiğiniz her e-Arşiv faturanın not kısmına otomatik eklenir
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveInvoiceDefaultsSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Banka IBAN Numarası
            </label>
            <input
              type="text"
              maxLength={40}
              value={iban}
              onChange={(e) => setIban(e.target.value.toUpperCase())}
              placeholder="Örn: TR12 0006 2000 0000 0006 2999 01 (Banka Adı)"
              className="w-full px-3.5 py-2.5 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Sabit Fatura Açıklaması (Varsayılan Not)
            </label>
            <textarea
              rows={3}
              maxLength={300}
              value={defaultInvoiceNote}
              onChange={(e) => setDefaultInvoiceNote(e.target.value)}
              placeholder="Örn: Ödemelerinizi yukarıdaki IBAN hesabına yapabilirsiniz. Fatura tarihinden itibaren 7 gün vadelidir."
              className="w-full px-3.5 py-2.5 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Fatura toplamı ayrıca otomatik olarak &ldquo;YALNIZ ... TÜRK LİRASIDIR.&rdquo; şeklinde faturaya yazılır.
            </p>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <button
              type="submit"
              disabled={savingInvoiceDefaults}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              {savingInvoiceDefaults ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              IBAN ve Sabit Açıklamayı Kaydet
            </button>
          </div>
        </form>
      </section>

      {/* Section 2: Gider Kalemleri Yönetimi */}
      <section className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3 border-b border-slate-800 pb-4">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 shrink-0">
            <Tag className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">Gider Kalemleri Yönetimi</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Gelir-Gider defterinde gider eklerken seçebileceğiniz özel gider kalemleri ekleyin
            </p>
          </div>
        </div>

        <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            maxLength={80}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Yeni gider kalemi adı (Örn: Personel Yemek, Araç Bakım, Reklam)"
            className="flex-1 px-3.5 py-2.5 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
            required
          />
          <button
            type="submit"
            disabled={addingCat || !newCategoryName.trim()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {addingCat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Gider Kalemi Ekle
          </button>
        </form>

        {catError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5">
            {catError}
          </div>
        )}

        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-300">
            Özel Gider Kalemleriniz ({customExpenseCategories.length})
          </div>
          {customExpenseCategories.length === 0 ? (
            <p className="text-xs text-slate-500">
              Henüz özel gider kalemi eklemediniz. Yukarıdan işletmenize özel gider kalemleri tanımlayabilirsiniz.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {customExpenseCategories.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between gap-2 bg-[#0B1120] border border-slate-800 rounded-lg px-3.5 py-2.5"
                >
                  <span className="text-xs font-medium text-slate-200 truncate">{cat.name}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteExpenseCategory(cat.id)}
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors shrink-0"
                    title="Kalemi Sil"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-slate-800 space-y-2">
          <div className="text-xs font-semibold text-slate-400">Varsayılan Sistem Gider Kalemleri</div>
          <div className="flex flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((name) => (
              <span
                key={name}
                className="px-2.5 py-1 bg-[#0B1120] border border-slate-800 rounded-md text-[11px] text-slate-400"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Section 3: İşletme Profili */}
      <section className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3 border-b border-slate-800 pb-4">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">İşletme Kimlik Bilgileri</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              e-Arşiv fatura PDF ve cari ekstre başlıklarında kullanılan işletme bilgileri
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveProfileSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                İşletme Unvanı / Ad Soyad *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn: Yılmaz Ticaret Ltd. Şti."
                className="w-full px-3.5 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                required
              />
            </div>

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
                className="w-full px-3.5 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Vergi Dairesi
              </label>
              <input
                type="text"
                value={taxOffice}
                onChange={(e) => setTaxOffice(e.target.value)}
                placeholder="Örn: Kadıköy"
                className="w-full px-3.5 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">İl</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="İstanbul"
                className="w-full px-3.5 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">İlçe</label>
              <input
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="Kadıköy"
                className="w-full px-3.5 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Telefon</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05XX XXX XX XX"
                className="w-full px-3.5 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">E-posta</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="iletisim@firma.com"
                className="w-full px-3.5 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Adres</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Açık işletme adresi..."
              className="w-full px-3.5 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
            />
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              {savingProfile ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              İşletme Bilgilerini Kaydet
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
