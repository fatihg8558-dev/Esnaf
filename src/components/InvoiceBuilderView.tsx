import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  FileText,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import type {
  Account,
  BusinessProfile,
  CurrencyCode,
  GibCredential,
  GibSessionState,
  Invoice,
  InvoiceLineItem,
  InvoiceType,
  SavedItem,
} from '../types';
import {
  CURRENCY_LABELS,
  CURRENCY_OPTIONS,
  UNIT_OPTIONS,
  currentTimeHMS,
  formatCurrency,
  formatNumberTR,
  formatTRY,
  isValidTaxId,
  numberToTurkishWords,
  todayISO,
} from '../utils/formatters';
import {
  fetchExchangeRates,
  gibCreateDraftAndSendSms,
  gibLoginSaved,
  gibLookupRecipient,
  gibVerifySms,
} from '../services/gibClient';
import { InvoicePreviewModal } from './InvoicePreviewModal';

interface InvoiceBuilderViewProps {
  uid: string;
  profile: BusinessProfile | null;
  accounts: Account[];
  savedItems: SavedItem[];
  gibSession: GibSessionState;
  savedGibCred: GibCredential | null;
  gibAutoConnecting: boolean;
  gibAutoError: string | null;
  onClearGibAutoError: () => void;
  onResetManualLogout: () => void;
  onEnableGibAutoConnect?: () => Promise<void>;
  onSafeGibLogout: () => Promise<void>;
  onNotify?: (msg: string) => void;
  preselectedAccount: Account | null;
  onClearPreselectedAccount: () => void;
  onGibSessionChange: (session: GibSessionState) => void;
  onSaveItem: (
    input: Omit<SavedItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  onDeleteSavedItem: (id: string) => Promise<void>;
  onCreateDraftInvoice: (
    input: Omit<Invoice, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  onApproveInvoice: (
    invoice: Invoice,
    approvedInvoiceNo: string,
    approvedAt: string,
    options: { reflectToIncome: boolean; reflectToAccountBalance: boolean }
  ) => Promise<void>;
  onGoToArchive: () => void;
  onGoToSettings: () => void;
}

function createEmptyLine(): InvoiceLineItem {
  return {
    id: crypto.randomUUID(),
    name: '',
    quantity: 1,
    unit: 'Adet',
    unitPrice: 0,
    vatRate: 20,
    lineSubtotal: 0,
    lineVat: 0,
    lineTotal: 0,
    saveToQuickList: false,
  };
}

export const InvoiceBuilderView: React.FC<InvoiceBuilderViewProps> = ({
  uid,
  profile,
  accounts,
  savedItems,
  gibSession,
  savedGibCred,
  gibAutoConnecting,
  gibAutoError,
  onClearGibAutoError,
  onResetManualLogout,
  onEnableGibAutoConnect,
  onSafeGibLogout,
  onNotify,
  preselectedAccount,
  onClearPreselectedAccount,
  onGibSessionChange,
  onSaveItem,
  onDeleteSavedItem,
  onCreateDraftInvoice,
  onApproveInvoice,
  onGoToArchive,
  onGoToSettings,
}) => {
  const [quickConnectLoading, setQuickConnectLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Invoice Form State
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [invoiceTime, setInvoiceTime] = useState(currentTimeHMS());
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('SATIS');
  const [currency, setCurrency] = useState<CurrencyCode>('TRY');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [rateLoading, setRateLoading] = useState(false);

  const [recipientAccountId, setRecipientAccountId] = useState('');
  const [recipientTaxId, setRecipientTaxId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientTaxOffice, setRecipientTaxOffice] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recipientCity, setRecipientCity] = useState('');
  const [recipientDistrict, setRecipientDistrict] = useState('');
  const [note, setNote] = useState('');
  const [includeAmountInWords, setIncludeAmountInWords] = useState(true);
  const [includeProfileIban, setIncludeProfileIban] = useState(Boolean(profile?.iban));
  const [includeDefaultNote, setIncludeDefaultNote] = useState(Boolean(profile?.defaultInvoiceNote));
  const [items, setItems] = useState<InvoiceLineItem[]>([createEmptyLine()]);
  const [reflectToIncome, setReflectToIncome] = useState(true);
  const [reflectToAccountBalance, setReflectToAccountBalance] = useState(false);
  const [showSavedItemsManager, setShowSavedItemsManager] = useState(false);

  useEffect(() => {
    setIncludeProfileIban(Boolean(profile?.iban?.trim()));
    setIncludeDefaultNote(Boolean(profile?.defaultInvoiceNote?.trim()));
  }, [profile?.iban, profile?.defaultInvoiceNote]);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [createdDraftDoc, setCreatedDraftDoc] = useState<Invoice | null>(null);

  useEffect(() => {
    if (preselectedAccount) {
      setRecipientAccountId(preselectedAccount.id);
      setRecipientTaxId(preselectedAccount.taxId || '');
      setRecipientName(preselectedAccount.name || '');
      setRecipientTaxOffice(preselectedAccount.taxOffice || '');
      setRecipientAddress(preselectedAccount.address || '');
      setRecipientCity(preselectedAccount.city || '');
      setRecipientDistrict(preselectedAccount.district || '');
      if (preselectedAccount.currency && preselectedAccount.currency !== 'TRY') {
        void handleCurrencyChange(preselectedAccount.currency);
      }
      onClearPreselectedAccount();
    }
  }, [preselectedAccount, onClearPreselectedAccount]);

  const numericExchangeRate = useMemo(() => {
    if (currency === 'TRY') return 1;
    const val = Number(String(exchangeRate).replace(',', '.'));
    return Number.isFinite(val) && val > 0 ? val : 1;
  }, [currency, exchangeRate]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let vatTotal = 0;
    for (const item of items) {
      subtotal += item.lineSubtotal;
      vatTotal += item.lineVat;
    }
    const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;
    const tlEquivalent =
      currency === 'TRY'
        ? grandTotal
        : Math.round(grandTotal * numericExchangeRate * 100) / 100;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      vatTotal: Math.round(vatTotal * 100) / 100,
      grandTotal,
      tlEquivalent,
    };
  }, [items, currency, numericExchangeRate]);

