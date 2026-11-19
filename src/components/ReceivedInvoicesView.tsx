import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightCircle,
  CheckCircle2,
  Eye,
  FileDown,
  FileText,
  KeyRound,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Account,
  BusinessProfile,
  DvSessionState,
  ExpenseCategory,
  GibCredential,
  GibSessionState,
  PaymentMethod,
  ReceivedInvoice,
} from '../types';
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHOD_LABELS,
  addDaysISO,
  formatCurrency,
  formatDateTR,
  formatTRY,
  todayISO,
} from '../utils/formatters';
import {
  dvCompleteLogin,
  dvFetchReceivedInvoices,
  dvLogout,
  dvStartLogin,
  gibEncryptCredentials,
  gibGetReceivedInvoiceHtml,
} from '../services/gibClient';
import type { UpsertReceivedInvoiceInput } from '../services/firestoreService';
import { downloadReceivedInvoicePdf } from '../services/pdfService';

interface ReceivedInvoicesViewProps {
  profile: BusinessProfile | null;
  accounts: Account[];
  receivedInvoices: ReceivedInvoice[];
  customExpenseCategories: ExpenseCategory[];
  gibSession: GibSessionState;
  dvSession: DvSessionState;
  savedGibCred: GibCredential | null;
  onDvSessionChange: (next: DvSessionState) => void;
  onSaveGibCredential: (
    cred: Pick<GibCredential, 'userCode' | 'encryptedSecret' | 'mode' | 'autoConnect'>
  ) => Promise<void>;
  onUpsertReceivedInvoices: (
    items: UpsertReceivedInvoiceInput[]
  ) => Promise<{ added: number; updated: number }>;
  onReflectToExpense: (
    recInv: ReceivedInvoice,
    options: {
      category: string;
      date: string;
      paymentMethod: PaymentMethod;
      accountId: string;
      accountName: string;
      affectsBalance: boolean;
      description: string;
    }
  ) => Promise<string>;
  onDeleteReceivedInvoice: (id: string) => Promise<void>;
  onNotify: (msg: string) => void;
}

