import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  FilePlus2,
  Landmark,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type {
  Account,
  ActiveTab,
  CheckNote,
  CheckNoteDirection,
  CheckNoteKind,
  CheckNoteStatus,
  CurrencyCode,
  Invoice,
  Transaction,
} from '../types';
import {
  CURRENCY_LABELS,
  CURRENCY_OPTIONS,
  daysUntilDue,
  formatCurrency,
  formatDateTR,
  formatTRY,
  todayISO,
} from '../utils/formatters';
import { fetchExchangeRates } from '../services/gibClient';

interface DashboardViewProps {
  transactions: Transaction[];
  accounts: Account[];
  invoices: Invoice[];
  checksNotes: CheckNote[];
  onNavigate: (tab: ActiveTab) => void;
  onOpenAccount: (accountId: string) => void;
  onQuickAddTransaction: () => void;
  onPreviewInvoice: (invoice: Invoice) => void;
  onCreateCheckNote: (
    input: Omit<CheckNote, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  onUpdateCheckNoteStatus: (id: string, status: CheckNoteStatus) => Promise<void>;
  onDeleteCheckNote: (id: string) => Promise<void>;
}

const MONTH_NAMES_TR = [
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  transactions,
  accounts,
  invoices,
  checksNotes,
  onNavigate,
  onOpenAccount,
  onQuickAddTransaction,
  onPreviewInvoice,
  onCreateCheckNote,
  onUpdateCheckNoteStatus,
  onDeleteCheckNote,
}) => {
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const [checkFilter, setCheckFilter] = useState<'pending' | 'all'>('pending');
  const [checkModalOpen, setCheckModalOpen] = useState(false);

  // Check / Note Form States
  const [kind, setKind] = useState<CheckNoteKind>('cek');
  const [direction, setDirection] = useState<CheckNoteDirection>('receivable');
  const [documentNo, setDocumentNo] = useState('');
  const [bankOrIssuer, setBankOrIssuer] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('TRY');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [rateLoading, setRateLoading] = useState(false);
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [savingCheck, setSavingCheck] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const currentMonthPrefix = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const kpis = useMemo(() => {
    let monthIncome = 0;
    let monthExpense = 0;
    let totalIncome = 0;
    let totalExpense = 0;

    for (const tx of transactions) {
      if (tx.entryKind === 'sale') continue;
      if (tx.type === 'income') {
        totalIncome += tx.amount;
        if (tx.date.startsWith(currentMonthPrefix)) monthIncome += tx.amount;
      } else {
        totalExpense += tx.amount;
        if (tx.date.startsWith(currentMonthPrefix)) monthExpense += tx.amount;
      }
    }

    let receivables = 0;
    let payables = 0;
    const fxReceivable: Record<'USD' | 'EUR' | 'GBP', number> = { USD: 0, EUR: 0, GBP: 0 };
    const fxPayable: Record<'USD' | 'EUR' | 'GBP', number> = { USD: 0, EUR: 0, GBP: 0 };

    for (const acc of accounts) {
      if (acc.balance > 0) receivables += acc.balance;
      else if (acc.balance < 0) payables += Math.abs(acc.balance);

      const usd = acc.usdBalance || 0;
      const eur = acc.eurBalance || 0;
      const gbp = acc.gbpBalance || 0;
      if (usd > 0) fxReceivable.USD += usd;
      else if (usd < 0) fxPayable.USD += Math.abs(usd);
      if (eur > 0) fxReceivable.EUR += eur;
      else if (eur < 0) fxPayable.EUR += Math.abs(eur);
      if (gbp > 0) fxReceivable.GBP += gbp;
      else if (gbp < 0) fxPayable.GBP += Math.abs(gbp);
    }

    const approvedInvoices = invoices.filter((inv) => inv.status === 'approved');
    const monthInvoicesTotal = approvedInvoices
      .filter((inv) => inv.invoiceDate.startsWith(currentMonthPrefix))
      .reduce((sum, inv) => {
        const curr = inv.currency || 'TRY';
        const rate = curr === 'TRY' ? 1 : Number(inv.exchangeRate) || 1;
        return sum + inv.grandTotal * rate;
      }, 0);

    return {
      monthIncome,
      monthExpense,
      monthNet: monthIncome - monthExpense,
      totalNet: totalIncome - totalExpense,
      receivables,
      payables,
      fxReceivable,
      fxPayable,
      approvedCount: approvedInvoices.length,
      monthInvoicesTotal,
    };
  }, [transactions, accounts, invoices, currentMonthPrefix]);

  const hasForeignSummary = useMemo(
    () =>
      (['USD', 'EUR', 'GBP'] as const).some(
        (c) => kpis.fxReceivable[c] > 0.005 || kpis.fxPayable[c] > 0.005
      ),
    [kpis]
  );

  // Upcoming / overdue Checks & Notes (<= 7 days)
  const urgentChecks = useMemo(
    () =>
      checksNotes
        .filter((c) => c.status === 'pending' && daysUntilDue(c.dueDate) <= 7)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [checksNotes]
  );

  // Upcoming / overdue Accounts (<= 14 days, non-zero balance)
  const dueAccounts = useMemo(
    () =>
      accounts
        .filter(
          (a) =>
            Boolean(a.nextDueDate) &&
            daysUntilDue(a.nextDueDate!) <= 14 &&
            Math.abs(a.balance) > 0.01
        )
        .sort((a, b) => (a.nextDueDate || '').localeCompare(b.nextDueDate || '')),
    [accounts]
  );

  const displayedChecks = useMemo(() => {
    const list =
      checkFilter === 'pending'
        ? checksNotes.filter((c) => c.status === 'pending')
        : checksNotes;
    return list.slice(0, 10);
  }, [checksNotes, checkFilter]);

  const monthlySeries = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string; income: number; expense: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        key,
        label: `${MONTH_NAMES_TR[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,
        income: 0,
        expense: 0,
      });
    }

    const map = new Map(months.map((m) => [m.key, m]));
    for (const tx of transactions) {
      if (tx.entryKind === 'sale') continue;
      const key = tx.date.slice(0, 7);
      const entry = map.get(key);
      if (entry) {
        if (tx.type === 'income') entry.income += tx.amount;
        else entry.expense += tx.amount;
      }
    }
    return months;
  }, [transactions]);

  const maxChartValue = useMemo(() => {
    const maxVal = Math.max(
      1000,
      ...monthlySeries.map((m) => Math.max(m.income, m.expense))
    );
    return maxVal * 1.15;
  }, [monthlySeries]);

  const handleCheckCurrencyChange = async (nextCurr: CurrencyCode) => {
    setCurrency(nextCurr);
    if (nextCurr === 'TRY') {
      setExchangeRate('1');
      return;
    }
    setRateLoading(true);
    try {
      const resp = await fetchExchangeRates();
      if (resp.ok && resp.rates && resp.rates[nextCurr]) {
        setExchangeRate(String(resp.rates[nextCurr]));
      }
    } finally {
      setRateLoading(false);
    }
  };

  const openCheckModal = () => {
    setKind('cek');
    setDirection('receivable');
    setDocumentNo('');
    setBankOrIssuer('');
    setAccountId('');
    setAmount('');
    setCurrency('TRY');
    setExchangeRate('1');
    setIssueDate(todayISO());
    setDueDate(todayISO());
    setNotes('');
    setCheckError(null);
    setCheckModalOpen(true);
  };

  const handleCreateCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(numAmt) || numAmt <= 0) {
      setCheckError('Lütfen 0’dan büyük bir tutar girin.');
      return;
    }
    if (!bankOrIssuer.trim()) {
      setCheckError('Banka veya keşideci bilgisi zorunludur.');
      return;
    }
    const rateNum =
      currency === 'TRY'
        ? 1
        : Math.max(0.0001, Number(String(exchangeRate).replace(',', '.')) || 1);
    const amountTry =
      currency === 'TRY' ? numAmt : Math.round(numAmt * rateNum * 100) / 100;
    const acc = accounts.find((a) => a.id === accountId);

    setCheckError(null);
    setSavingCheck(true);
    try {
      await onCreateCheckNote({
        kind,
        direction,
        documentNo: documentNo.trim(),
        bankOrIssuer: bankOrIssuer.trim(),
        accountId: acc?.id || '',
        accountName: acc?.name || '',
        amount: numAmt,
        currency,
        exchangeRate: rateNum,
        amountTry,
        issueDate,
        dueDate,
        status: 'pending',
        notes: notes.trim(),
      });
      setCheckModalOpen(false);
    } catch (err: any) {
      setCheckError(err?.message || 'Çek/senet kaydedilemedi.');
    } finally {
      setSavingCheck(false);
    }
  };

  const renderDueBadge = (dueISO: string) => {
    const diff = daysUntilDue(dueISO);
    if (diff < 0) {
      return (
        <span className="text-[11px] font-semibold text-red-400">
          {Math.abs(diff)} gün gecikmiş
        </span>
      );
    }
    if (diff === 0) {
      return <span className="text-[11px] font-semibold text-amber-400">Vadesi Bugün</span>;
    }
    if (diff <= 7) {
      return <span className="text-[11px] font-semibold text-amber-300">{diff} gün kaldı</span>;
    }
    return <span className="text-[11px] text-slate-400">{diff} gün kaldı</span>;
  };

  const recentTransactions = transactions.slice(0, 5);
  const recentInvoices = invoices.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Quick Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">İşletme Özeti</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Nakit akışı, çek-senet vade bildirimleri, vadesi yaklaşan cariler ve dövizli cari özeti
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={openCheckModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#131C2E] hover:bg-slate-800 border border-slate-700 text-amber-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Landmark className="w-4 h-4" />
            Çek / Senet Ekle
          </button>
          <button
            type="button"
            onClick={onQuickAddTransaction}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#131C2E] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            Gelir / Gider Ekle
          </button>
          <button
            type="button"
            onClick={() => onNavigate('invoice')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-4 h-4" />
            Yeni e-Arşiv Fatura
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Bu Ay Toplam Gelir</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-emerald-400">
            {formatTRY(kpis.monthIncome)}
          </div>
          <div className="text-xs text-slate-400">
            Onaylı fatura toplamı:{' '}
            <span className="font-mono-num text-slate-300">
              {formatTRY(kpis.monthInvoicesTotal)}
            </span>
          </div>
        </div>

        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Bu Ay Toplam Gider</span>
            <ArrowUpRight className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-red-400">
            {formatTRY(kpis.monthExpense)}
          </div>
          <div className="text-xs text-slate-400">
            Kayıtlı işlem:{' '}
            <span className="font-mono-num text-slate-300">
              {transactions.filter((t) => t.date.startsWith(currentMonthPrefix)).length} adet
            </span>
          </div>
        </div>

        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Net Nakit Akışı (Bu Ay)</span>
            <Wallet className="w-4 h-4 text-blue-400" />
          </div>
          <div
            className={`text-2xl font-bold font-mono-num ${
              kpis.monthNet >= 0 ? 'text-slate-100' : 'text-red-400'
            }`}
          >
            {formatTRY(kpis.monthNet)}
          </div>
          <div className="text-xs text-slate-400">
            Genel kasa bakiyesi:{' '}
            <span className="font-mono-num text-slate-300">{formatTRY(kpis.totalNet)}</span>
          </div>
        </div>

        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Cari Alacak / Borç</span>
            <Receipt className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono-num text-slate-100">
            {formatTRY(kpis.receivables)}
          </div>
          <div className="text-xs text-slate-400">
            Tedarikçi borcu:{' '}
            <span className="font-mono-num text-red-300">{formatTRY(kpis.payables)}</span> ·{' '}
            {accounts.length} cari
          </div>
        </div>
      </div>

      {/* Urgent Due Notifications Banner (Checks/Notes <= 7 days + Accounts <= 14 days) */}
      {(urgentChecks.length > 0 || dueAccounts.length > 0) && (
        <div className="bg-[#131C2E] border border-amber-500/35 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Bell className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="text-sm font-semibold text-amber-200">
                Vadesi Gelen Çek, Senet ve Cari Bildirimleri
              </h3>
            </div>
            <span className="text-xs text-amber-300/90 font-mono-num">
              {urgentChecks.length} çek/senet · {dueAccounts.length} cari vade uyarısı
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {urgentChecks.slice(0, 4).map((item) => (
              <div
                key={item.id}
                className="bg-[#0B1120] border border-slate-800 rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-100 truncate">
                    {item.kind === 'cek' ? 'Çek' : 'Senet'} ({item.direction === 'receivable' ? 'Alınan' : 'Verilen'}) · {item.bankOrIssuer}
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                    <span className="font-mono-num">{formatDateTR(item.dueDate)}</span>
                    <span>·</span>
                    {renderDueBadge(item.dueDate)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold font-mono-num text-slate-100">
                    {formatCurrency(item.amount, item.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCheckNoteStatus(
                        item.id,
                        item.direction === 'receivable' ? 'collected' : 'paid'
                      )
                    }
                    className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap"
                  >
                    {item.direction === 'receivable' ? 'Tahsil Et' : 'Öde'}
                  </button>
                </div>
              </div>
            ))}

            {dueAccounts.slice(0, 4).map((acc) => (
              <div
                key={acc.id}
                className="bg-[#0B1120] border border-slate-800 rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-100 truncate">
                    Cari: {acc.name}
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                    <span className="font-mono-num">{formatDateTR(acc.nextDueDate || '')}</span>
                    <span>·</span>
                    {acc.nextDueDate && renderDueBadge(acc.nextDueDate)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-xs font-bold font-mono-num ${
                      acc.balance > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatTRY(Math.abs(acc.balance))}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenAccount(acc.id)}
                    className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap"
                  >
                    Cariye Git
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Foreign Currency Accounts Summary (when non-zero USD/EUR/GBP exists) */}
      {hasForeignSummary && (
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">Dövizli Cari Bakiyeleri Özeti</h3>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Carilere Git
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['USD', 'EUR', 'GBP'] as const).map((curr) => {
              const rec = kpis.fxReceivable[curr];
              const pay = kpis.fxPayable[curr];
              if (rec < 0.01 && pay < 0.01) return null;
              return (
                <div
                  key={curr}
                  className="bg-[#0B1120] border border-slate-800 rounded-lg px-4 py-3 flex items-center justify-between"
                >
                  <span className="text-xs font-bold text-slate-200">{curr} Carileri</span>
                  <div className="text-right font-mono-num text-xs space-y-0.5">
                    {rec > 0.01 && (
                      <div className="text-emerald-400 font-semibold">
                        Alacak: {formatCurrency(rec, curr)}
                      </div>
                    )}
                    {pay > 0.01 && (
                      <div className="text-red-400 font-semibold">
                        Borç: {formatCurrency(pay, curr)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Checks & Notes Portfolio + Upcoming Due Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Checks & Promissory Notes */}
        <div className="lg:col-span-7 bg-[#131C2E] border border-slate-800 rounded-xl p-5 flex flex-col space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Çek &amp; Senet Portföyü</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Vadesi yaklaşan alınan/verilen çek ve senet takibi
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-0.5 bg-[#0B1120] border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setCheckFilter('pending')}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${
                    checkFilter === 'pending'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Bekleyenler
                </button>
                <button
                  type="button"
                  onClick={() => setCheckFilter('all')}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${
                    checkFilter === 'all'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tümü
                </button>
              </div>
              <button
                type="button"
                onClick={openCheckModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Ekle
              </button>
            </div>
          </div>

          {displayedChecks.length === 0 ? (
            <div className="py-8 text-center space-y-2.5">
              <Landmark className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                {checksNotes.length === 0
                  ? 'Henüz çek veya senet kaydı eklenmedi.'
                  : 'Bekleyen çek veya senet bulunmuyor.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                    <th className="py-2 pr-3">Vade</th>
                    <th className="py-2 pr-3">Tür &amp; Keşideci / Banka</th>
                    <th className="py-2 pr-3 text-right">Tutar</th>
                    <th className="py-2 text-right">Durum / İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {displayedChecks.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <div className="font-mono-num text-slate-200">
                          {formatDateTR(item.dueDate)}
                        </div>
                        {item.status === 'pending' && renderDueBadge(item.dueDate)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-100">
                          {item.kind === 'cek' ? 'Çek' : 'Senet'} (
                          {item.direction === 'receivable' ? 'Alınan' : 'Verilen'}) ·{' '}
                          {item.bankOrIssuer}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate max-w-xs">
                          {item.documentNo ? `No: ${item.documentNo}` : ''}
                          {item.documentNo && item.accountName ? ' · ' : ''}
                          {item.accountName}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono-num whitespace-nowrap">
                        <div
                          className={`font-semibold ${
                            item.direction === 'receivable' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {formatCurrency(item.amount, item.currency)}
                        </div>
                        {item.currency !== 'TRY' && (
                          <div className="text-[10px] text-slate-400">
                            {formatTRY(item.amountTry)}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {item.status === 'pending' ? (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateCheckNoteStatus(
                                  item.id,
                                  item.direction === 'receivable' ? 'collected' : 'paid'
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 rounded text-[11px] font-semibold"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {item.direction === 'receivable' ? 'Tahsil Edildi' : 'Ödendi'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">
                              {item.status === 'collected'
                                ? 'Tahsil Edildi'
                                : item.status === 'paid'
                                ? 'Ödendi'
                                : 'Karşılıksız'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteCheckNote(item.id)}
                            className="p-1 text-slate-500 hover:text-red-400"
                            title="Sil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Upcoming Due Accounts */}
        <div className="lg:col-span-5 bg-[#131C2E] border border-slate-800 rounded-xl p-5 flex flex-col space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Vadesi Yaklaşan Cariler</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Vadesi geçmiş veya 14 gün içinde vadesi dolacak cariler
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
            >
              Tüm Cariler
            </button>
          </div>

          {dueAccounts.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8 space-y-2.5">
              <CalendarClock className="w-8 h-8 text-slate-600" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-300">
                  Vadesi yaklaşan veya geçmiş cari hesap yok
                </p>
                <p className="text-[11px] text-slate-500">
                  Cari Takip sayfasından carilerinize vade tarihi ekleyebilirsiniz.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('accounts')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
              >
                <Users className="w-3.5 h-3.5" />
                Carileri Görüntüle
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {dueAccounts.slice(0, 6).map((acc) => (
                <div
                  key={acc.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-100 truncate">{acc.name}</div>
                    <div className="flex items-center gap-2 text-xs mt-0.5">
                      <span className="font-mono-num text-slate-400">
                        {formatDateTR(acc.nextDueDate || '')}
                      </span>
                      <span>·</span>
                      {acc.nextDueDate && renderDueBadge(acc.nextDueDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <div
                        className={`text-xs font-bold font-mono-num ${
                          acc.balance > 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatTRY(Math.abs(acc.balance))}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {acc.balance > 0 ? 'Alacaklıyız' : 'Borçluyuz'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenAccount(acc.id)}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded-lg whitespace-nowrap"
                    >
                      Aç
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Split: 6-Month Chart + Recent Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Cashflow Chart */}
        <div className="lg:col-span-7 bg-[#131C2E] border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">6 Aylık Gelir ve Gider Dengesi</h3>
              <p className="text-xs text-slate-400 mt-0.5">Son 6 ayın aylık karşılaştırması</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                Gelir
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
                Gider
              </span>
            </div>
          </div>

          <div className="relative h-56 flex items-end justify-between gap-3 pt-6 pb-2 border-b border-slate-800">
            <div className="absolute inset-x-0 top-6 bottom-2 flex flex-col justify-between pointer-events-none">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="border-t border-slate-800/70 w-full" />
              ))}
            </div>

            {monthlySeries.map((m) => {
              const incPct = Math.min(100, Math.round((m.income / maxChartValue) * 100));
              const expPct = Math.min(100, Math.round((m.expense / maxChartValue) * 100));
              const isHovered = hoveredMonth === m.key;

              return (
                <div
                  key={m.key}
                  onMouseEnter={() => setHoveredMonth(m.key)}
                  onMouseLeave={() => setHoveredMonth(null)}
                  className="relative flex-1 h-full flex flex-col items-center justify-end group"
                >
                  {isHovered && (
                    <div className="absolute -top-2 z-10 bg-[#0B1120] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] shadow-xl whitespace-nowrap pointer-events-none">
                      <div className="font-semibold text-slate-200 mb-0.5">{m.label}</div>
                      <div className="text-emerald-400 font-mono-num">
                        Gelir: {formatTRY(m.income)}
                      </div>
                      <div className="text-red-400 font-mono-num">
                        Gider: {formatTRY(m.expense)}
                      </div>
                    </div>
                  )}
                  <div className="w-full flex items-end justify-center gap-1.5 h-full z-0">
                    <div
                      style={{ height: `${Math.max(m.income > 0 ? 4 : 0, incPct)}%` }}
                      className="w-4 sm:w-6 bg-emerald-500/85 group-hover:bg-emerald-400 rounded-t transition-all duration-150"
                    />
                    <div
                      style={{ height: `${Math.max(m.expense > 0 ? 4 : 0, expPct)}%` }}
                      className="w-4 sm:w-6 bg-red-500/80 group-hover:bg-red-400 rounded-t transition-all duration-150"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 pt-2.5">
            {monthlySeries.map((m) => (
              <div key={m.key} className="flex-1 text-center text-[11px] text-slate-400 font-medium">
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="lg:col-span-5 bg-[#131C2E] border border-slate-800 rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h3 className="text-sm font-semibold text-slate-100">Son e-Arşiv Faturalar</h3>
            <button
              type="button"
              onClick={() => onNavigate('archive')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
            >
              Tüm Arşivi Gör
            </button>
          </div>

          {recentInvoices.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8 space-y-3">
              <Receipt className="w-8 h-8 text-slate-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-300">Henüz fatura kesilmedi</p>
                <p className="text-xs text-slate-500">
                  İlk e-Arşiv faturanızı önizleyip SMS ile onaylayarak arşivleyebilirsiniz.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('invoice')}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                İlk Faturayı Oluştur
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {recentInvoices.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => onPreviewInvoice(inv)}
                  className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-800/35 px-2 -mx-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-100 truncate">
                      {inv.recipientName}
                    </div>
                    <div className="text-xs text-slate-400 font-mono-num truncate">
                      {inv.invoiceNo} · {formatDateTR(inv.invoiceDate)} ·{' '}
                      <span
                        className={
                          inv.status === 'approved'
                            ? 'text-emerald-400'
                            : inv.status === 'cancelled'
                            ? 'text-red-400'
                            : 'text-amber-400'
                        }
                      >
                        {inv.status === 'approved'
                          ? 'Onaylı'
                          : inv.status === 'cancelled'
                          ? 'İptal'
                          : 'Taslak'}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm font-semibold font-mono-num text-slate-100 whitespace-nowrap shrink-0">
                    {formatCurrency(inv.grandTotal, inv.currency || 'TRY')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Ledger Transactions */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-semibold text-slate-100">Son Gelir-Gider Hareketleri</h3>
          <button
            type="button"
            onClick={() => onNavigate('ledger')}
            className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
          >
            Deftere Git
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-slate-400">Henüz gelir veya gider hareketi eklenmedi.</p>
            <button
              type="button"
              onClick={onQuickAddTransaction}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors"
            >
              İlk Kaydı Ekle
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400">
                  <th className="py-2.5 pr-4">Tarih</th>
                  <th className="py-2.5 pr-4">Kategori &amp; Açıklama</th>
                  <th className="py-2.5 pr-4">Cari Hesap</th>
                  <th className="py-2.5 text-right">Tutar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {recentTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/30">
                    <td className="py-3 pr-4 font-mono-num text-slate-300 whitespace-nowrap">
                      {formatDateTR(tx.date)}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-100">{tx.category}</div>
                      {tx.description && (
                        <div className="text-slate-400 truncate max-w-md">{tx.description}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-300">
                      {tx.accountName || <span className="text-slate-500">-</span>}
                    </td>
                    <td
                      className={`py-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                        tx.entryKind === 'sale'
                          ? 'text-amber-300'
                          : tx.type === 'income'
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : '-'}
                      {formatTRY(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Check / Promissory Note Modal */}
      {checkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
              <h3 className="text-base font-semibold text-slate-100">Yeni Çek / Senet Kaydı</h3>
              <button
                type="button"
                onClick={() => setCheckModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCheck} className="p-5 space-y-4">
              {checkError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{checkError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B1120] border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setKind('cek')}
                    className={`py-1.5 text-xs font-semibold rounded-md ${
                      kind === 'cek' ? 'bg-blue-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Çek
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind('senet')}
                    className={`py-1.5 text-xs font-semibold rounded-md ${
                      kind === 'senet' ? 'bg-blue-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Senet
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B1120] border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setDirection('receivable')}
                    className={`py-1.5 text-xs font-semibold rounded-md ${
                      direction === 'receivable' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Alınan
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('payable')}
                    className={`py-1.5 text-xs font-semibold rounded-md ${
                      direction === 'payable' ? 'bg-red-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Verilen
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Banka / Keşideci *
                  </label>
                  <input
                    type="text"
                    value={bankOrIssuer}
                    onChange={(e) => setBankOrIssuer(e.target.value)}
                    placeholder="Örn: Garanti BBVA / Yılmaz A.Ş."
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Seri / Evrak No
                  </label>
                  <input
                    type="text"
                    value={documentNo}
                    onChange={(e) => setDocumentNo(e.target.value)}
                    placeholder="Örn: ÇK-2026-014"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Para Birimi
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => handleCheckCurrencyChange(e.target.value as CurrencyCode)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {CURRENCY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tutar ({currency}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    required
                  />
                </div>
              </div>

              {currency !== 'TRY' && (
                <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-300">Kur (1 {currency}):</label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0.0001"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(e.target.value)}
                      className="w-28 px-2.5 py-1.5 bg-[#131C2E] border border-slate-700 rounded-lg text-xs font-mono-num text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => handleCheckCurrencyChange(currency)}
                      disabled={rateLoading}
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                    >
                      {rateLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      TCMB
                    </button>
                  </div>
                  <div className="text-xs font-mono-num text-slate-300">
                    {formatTRY(
                      (Number(String(amount).replace(',', '.')) || 0) *
                        (Number(String(exchangeRate).replace(',', '.')) || 1)
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Düzenleme Tarihi
                  </label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Vade Tarihi *
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Bağlı Cari Hesap (İsteğe Bağlı)
                </label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                >
                  <option value="">Cari Seçilmedi</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Notlar</label>
                <input
                  type="text"
                  maxLength={300}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Şube veya evrak notu..."
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCheckModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={savingCheck}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  {savingCheck && <Loader2 className="w-4 h-4 animate-spin" />}
                  Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