  const composedInvoiceNote = useMemo(() => {
    const lines: string[] = [];
    if (includeAmountInWords) {
      lines.push(numberToTurkishWords(totals.grandTotal, currency));
    }
    if (includeProfileIban && profile?.iban?.trim()) {
      lines.push(`IBAN: ${profile.iban.trim()}`);
    }
    if (includeDefaultNote && profile?.defaultInvoiceNote?.trim()) {
      lines.push(profile.defaultInvoiceNote.trim());
    }
    if (note.trim()) {
      lines.push(note.trim());
    }
    return lines.join('\n').slice(0, 1000);
  }, [
    includeAmountInWords,
    includeProfileIban,
    includeDefaultNote,
    totals.grandTotal,
    currency,
    profile?.iban,
    profile?.defaultInvoiceNote,
    note,
  ]);

  const handleCurrencyChange = async (nextCurrency: CurrencyCode) => {
    setCurrency(nextCurrency);
    if (nextCurrency === 'TRY') {
      setExchangeRate('1');
      return;
    }
    setRateLoading(true);
    try {
      const resp = await fetchExchangeRates();
      if (resp.ok && resp.rates && resp.rates[nextCurrency]) {
        setExchangeRate(String(resp.rates[nextCurrency]));
      }
    } finally {
      setRateLoading(false);
    }
  };

  const handleRefreshTcmbRate = async () => {
    if (currency === 'TRY') return;
    setRateLoading(true);
    try {
      const resp = await fetchExchangeRates();
      if (resp.ok && resp.rates && resp.rates[currency]) {
        setExchangeRate(String(resp.rates[currency]));
        onNotify?.(`TCMB ${currency} kuru güncellendi: ${resp.rates[currency]} ₺`);
      } else {
        setFormError(resp.error || 'TCMB kuru alınamadı.');
      }
    } finally {
      setRateLoading(false);
    }
  };

  const handleQuickSavedConnect = async () => {
    if (!savedGibCred) {
      onGoToSettings();
      return;
    }
    setConnectError(null);
    onClearGibAutoError();
    setQuickConnectLoading(true);
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
        setConnectError(resp.error || 'Kayıtlı GİB bilgileri ile oturum açılamadı.');
        return;
      }