export const ReceivedInvoicesView: React.FC<ReceivedInvoicesViewProps> = ({
  profile,
  accounts,
  receivedInvoices,
  customExpenseCategories,
  gibSession,
  dvSession,
  savedGibCred,
  onDvSessionChange,
  onSaveGibCredential,
  onUpsertReceivedInvoices,
  onReflectToExpense,
  onDeleteReceivedInvoice,
  onNotify,
}) => {
  const [startDate, setStartDate] = useState(() => addDaysISO(todayISO(), -30));
  const [endDate, setEndDate] = useState(() => todayISO());
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Dijital Vergi Dairesi inline login & CAPTCHA challenge state
  const [pendingDvId, setPendingDvId] = useState<string | null>(null);
  const [needsCredentials, setNeedsCredentials] = useState(false);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [gibUserCode, setGibUserCode] = useState(savedGibCred?.userCode || '');
  const [gibPassword, setGibPassword] = useState('');
  const [rememberGib, setRememberGib] = useState(true);
  const [connectingGib, setConnectingGib] = useState(false);

  useEffect(() => {
    if (savedGibCred?.userCode) {
      setGibUserCode((prev) => prev || savedGibCred.userCode);
    }
  }, [savedGibCred?.userCode]);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'reflected'>('all');

  // Preview / PDF modal
  const [previewInvoice, setPreviewInvoice] = useState<ReceivedInvoice | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  // Reflect to expense modal
  const [reflectTarget, setReflectTarget] = useState<ReceivedInvoice | null>(null);
  const [expenseCategory, setExpenseCategory] = useState('Mal Alımı / Hammadde');
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('transfer');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [affectsBalance, setAffectsBalance] = useState(false);
  const [expenseDesc, setExpenseDesc] = useState('');
  const [reflectSaving, setReflectSaving] = useState(false);
  const [reflectError, setReflectError] = useState<string | null>(null);

  // Inline delete confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const allExpenseCategories = useMemo(() => {
    const customNames = customExpenseCategories.map((c) => c.name);
    return Array.from(new Set([...EXPENSE_CATEGORIES, ...customNames]));
  }, [customExpenseCategories]);

  const supplierAccounts = useMemo(
    () => accounts.filter((a) => a.accountType === 'supplier' || a.accountType === 'both'),
    [accounts]
  );

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return receivedInvoices.filter((inv) => {
      if (statusFilter === 'pending' && inv.reflectedToExpense) return false;
      if (statusFilter === 'reflected' && !inv.reflectedToExpense) return false;
      if (!q) return true;
      return (
        inv.sellerName.toLowerCase().includes(q) ||
        inv.sellerTaxId.toLowerCase().includes(q) ||
        inv.invoiceNo.toLowerCase().includes(q) ||
        inv.ettn.toLowerCase().includes(q)
      );
    });
  }, [receivedInvoices, statusFilter, search]);

  const summaryStats = useMemo(() => {
    let totalTry = 0;
    let totalVatTry = 0;
    let pendingCount = 0;
    for (const inv of receivedInvoices) {
      const rate = inv.currency === 'TRY' ? 1 : Number(inv.exchangeRate) || 1;
      totalTry += inv.grandTotal * rate;
      totalVatTry += inv.vatTotal * rate;
      if (!inv.reflectedToExpense) pendingCount++;
    }
    return {
      count: receivedInvoices.length,
      totalTry,
      totalVatTry,
      pendingCount,
    };
  }, [receivedInvoices]);

  const fetchListWithDvSession = async (activeDvId: string): Promise<'ok' | 'expired' | 'error'> => {
    const resp = await dvFetchReceivedInvoices(activeDvId, startDate, endDate);
    if (resp.sessionExpired) {
      onDvSessionChange({ connected: false, dvSessionId: null, userCode: '' });
      return 'expired';
    }
    if (!resp.ok || !resp.items) {
      setFetchError(resp.error || 'Alınan e-Arşiv faturaları Dijital Vergi Dairesinden çekilemedi.');
      return 'error';
    }
    if (resp.items.length === 0) {
      onNotify(
        resp.clampedToTwoMonths
          ? 'Son 2 ay içinde adınıza kesilmiş e-Arşiv fatura bulunamadı.'
          : 'Seçili tarih aralığında adınıza kesilmiş e-Arşiv fatura bulunamadı.'
      );
      return 'ok';
    }
    const res = await onUpsertReceivedInvoices(resp.items);
    onNotify(
      `${resp.items.length} fatura sorgulandı (${res.added} yeni, ${res.updated} güncellendi).`
    );
    return 'ok';
  };

  const initiateDvLoginChallenge = async (manualCreds?: { code: string; pass: string }) => {
    setFetchError(null);
    setConnectingGib(true);
    try {
      const code = (manualCreds?.code ?? (gibUserCode.trim() || savedGibCred?.userCode || '')).trim();
      const pass = (manualCreds?.pass ?? gibPassword).trim();

      const resp = await dvStartLogin({
        userCode: code,
        encryptedSecret: pass ? undefined : savedGibCred?.encryptedSecret,
        password: pass || undefined,
      });

      if (resp.ok && resp.dvSessionId) {
        onDvSessionChange({
          connected: true,
          dvSessionId: resp.dvSessionId,
          userCode: resp.userCode || code,
        });
        setNeedsCaptcha(false);
        setNeedsCredentials(false);
        setPendingDvId(null);
        await fetchListWithDvSession(resp.dvSessionId);
        return;
      }

      if (resp.dvSessionId) {
        setPendingDvId(resp.dvSessionId);
      }
      if (resp.requiresCredentials) {
        setNeedsCredentials(true);
        setNeedsCaptcha(false);
        setFetchError(
          resp.error || 'Dijital Vergi Dairesi için GİB kullanıcı kodu ve şifrenizi girin.'
        );
        return;
      }
      if (resp.requiresCaptcha && resp.captchaImage) {
        setNeedsCaptcha(true);
        setCaptchaImage(resp.captchaImage);
        setCaptchaCode('');
        return;
      }

      setFetchError(
        resp.error || 'Dijital Vergi Dairesi doğrulaması başlatılamadı.'
      );
    } catch (err: any) {
      setFetchError(err?.message || 'Dijital Vergi Dairesine bağlanılamadı.');
    } finally {
      setConnectingGib(false);
    }
  };

  const handleFetchFromGib = async () => {
    setFetchError(null);
    if (dvSession.connected && dvSession.dvSessionId) {
      setFetching(true);
      try {
        const result = await fetchListWithDvSession(dvSession.dvSessionId);
        if (result === 'expired') {
          await initiateDvLoginChallenge();
        }
      } catch (err: any) {
        setFetchError(err?.message || 'Alınan faturalar çekilirken hata oluştu.');
      } finally {
        setFetching(false);
      }
      return;
    }

    await initiateDvLoginChallenge();
  };

  const handleSubmitDvChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setFetchError(null);
    const code = (gibUserCode.trim() || savedGibCred?.userCode || '').trim();
    const pass = gibPassword.trim();

    if (!pendingDvId) {
      await initiateDvLoginChallenge({ code, pass });
      return;
    }

    setConnectingGib(true);
    try {
      const compResp = await dvCompleteLogin({
        dvSessionId: pendingDvId,
        userCode: code,
        encryptedSecret: pass ? undefined : savedGibCred?.encryptedSecret,
        password: pass || undefined,
        captchaCode: captchaCode.trim(),
      });

      if (compResp.sessionExpired) {
        setPendingDvId(null);
        await initiateDvLoginChallenge({ code, pass });
        return;
      }

      if (compResp.ok && compResp.dvSessionId) {
        if (rememberGib && code && pass) {
          const enc = await gibEncryptCredentials(code, pass);
          if (enc.ok && enc.encryptedSecret) {
            await onSaveGibCredential({
              userCode: code,
              encryptedSecret: enc.encryptedSecret,
              mode: 'live',
              autoConnect: true,
            }).catch(() => {});
          }
        }
        onDvSessionChange({
          connected: true,
          dvSessionId: compResp.dvSessionId,
          userCode: compResp.userCode || code,
        });
        setNeedsCaptcha(false);
        setNeedsCredentials(false);
        setPendingDvId(null);
        setCaptchaImage(null);
        setCaptchaCode('');
        setGibPassword('');
        await fetchListWithDvSession(compResp.dvSessionId);
        return;
      }

      if (compResp.requiresCredentials) {
        setNeedsCredentials(true);
      }
      if (compResp.requiresCaptcha && compResp.captchaImage) {
        if (compResp.dvSessionId) setPendingDvId(compResp.dvSessionId);
        setNeedsCaptcha(true);
        setCaptchaImage(compResp.captchaImage);
        setCaptchaCode('');
      }
      setFetchError(compResp.error || 'Dijital Vergi Dairesi doğrulaması tamamlanamadı.');
    } catch (err: any) {
      setFetchError(err?.message || 'Doğrulama sırasında hata oluştu.');
    } finally {
      setConnectingGib(false);
    }
  };

  const handleCancelChallenge = () => {
    if (pendingDvId) {
      dvLogout(pendingDvId);
    }
    setPendingDvId(null);
    setNeedsCaptcha(false);
    setNeedsCredentials(false);
    setCaptchaImage(null);
    setCaptchaCode('');
  };

  const handleOpenPreview = async (inv: ReceivedInvoice) => {
    setPreviewInvoice(inv);
    setPreviewHtml(null);
    if (!gibSession.connected || !gibSession.sessionId) return;
    setPreviewLoading(true);
    try {
      const resp = await gibGetReceivedInvoiceHtml(
        gibSession.sessionId,
        inv.ettn,
        inv.approvalStatus || 'Onaylandı'
      );
      if (resp.ok && resp.html) {
        setPreviewHtml(resp.html);
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownloadPdf = async (inv: ReceivedInvoice, existingHtml?: string | null) => {
    setPdfLoadingId(inv.id);
    try {
      let htmlToUse = existingHtml || undefined;
      if (!htmlToUse && gibSession.connected && gibSession.sessionId) {
        const resp = await gibGetReceivedInvoiceHtml(
          gibSession.sessionId,
          inv.ettn,
          inv.approvalStatus || 'Onaylandı'
        );
        if (resp.ok && resp.html) {
          htmlToUse = resp.html;
        }
      }
      await downloadReceivedInvoicePdf(
        inv,
        { title: profile?.title, taxId: profile?.taxId },
        htmlToUse
      );
      onNotify(`${inv.invoiceNo} PDF olarak indirildi.`);
    } catch (err: any) {
      setFetchError(err?.message || 'PDF oluşturulamadı.');
    } finally {
      setPdfLoadingId(null);
    }
  };

  const openReflectModal = (inv: ReceivedInvoice) => {
    const matchedAcc =
      accounts.find((a) => inv.sellerTaxId && a.taxId === inv.sellerTaxId) ||
      accounts.find(
        (a) =>
          a.name.trim().toLowerCase() === inv.sellerName.trim().toLowerCase()
      );
    setReflectTarget(inv);
    setExpenseCategory('Mal Alımı / Hammadde');
    setExpenseDate(inv.invoiceDate || todayISO());
    setPaymentMethod('transfer');
    setSelectedAccountId(matchedAcc?.id || '');
    setAffectsBalance(false);
    setExpenseDesc(`${inv.invoiceNo} no'lu alınan e-Arşiv faturası (${inv.sellerName})`);
    setReflectError(null);
  };

  const handleConfirmReflect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reflectTarget) return;
    setReflectError(null);
    setReflectSaving(true);
    try {
      const acc = accounts.find((a) => a.id === selectedAccountId);
      await onReflectToExpense(reflectTarget, {
        category: expenseCategory,
        date: expenseDate,
        paymentMethod,
        accountId: acc?.id || '',
        accountName: acc?.name || reflectTarget.sellerName,
        affectsBalance: Boolean(acc && affectsBalance),
        description: expenseDesc.trim(),
      });
      setReflectTarget(null);
      onNotify(`${reflectTarget.invoiceNo} gider defterine aktarıldı.`);
    } catch (err: any) {
      setReflectError(err?.message || 'Gidere aktarma işlemi başarısız oldu.');
    } finally {
      setReflectSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Date Range Fetch Bar */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Alınan e-Arşiv Faturalar</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Adınıza kesilen e-Arşiv faturalarını GİB’den çekin, PDF indirin ve tek tıkla gider defterine aktarın
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 bg-[#131C2E] border border-slate-800 rounded-lg px-2.5 py-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-xs font-mono-num text-slate-200 focus:outline-none"
              aria-label="Başlangıç Tarihi"
            />
            <span className="text-slate-500 text-xs">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-xs font-mono-num text-slate-200 focus:outline-none"
              aria-label="Bitiş Tarihi"
            />
          </div>

          <button
            type="button"
            onClick={handleFetchFromGib}
            disabled={fetching || connectingGib}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {fetching || connectingGib ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {dvSession.connected ? 'Faturaları Çek' : 'Dijital VD ile Çek'}
          </button>
        </div>
      </div>

      {/* Inline Dijital Vergi Dairesi Auth / CAPTCHA Panel */}
      {(needsCaptcha || needsCredentials || !dvSession.connected) && (
        <form
          onSubmit={handleSubmitDvChallenge}
          className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-4 h-4 text-blue-400 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Dijital Vergi Dairesi (e-Arşiv Faturalarım) Bağlantısı
                </h3>
                <p className="text-xs text-slate-400">
                  {needsCaptcha
                    ? 'Görseldeki güvenlik kodunu girerek adınıza kesilen e-Arşiv faturalarını çekin'
                    : 'Adınıza düzenlenen e-Arşiv faturaları Dijital Vergi Dairesinden sorgulanır'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!needsCaptcha && savedGibCred && (
                <button
                  type="button"
                  onClick={() => initiateDvLoginChallenge()}
                  disabled={connectingGib || fetching}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {connectingGib ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Kayıtlı Şifreyle Bağlan ({savedGibCred.userCode})
                </button>
              )}
              {(needsCaptcha || needsCredentials) && (
                <button
                  type="button"
                  onClick={handleCancelChallenge}
                  className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg"
                  title="İptal"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {(needsCaptcha || needsCredentials || !savedGibCred) && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-2 border-t border-slate-800/80">
              {(needsCredentials || !savedGibCred) && (
                <>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      GİB / Dijital VD Kullanıcı Kodu
                    </label>
                    <input
                      type="text"
                      value={gibUserCode}
                      onChange={(e) => setGibUserCode(e.target.value)}
                      placeholder="Örn: 46602214"
                      className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                      required
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      GİB Şifre
                    </label>
                    <input
                      type="password"
                      value={gibPassword}
                      onChange={(e) => setGibPassword(e.target.value)}
                      placeholder="GİB Portal şifreniz"
                      className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                      required
                    />
                  </div>
                </>
              )}

              {needsCaptcha && captchaImage && (
                <div className="md:col-span-5 flex items-end gap-2.5">
                  <div className="flex flex-col gap-1 shrink-0">
                    <img
                      src={captchaImage}
                      alt="Dijital Vergi Dairesi Güvenlik Kodu"
                      className="h-10 rounded border border-slate-700 bg-white px-1 object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-300">
                        Güvenlik Kodu *
                      </label>
                      <button
                        type="button"
                        onClick={() => initiateDvLoginChallenge()}
                        disabled={connectingGib}
                        className="text-[11px] text-blue-400 hover:text-blue-300"
                      >
                        Kodu Yenile
                      </button>
                    </div>
                    <input
                      type="text"
                      value={captchaCode}
                      onChange={(e) => setCaptchaCode(e.target.value)}
                      placeholder="Kodu yazın"
                      className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                      autoFocus
                      required
                    />
                  </div>
                </div>
              )}

              <div className="md:col-span-4 flex flex-wrap items-center gap-3">
                {(needsCredentials || !savedGibCred) && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberGib}
                      onChange={(e) => setRememberGib(e.target.checked)}
                      className="rounded border-slate-700 bg-[#0F172A] text-blue-600"
                    />
                    Şifreyi kaydet
                  </label>
                )}
                <button
                  type="submit"
                  disabled={connectingGib}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
                >
                  {connectingGib && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {needsCaptcha ? 'Doğrula & Faturaları Çek' : 'Bağlan & Çek'}
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {fetchError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-xl px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{fetchError}</span>
        </div>
      )}

      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Kayıtlı Alınan Fatura</div>
          <div className="text-xl font-bold font-mono-num text-slate-100">
            {summaryStats.count} adet
          </div>
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Toplam Fatura Tutarı</div>
          <div className="text-xl font-bold font-mono-num text-slate-100">
            {formatTRY(summaryStats.totalTry)}
          </div>
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">İndirilecek KDV Toplamı</div>
          <div className="text-xl font-bold font-mono-num text-blue-400">
            {formatTRY(summaryStats.totalVatTry)}
          </div>
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Gidere İşlenmeyi Bekleyen</div>
          <div className="text-xl font-bold font-mono-num text-amber-400">
            {summaryStats.pendingCount} fatura
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Satıcı unvanı, VKN, fatura no veya ETTN ara..."
            className="w-full pl-9 pr-3 py-2 bg-[#131C2E] border border-slate-800 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-100"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#131C2E] border border-slate-800 rounded-lg">
          {(
            [
              { id: 'all', label: 'Tümü' },
              { id: 'pending', label: 'Bekleyenler' },
              { id: 'reflected', label: 'Gidere Aktarıldı' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === tab.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl overflow-hidden">
        {filteredInvoices.length === 0 ? (
          <div className="py-14 px-6 text-center space-y-2.5">
            <FileText className="w-9 h-9 text-slate-600 mx-auto" />
            <p className="text-sm font-medium text-slate-300">
              {receivedInvoices.length === 0
                ? 'Henüz alınan e-Arşiv fatura çekilmedi'
                : 'Aramanıza uygun fatura bulunamadı'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Tarih aralığını seçip “GİB’den Çek” butonuna tıklayarak adınıza kesilen e-Arşiv faturalarını kalıcı olarak listeleyebilirsiniz.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold text-slate-400">
                  <th className="py-3 px-4">Tarih</th>
                  <th className="py-3 px-4">Fatura No &amp; ETTN</th>
                  <th className="py-3 px-4">Satıcı / VKN</th>
                  <th className="py-3 px-4 text-right">KDV</th>
                  <th className="py-3 px-4 text-right">Toplam</th>
                  <th className="py-3 px-4">Durum</th>
                  <th className="py-3 px-4 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 font-mono-num text-slate-300 whitespace-nowrap">
                      {formatDateTR(inv.invoiceDate)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-mono-num font-semibold text-slate-100">
                        {inv.invoiceNo}
                      </div>
                      <div className="text-[11px] font-mono-num text-slate-500 truncate max-w-[190px]">
                        {inv.ettn}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-100 max-w-xs truncate">
                        {inv.sellerName}
                      </div>
                      <div className="text-[11px] font-mono-num text-slate-400">
                        {inv.sellerTaxId ? `VKN/TC: ${inv.sellerTaxId}` : '-'} · {inv.invoiceType}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-slate-300 whitespace-nowrap">
                      {formatCurrency(inv.vatTotal, inv.currency)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-slate-100 whitespace-nowrap">
                      {formatCurrency(inv.grandTotal, inv.currency)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {inv.reflectedToExpense ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Gidere İşlendi
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-amber-300">
                          Aktarım Bekliyor
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenPreview(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[11px] font-medium"
                          title="Önizle"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Gör
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(inv)}
                          disabled={pdfLoadingId === inv.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-blue-300 rounded-md text-[11px] font-medium"
                          title="PDF İndir"
                        >
                          {pdfLoadingId === inv.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FileDown className="w-3.5 h-3.5" />
                          )}
                          PDF
                        </button>
                        {!inv.reflectedToExpense && (
                          <button
                            type="button"
                            onClick={() => openReflectModal(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 rounded-md text-[11px] font-semibold"
                          >
                            <ArrowRightCircle className="w-3.5 h-3.5" />
                            Gidere Aktar
                          </button>
                        )}
                        {confirmDeleteId === inv.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteReceivedInvoice(inv.id);
                                setConfirmDeleteId(null);
                                onNotify('Alınan fatura kaydı kaldırıldı.');
                              }}
                              className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-[11px] font-semibold"
                            >
                              Sil
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-[11px]"
                            >
                              İptal
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(inv.id)}
                            className="p-1.5 text-slate-500 hover:text-red-400"
                            title="Sil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preview / Official HTML Modal */}
      {previewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-4xl bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-100 truncate">
                  Alınan e-Arşiv Fatura · {previewInvoice.invoiceNo}
                </h3>
                <p className="text-xs text-slate-400 truncate">
                  {previewInvoice.sellerName} · ETTN: {previewInvoice.ettn}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewInvoice(null)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {previewLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-300 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                  <span>GİB üzerinden resmi fatura görünümü alınıyor...</span>
                </div>
              ) : previewHtml ? (
                <div className="bg-white border border-slate-700 rounded-sm overflow-hidden">
                  <iframe
                    id="received-gib-iframe"
                    title={`Alınan Fatura - ${previewInvoice.invoiceNo}`}
                    srcDoc={previewHtml}
                    className="w-full h-[720px] bg-white border-0 block"
                    sandbox="allow-same-origin"
                  />
                </div>
              ) : (
                <div className="bg-[#0B1120] border border-slate-800 rounded-xl p-5 space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="text-slate-400">Satıcı Unvan</div>
                      <div className="text-sm font-semibold text-slate-100 mt-0.5">
                        {previewInvoice.sellerName}
                      </div>
                      <div className="text-slate-400 font-mono-num mt-0.5">
                        VKN/TC: {previewInvoice.sellerTaxId || '-'}
                      </div>
                    </div>
                    <div className="sm:text-right">
                      <div className="text-slate-400">Fatura Tarih &amp; No</div>
                      <div className="text-sm font-semibold font-mono-num text-slate-100 mt-0.5">
                        {previewInvoice.invoiceNo}
                      </div>
                      <div className="text-slate-400 font-mono-num mt-0.5">
                        {formatDateTR(previewInvoice.invoiceDate)} · {previewInvoice.approvalStatus}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-slate-800 pt-3 grid grid-cols-3 gap-3 font-mono-num">
                    <div>
                      <div className="text-slate-400">Matrah</div>
                      <div className="text-sm font-semibold text-slate-200 mt-0.5">
                        {formatCurrency(previewInvoice.subtotal, previewInvoice.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">KDV</div>
                      <div className="text-sm font-semibold text-blue-400 mt-0.5">
                        {formatCurrency(previewInvoice.vatTotal, previewInvoice.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">Ödenecek Toplam</div>
                      <div className="text-sm font-bold text-slate-100 mt-0.5">
                        {formatCurrency(previewInvoice.grandTotal, previewInvoice.currency)}
                      </div>
                    </div>
                  </div>
                  {!gibSession.connected && (
                    <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                      Tam GİB HTML/fatura kalemlerini görüntülemek için GİB e-Arşiv Portalına bağlanın. Özet PDF’i şimdi indirebilirsiniz.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-slate-800 bg-[#0F172A]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(previewInvoice, previewHtml)}
                  disabled={pdfLoadingId === previewInvoice.id}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  {pdfLoadingId === previewInvoice.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4" />
                  )}
                  PDF İndir
                </button>
                {previewHtml && (
                  <button
                    type="button"
                    onClick={() => {
                      const frame = document.getElementById(
                        'received-gib-iframe'
                      ) as HTMLIFrameElement | null;
                      frame?.contentWindow?.focus();
                      frame?.contentWindow?.print();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
                  >
                    <Printer className="w-4 h-4" />
                    Yazdır
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!previewInvoice.reflectedToExpense && (
                  <button
                    type="button"
                    onClick={() => {
                      const inv = previewInvoice;
                      setPreviewInvoice(null);
                      openReflectModal(inv);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg"
                  >
                    <ArrowRightCircle className="w-4 h-4" />
                    Gidere Aktar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewInvoice(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reflect Received Invoice to Expense Modal */}
      {reflectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
              <div>
                <h3 className="text-base font-semibold text-slate-100">Faturayı Gidere Aktar</h3>
                <p className="text-xs text-slate-400">
                  {reflectTarget.invoiceNo} · {reflectTarget.sellerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReflectTarget(null)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmReflect} className="p-5 space-y-4">
              {reflectError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{reflectError}</span>
                </div>
              )}

              <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3.5 flex items-center justify-between text-xs">
                <span className="text-slate-400">Gidere İşlenecek Tutar</span>
                <span className="text-base font-bold font-mono-num text-red-400">
                  {formatCurrency(reflectTarget.grandTotal, reflectTarget.currency)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Gider Kalemi
                  </label>
                  <select
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    {allExpenseCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    İşlem Tarihi
                  </label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Ödeme Yöntemi
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tedarikçi Cari (İsteğe Bağlı)
                  </label>
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    <option value="">Cari Bağlama</option>
                    {(supplierAccounts.length > 0 ? supplierAccounts : accounts).map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedAccountId && (
                <label className="flex items-start gap-2.5 p-3 bg-[#0B1120] border border-slate-800 rounded-lg cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={affectsBalance}
                    onChange={(e) => setAffectsBalance(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-[#0F172A] text-blue-600"
                  />
                  <span>
                    <strong className="text-slate-100">Veresiye / Tedarikçi Borcuna İşle:</strong>{' '}
                    Fatura bedelini seçili tedarikçi carisine borç olarak ekler.
                  </span>
                </label>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Açıklama</label>
                <input
                  type="text"
                  maxLength={300}
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setReflectTarget(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={reflectSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  {reflectSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Gider Defterine Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