      onResetManualLogout();
      await onEnableGibAutoConnect?.();
      onGibSessionChange({
        connected: true,
        sessionId: resp.sessionId,
        mode: 'live',
        userCode: resp.userCode || savedGibCred.userCode,
        sellerInfo: resp.sellerInfo,
      });
      onNotify?.('Kayıtlı GİB bilgileri ile oturum açıldı.');
    } catch (err: any) {
      setConnectError(err?.message || 'GİB bağlantı hatası.');
    } finally {
      setQuickConnectLoading(false);
    }
  };

  const handleGibLogout = async () => {
    setLogoutLoading(true);
    try {
      await onSafeGibLogout();
    } finally {
      setLogoutLoading(false);
    }
  };

  const handleSelectAccount = (accId: string) => {
    setRecipientAccountId(accId);
    const acc = accounts.find((a) => a.id === accId);
    if (acc) {
      setRecipientTaxId(acc.taxId || '');
      setRecipientName(acc.name || '');
      setRecipientTaxOffice(acc.taxOffice || '');
      setRecipientAddress(acc.address || '');
      setRecipientCity(acc.city || '');
      setRecipientDistrict(acc.district || '');
    }
  };

  const handleLookupTaxId = async () => {
    const clean = recipientTaxId.replace(/\D/g, '');
    if (!isValidTaxId(clean)) {
      setFormError('Sorgulama için 10 haneli VKN veya 11 haneli TCKN girin.');
      return;
    }
    if (!gibSession.connected || !gibSession.sessionId) {
      setFormError('VKN/TCKN sorgulamak için önce GİB oturumu açmalısınız.');
      return;
    }
    setFormError(null);
    setLookupLoading(true);
    try {
      const resp = await gibLookupRecipient(gibSession.sessionId, clean);
      if (!resp.ok || !resp.recipient) {
        setFormError(resp.error || 'Mükellef bilgisi getirilemedi.');
        return;
      }
      if (resp.recipient.name) setRecipientName(resp.recipient.name);
      if (resp.recipient.taxOffice) setRecipientTaxOffice(resp.recipient.taxOffice);
    } catch (err: any) {
      setFormError(err?.message || 'Sorgulama başarısız.');
    } finally {
      setLookupLoading(false);
    }
  };

  const updateLineItem = (id: string, patch: Partial<InvoiceLineItem>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        const qty = Math.max(0, Number(next.quantity) || 0);
        const price = Math.max(0, Number(next.unitPrice) || 0);
        const vat = Math.max(0, Number(next.vatRate) || 0);
        const lineSubtotal = Math.round(qty * price * 100) / 100;
        const lineVat = Math.round(lineSubtotal * (vat / 100) * 100) / 100;
        return {
          ...next,
          lineSubtotal,
          lineVat,
          lineTotal: Math.round((lineSubtotal + lineVat) * 100) / 100,
        };
      })
    );
  };

  const handleAddSavedItemToInvoice = (savedId: string) => {
    const found = savedItems.find((s) => s.id === savedId);
    if (!found) return;
    const lineSubtotal = Math.round(found.unitPrice * 100) / 100;
    const lineVat = Math.round(lineSubtotal * (found.vatRate / 100) * 100) / 100;
    const newLine: InvoiceLineItem = {
      id: crypto.randomUUID(),
      name: found.name,
      quantity: 1,
      unit: found.unit,
      unitPrice: found.unitPrice,
      vatRate: found.vatRate,
      lineSubtotal,
      lineVat,
      lineTotal: Math.round((lineSubtotal + lineVat) * 100) / 100,
      saveToQuickList: false,
    };
    setItems((prev) => {
      if (prev.length === 1 && !prev[0].name.trim() && prev[0].unitPrice === 0) {
        return [newLine];
      }
      return [...prev, newLine];
    });
  };

  const handleOpenPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!gibSession.connected || !gibSession.sessionId) {
      setFormError(
        'Fatura önizlemesi ve SMS onayı için önce Ayarlar sayfasından veya yukarıdaki bağlantı çubuğundan GİB oturumu açın.'
      );
      return;
    }

    const cleanTaxId = recipientTaxId.replace(/\D/g, '');
    if (!isValidTaxId(cleanTaxId)) {
      setFormError('Alıcı VKN (10 hane) veya TCKN (11 hane) zorunludur.');
      return;
    }
    if (!recipientName.trim()) {
      setFormError('Alıcı unvanı veya ad soyad zorunludur.');
      return;
    }
    if (currency !== 'TRY' && numericExchangeRate <= 0) {
      setFormError('Dövizli fatura için geçerli bir döviz kuru girin.');
      return;
    }
    const validLines = items.filter((it) => it.name.trim().length > 0 && it.quantity > 0);
    if (validLines.length === 0) {
      setFormError('Faturada en az 1 geçerli mal veya hizmet kalemi olmalıdır.');
      return;
    }

    const itemsToSave = validLines.filter((it) => it.saveToQuickList);
    if (itemsToSave.length > 0) {
      await Promise.all(
        itemsToSave.map((it) =>
          onSaveItem({
            name: it.name.trim(),
            unit: it.unit,
            unitPrice: it.unitPrice,
            vatRate: it.vatRate,
          })
        )
      );
      setItems((prev) => prev.map((it) => ({ ...it, saveToQuickList: false })));
    }

    const ettn = crypto.randomUUID();
    const previewObj: Invoice = {
      id: '',
      ownerId: uid,
      ettn,
      invoiceNo: 'ÖN İZLEME',
      invoiceDate,
      invoiceTime: invoiceTime || currentTimeHMS(),
      invoiceType,
      gibMode: gibSession.mode,
      status: 'draft',
      currency,
      exchangeRate: numericExchangeRate,
      sellerTitle: gibSession.sellerInfo?.title || profile?.title || 'Esnaf İşletmem',
      sellerTaxId: gibSession.sellerInfo?.taxId || profile?.taxId || '',
      sellerTaxOffice: gibSession.sellerInfo?.taxOffice || profile?.taxOffice || '',
      sellerAddress: gibSession.sellerInfo?.address || profile?.address || '',
      recipientAccountId,
      recipientName: recipientName.trim(),
      recipientTaxId: cleanTaxId,
      recipientTaxOffice: recipientTaxOffice.trim(),
      recipientAddress: recipientAddress.trim(),
      recipientCity: recipientCity.trim(),
      recipientDistrict: recipientDistrict.trim(),
      items: validLines,
      subtotal: totals.subtotal,
      vatTotal: totals.vatTotal,
      grandTotal: totals.grandTotal,
      note: composedInvoiceNote,
      smsApprovedAt: '',
      reflectedToLedger: false,
    };

    setCreatedDraftDoc(null);
    setPreviewInvoice(previewObj);
  };

  const handleSendSmsFromPreview = async () => {
    if (!previewInvoice || !gibSession.sessionId) {
      return { ok: false, error: 'GİB oturumu bulunamadı.' };
    }
    const resp = await gibCreateDraftAndSendSms(gibSession.sessionId, previewInvoice);
    if (!resp.ok) {
      return { ok: false, error: resp.error || 'Taslak oluşturulamadı.' };
    }

    const draftNo = resp.draftInvoiceNo || `TASLAK-${previewInvoice.ettn.slice(0, 8).toUpperCase()}`;
    const savedId = await onCreateDraftInvoice({
      ...previewInvoice,
      ettn: resp.ettn || previewInvoice.ettn,
      invoiceNo: draftNo,
      status: 'draft',
    });

    const fullDraft: Invoice = {
      ...previewInvoice,
      id: savedId,
      ettn: resp.ettn || previewInvoice.ettn,
      invoiceNo: draftNo,
      status: 'draft',
    };
    setCreatedDraftDoc(fullDraft);

    return {
      ok: true,
      oid: resp.oid,
      ettn: resp.ettn,
      draftInvoiceNo: draftNo,
      maskedPhone: resp.maskedPhone,
    };
  };

  const handleVerifySmsFromPreview = async (oid: string, code: string, ettn: string) => {
    if (!gibSession.sessionId || !createdDraftDoc) {
      return { ok: false, error: 'Taslak fatura veya GİB oturumu bulunamadı.' };
    }

    const verifyResp = await gibVerifySms(
      gibSession.sessionId,
      oid,
      code,
      ettn,
      createdDraftDoc.invoiceDate
    );

    if (!verifyResp.ok) {
      return { ok: false, error: verifyResp.error || 'SMS doğrulaması başarısız.' };
    }

    const officialNo = verifyResp.invoiceNo || createdDraftDoc.invoiceNo;
    await onApproveInvoice(
      createdDraftDoc,
      officialNo,
      verifyResp.approvedAt || new Date().toISOString(),
      {
        reflectToIncome,
        reflectToAccountBalance: Boolean(recipientAccountId && reflectToAccountBalance),
      }
    );

    return { ok: true, invoiceNo: officialNo };
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">GİB e-Arşiv Fatura Kesimi</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Önizleme sonrası SMS onayı ile doğrudan fatura oluşturun · Dövizli fatura ve PDF çıktı destekli
          </p>
        </div>
      </div>

      {/* Compact GİB Status Bar (Credentials managed in Ayarlar) */}
      {gibSession.connected ? (
        <div className="bg-[#131C2E] border border-emerald-500/30 rounded-xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-slate-100">
                GİB Oturumu Aktif · <span className="text-emerald-400">Canlı GİB Portal</span>
              </div>
              <div className="text-xs text-slate-400">
                {gibSession.sellerInfo?.title} · Kullanıcı Kodu:{' '}
                <span className="font-mono-num text-slate-300">{gibSession.userCode}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onGoToSettings}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              <Settings className="w-3.5 h-3.5" />
              GİB Ayarları
            </button>
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
              Güvenli Çıkış
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl px-5 py-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400 shrink-0">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {gibAutoConnecting
                    ? 'Kayıtlı GİB hesabına bağlanılıyor...'
                    : savedGibCred
                    ? `Kayıtlı GİB Hesabı Hazır (${savedGibCred.userCode})`
                    : 'GİB e-Arşiv Portal Oturumu Kapalı'}
                </div>
                <div className="text-xs text-slate-400">
                  {savedGibCred
                    ? 'Tek tıkla bağlanabilir veya GİB bilgilerinizi Ayarlar sayfasından yönetebilirsiniz.'
                    : 'Fatura kesmek için Ayarlar sekmesinden GİB kullanıcı kodu ve şifrenizle giriş yapın.'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {savedGibCred && (
                <button
                  type="button"
                  onClick={handleQuickSavedConnect}
                  disabled={quickConnectLoading || gibAutoConnecting}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {(quickConnectLoading || gibAutoConnecting) && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  Kayıtlı Bilgilerle Bağlan
                </button>
              )}
              <button
                type="button"
                onClick={onGoToSettings}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                <Settings className="w-3.5 h-3.5" />
                {savedGibCred ? 'Ayarlar' : 'GİB Ayarlarına Git'}
              </button>
            </div>
          </div>

          {(connectError || gibAutoError) && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5">
              {connectError || gibAutoError}
            </div>
          )}
        </div>
      )}

      {/* Invoice Builder Form */}
      <form onSubmit={handleOpenPreview} className="space-y-5">
        {formError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-4 py-3">
            {formError}
          </div>
        )}

        {/* Recipient & Metadata Card */}
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
            <h3 className="text-sm font-semibold text-slate-100">1. Alıcı &amp; Fatura Bilgileri</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRecipientAccountId('');
                  setRecipientTaxId('11111111111');
                  setRecipientName('NİHAİ TÜKETİCİ');
                  setRecipientTaxOffice('');
                }}
                className="px-3 py-1.5 bg-[#0B1120] hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap"
              >
                Nihai Tüketici (11111111111)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Kayıtlı Cariden Seç
              </label>
              <select
                value={recipientAccountId}
                onChange={(e) => handleSelectAccount(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              >
                <option value="">Manuel Alıcı Girişi</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} {acc.taxId ? `(${acc.taxId})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Düzenleme Tarihi &amp; Saati
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="px-2 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs font-mono-num text-slate-100"
                  required
                />
                <input
                  type="text"
                  value={invoiceTime}
                  onChange={(e) => setInvoiceTime(e.target.value)}
                  placeholder="12:00:00"
                  className="px-2 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs font-mono-num text-slate-100"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Fatura Tipi
              </label>
              <select
                value={invoiceType}
                onChange={(e) => setInvoiceType(e.target.value as InvoiceType)}
                className="w-full px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              >
                <option value="SATIS">SATIŞ</option>
                <option value="IADE">İADE</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Para Birimi
              </label>
              <select
                value={currency}
                onChange={(e) => handleCurrencyChange(e.target.value as CurrencyCode)}
                className="w-full px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {currency !== 'TRY' && (
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-medium text-slate-300">
                  1 {currency} =
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  className="w-32 px-3 py-1.5 bg-[#131C2E] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs font-mono-num text-slate-100"
                />
                <span className="text-xs text-slate-400">TRY</span>
                <button
                  type="button"
                  onClick={handleRefreshTcmbRate}
                  disabled={rateLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  {rateLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  TCMB Kuru Al
                </button>
              </div>
              <div className="text-xs text-slate-400 font-mono-num">
                TL Karşılığı:{' '}
                <span className="text-slate-200 font-semibold">
                  {formatTRY(totals.tlEquivalent)}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Alıcı VKN / TCKN *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={11}
                  value={recipientTaxId}
                  onChange={(e) => setRecipientTaxId(e.target.value.replace(/\D/g, ''))}
                  placeholder="10 veya 11 hane"
                  className="flex-1 min-w-0 px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                  required
                />
                <button
                  type="button"
                  onClick={handleLookupTaxId}
                  disabled={lookupLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                  title="GİB'den Mükellef Sorgula"
                >
                  {lookupLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  Sorgula
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Alıcı Unvan / Ad Soyad *
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Firma unvanı veya kişi adı"
                className="w-full px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Vergi Dairesi
              </label>
              <input
                type="text"
                value={recipientTaxOffice}
                onChange={(e) => setRecipientTaxOffice(e.target.value)}
                placeholder="Örn: Kadıköy"
                className="w-full px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">İl / İlçe</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={recipientCity}
                  onChange={(e) => setRecipientCity(e.target.value)}
                  placeholder="İl"
                  className="px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
                <input
                  type="text"
                  value={recipientDistrict}
                  onChange={(e) => setRecipientDistrict(e.target.value)}
                  placeholder="İlçe"
                  className="px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Adres</label>
              <input
                type="text"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder="Alıcı adresi..."
                className="w-full px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Line Items Card */}
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                2. Mal / Hizmet Kalemleri ({currency})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Kalemler yalnızca siz “Kalemi kaydet” kutucuğunu işaretlerseniz hızlı listeye kaydedilir.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {savedItems.length > 0 && (
                <>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddSavedItemToInvoice(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-200 max-w-[220px]"
                  >
                    <option value="">Kayıtlı Kalemden Ekle...</option>
                    {savedItems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({formatTRY(s.unitPrice)})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowSavedItemsManager(!showSavedItemsManager)}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap"
                  >
                    {showSavedItemsManager ? 'Listeyi Gizle' : `Kayıtlılar (${savedItems.length})`}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, createEmptyLine()])}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                Satır Ekle
              </button>
            </div>
          </div>

          {showSavedItemsManager && savedItems.length > 0 && (
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-300">
                Kaydettiğiniz Hızlı Kalemler (Stoksuz Şablonlar)
              </div>
              <div className="flex flex-wrap gap-2">
                {savedItems.map((s) => (
                  <div
                    key={s.id}
                    className="inline-flex items-center gap-2 bg-[#131C2E] border border-slate-700 rounded-lg px-3 py-1.5 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => handleAddSavedItemToInvoice(s.id)}
                      className="text-slate-200 hover:text-blue-400 font-medium"
                    >
                      + {s.name} · {formatTRY(s.unitPrice)}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedItem(s.id)}
                      className="text-slate-500 hover:text-red-400"
                      title="Şablonu Sil"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Line Items List */}
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="bg-[#0B1120] border border-slate-800 rounded-xl p-3.5 space-y-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-4">
                    <label className="block text-[11px] text-slate-400 mb-1">
                      #{idx + 1} Mal / Hizmet Adı *
                    </label>
                    <input
                      type="text"
                      maxLength={180}
                      value={item.name}
                      onChange={(e) => updateLineItem(item.id, { name: e.target.value })}
                      placeholder="Örn: Elektrik Bakım ve Onarım Hizmeti"
                      className="w-full px-3 py-2 bg-[#131C2E] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-100"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 md:col-span-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Miktar</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={item.quantity}
                        onChange={(e) =>
                          updateLineItem(item.id, { quantity: Number(e.target.value) || 0 })
                        }
                        className="w-full px-2.5 py-2 bg-[#131C2E] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs font-mono-num text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Birim</label>
                      <select
                        value={item.unit}
                        onChange={(e) => updateLineItem(item.id, { unit: e.target.value })}
                        className="w-full px-2 py-2 bg-[#131C2E] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-100"
                      >
                        {UNIT_OPTIONS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:col-span-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Birim Fiyat ({currency})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.unitPrice}
                        onChange={(e) =>
                          updateLineItem(item.id, { unitPrice: Number(e.target.value) || 0 })
                        }
                        className="w-full px-2.5 py-2 bg-[#131C2E] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs font-mono-num text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">KDV %</label>
                      <select
                        value={item.vatRate}
                        onChange={(e) =>
                          updateLineItem(item.id, { vatRate: Number(e.target.value) })
                        }
                        className="w-full px-2 py-2 bg-[#131C2E] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs font-mono-num text-slate-100"
                      >
                        <option value={0}>%0</option>
                        <option value={1}>%1</option>
                        <option value={10}>%10</option>
                        <option value={20}>%20</option>
                      </select>
                    </div>
                  </div>

                  <div className="md:col-span-2 flex items-center justify-between md:justify-end gap-2">
                    <div className="text-right">
                      <div className="text-[11px] text-slate-400">Satır Toplamı</div>
                      <div className="text-xs font-bold font-mono-num text-slate-100">
                        {formatCurrency(item.lineTotal, currency)}
                      </div>
                    </div>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
                        className="p-2 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                        title="Satırı Sil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Explicit Opt-In Save Checkbox */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(item.saveToQuickList)}
                      onChange={(e) =>
                        updateLineItem(item.id, { saveToQuickList: e.target.checked })
                      }
                      className="rounded border-slate-600 bg-[#131C2E] text-blue-500 focus:ring-blue-500"
                    />
                    <BookmarkPlus className="w-3.5 h-3.5 text-slate-400" />
                    <span>Bu kalemi daha sonra kullanmak için kaydet (İsteğe bağlı)</span>
                  </label>

                  <div className="text-[11px] text-slate-400 font-mono-num">
                    Matrah: {formatCurrency(item.lineSubtotal, currency)} · KDV:{' '}
                    {formatCurrency(item.lineVat, currency)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notes, Ledger Options & Totals */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 bg-[#131C2E] border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="space-y-2.5 bg-[#0B1120] border border-slate-800 rounded-lg p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  Otomatik Fatura Alt Notları (GİB &ldquo;Not&rdquo; Alanı)
                </span>
                <button
                  type="button"
                  onClick={onGoToSettings}
                  className="text-[11px] text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
                >
                  Ayarlardan Düzenle
                </button>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAmountInWords}
                  onChange={(e) => setIncludeAmountInWords(e.target.checked)}
                  className="mt-0.5 rounded border-slate-600 bg-[#131C2E] text-blue-500 focus:ring-blue-500"
                />
                <span>
                  Tutarı yazıyla yaz:{' '}
                  <strong className="text-slate-100">
                    {numberToTurkishWords(totals.grandTotal, currency)}
                  </strong>
                </span>
              </label>

              {profile?.iban?.trim() ? (
                <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeProfileIban}
                    onChange={(e) => setIncludeProfileIban(e.target.checked)}
                    className="mt-0.5 rounded border-slate-600 bg-[#131C2E] text-blue-500 focus:ring-blue-500"
                  />
                  <span>
                    Kayıtlı IBAN bilgisini ekle:{' '}
                    <span className="font-mono-num text-emerald-300">{profile.iban}</span>
                  </span>
                </label>
              ) : (
                <div className="text-[11px] text-slate-500">
                  Ayarlarda kayıtlı IBAN yok.{' '}
                  <button
                    type="button"
                    onClick={onGoToSettings}
                    className="text-blue-400 hover:underline"
                  >
                    IBAN eklemek için Ayarlara git
                  </button>
                </div>
              )}

              {profile?.defaultInvoiceNote?.trim() ? (
                <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeDefaultNote}
                    onChange={(e) => setIncludeDefaultNote(e.target.checked)}
                    className="mt-0.5 rounded border-slate-600 bg-[#131C2E] text-blue-500 focus:ring-blue-500"
                  />
                  <span>
                    Sabit açıklamayı ekle:{' '}
                    <span className="text-slate-300">{profile.defaultInvoiceNote}</span>
                  </span>
                </label>
              ) : (
                <div className="text-[11px] text-slate-500">
                  Ayarlarda sabit açıklama yok.{' '}
                  <button
                    type="button"
                    onClick={onGoToSettings}
                    className="text-blue-400 hover:underline"
                  >
                    Sabit açıklama ekle
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Ek Fatura Notu (İsteğe Bağlı)
              </label>
              <textarea
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Bu faturaya özel ek teslimat veya vade notu..."
                className="w-full px-3 py-2 bg-[#0B1120] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-100"
              />
            </div>

            {composedInvoiceNote && (
              <div className="bg-[#0B1120] border border-slate-800/80 rounded-lg px-3 py-2 text-[11px] text-slate-400 whitespace-pre-line">
                <span className="font-semibold text-slate-300">Faturada Görünecek Not:</span>
                {'\n'}
                {composedInvoiceNote}
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={reflectToIncome}
                  onChange={(e) => setReflectToIncome(e.target.checked)}
                  className="rounded border-slate-600 bg-[#0B1120] text-blue-500 focus:ring-blue-500"
                />
                <span>SMS onayı tamamlandığında Gelir-Gider Defterine otomatik kaydet</span>
              </label>

              {recipientAccountId && (
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reflectToAccountBalance}
                    onChange={(e) => setReflectToAccountBalance(e.target.checked)}
                    className="rounded border-slate-600 bg-[#0B1120] text-blue-500 focus:ring-blue-500"
                  />
                  <span>Açık hesap (veresiye) olarak seçili cari bakiyesine borç ekle</span>
                </label>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 bg-[#131C2E] border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between text-slate-300">
                <span>Mal Hizmet Toplamı</span>
                <span className="font-mono-num font-medium">
                  {formatCurrency(totals.subtotal, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span>Hesaplanan KDV</span>
                <span className="font-mono-num font-medium">
                  {formatCurrency(totals.vatTotal, currency)}
                </span>
              </div>
              <div className="border-t border-slate-800 pt-2.5 flex items-center justify-between text-base font-bold text-slate-100">
                <span>Ödenecek Genel Toplam</span>
                <span className="font-mono-num text-blue-400 text-lg">
                  {formatCurrency(totals.grandTotal, currency)}
                </span>
              </div>
              {currency !== 'TRY' && (
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>TL Karşılığı (Kur {formatNumberTR(numericExchangeRate)})</span>
                  <span className="font-mono-num font-medium text-slate-300">
                    {formatTRY(totals.tlEquivalent)}
                  </span>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors min-h-[44px]"
            >
              <FileText className="w-4 h-4" />
              Fatura Ön İzlemesini Göster
            </button>
          </div>
        </div>
      </form>

      {/* Pre-SMS Preview + SMS OTP Modal */}
      {previewInvoice && (
        <InvoicePreviewModal
          invoice={previewInvoice}
          mode="confirm"
          gibSession={gibSession}
          onClose={() => setPreviewInvoice(null)}
          onSendSms={handleSendSmsFromPreview}
          onVerifySms={handleVerifySmsFromPreview}
          onGoToArchive={() => {
            setPreviewInvoice(null);
            onGoToArchive();
          }}
        />
      )}
    </div>
  );
};
