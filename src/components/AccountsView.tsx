import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  FileDown,
  FilePlus2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type {
  Account,
  AccountType,
  BusinessProfile,
  CurrencyCode,
  Invoice,
  PaymentMethod,
  Transaction,
  TransactionEntryKind,
} from '../types';
import {
  ACCOUNT_TYPE_LABELS,
  CURRENCY_LABELS,
  CURRENCY_OPTIONS,
  addDaysISO,
  daysUntilDue,
  formatCurrency,
  formatDateTR,
  formatNumberTR,
  formatTRY,
  todayISO,
} from '../utils/formatters';
import { fetchExchangeRates } from '../services/gibClient';
import { downloadAccountStatementPdf, type StatementPdfRow } from '../services/pdfService';

interface AccountsViewProps {
  businessProfile: BusinessProfile | null;
  accounts: Account[];
  transactions: Transaction[];
  invoices: Invoice[];
  focusAccountId?: string | null;
  onClearFocusAccount?: () => void;
  onCreateAccount: (
    input: Omit<Account, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  onUpdateAccount: (
    id: string,
    input: Omit<
      Account,
      'id' | 'ownerId' | 'balance' | 'usdBalance' | 'eurBalance' | 'gbpBalance' | 'createdAt' | 'updatedAt'
    >
  ) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onRecordPayment: (
    input: Omit<Transaction, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    options?: { nextDueDate?: string }
  ) => Promise<string>;
  onIssueInvoiceForAccount: (account: Account) => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  businessProfile,
  accounts,
  transactions,
  invoices,
  focusAccountId,
  onClearFocusAccount,
  onCreateAccount,
  onUpdateAccount,
  onDeleteAccount,
  onRecordPayment,
  onIssueInvoiceForAccount,
}) => {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | AccountType>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  // Account Form States
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [taxOffice, setTaxOffice] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('customer');
  const [currency, setCurrency] = useState<CurrencyCode>('TRY');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [openingRate, setOpeningRate] = useState('1');
  const [openingRateLoading, setOpeningRateLoading] = useState(false);
  const [paymentTermDays, setPaymentTermDays] = useState('0');
  const [nextDueDate, setNextDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Quick Payment / Foreign Sale Form
  const [entryMode, setEntryMode] = useState<'collection' | 'payment' | 'sale'>('collection');
  const [payAmount, setPayAmount] = useState('');
  const [payCurrency, setPayCurrency] = useState<CurrencyCode>('TRY');
  const [payRate, setPayRate] = useState('1');
  const [payRateLoading, setPayRateLoading] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payDate, setPayDate] = useState(todayISO());
  const [payNewDueDate, setPayNewDueDate] = useState('');
  const [payDesc, setPayDesc] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  // Ekstre Filters
  const [stmtStartDate, setStmtStartDate] = useState('');
  const [stmtEndDate, setStmtEndDate] = useState('');
  const [stmtCurrency, setStmtCurrency] = useState<CurrencyCode>('TRY');
  const [pdfExporting, setPdfExporting] = useState(false);

  useEffect(() => {
    if (focusAccountId) {
      setSelectedId(focusAccountId);
      onClearFocusAccount?.();
    }
  }, [focusAccountId, onClearFocusAccount]);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((acc) => {
      if (filterType !== 'all' && acc.accountType !== filterType) return false;
      if (q) {
        const hay = `${acc.name} ${acc.taxId} ${acc.phone} ${acc.city}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, filterType, search]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedId) || filteredAccounts[0] || null,
    [accounts, filteredAccounts, selectedId]
  );

  const selectedAccountTx = useMemo(() => {
    if (!selectedAccount) return [];
    return transactions.filter((t) => t.accountId === selectedAccount.id);
  }, [transactions, selectedAccount]);

  const selectedAccountInvoices = useMemo(() => {
    if (!selectedAccount) return [];
    return invoices.filter(
      (inv) =>
        inv.recipientAccountId === selectedAccount.id ||
        (selectedAccount.taxId && inv.recipientTaxId === selectedAccount.taxId)
    );
  }, [invoices, selectedAccount]);

  const totals = useMemo(() => {
    let receivable = 0;
    let payable = 0;
    for (const acc of accounts) {
      if (acc.balance > 0) receivable += acc.balance;
      else if (acc.balance < 0) payable += Math.abs(acc.balance);
    }
    return { receivable, payable };
  }, [accounts]);

  // Build 6-column Cari Ekstre (Tarih, Belge No, Açıklama, Borç, Alacak, Bakiye)
  const statementData = useMemo(() => {
    if (!selectedAccount) {
      return {
        rows: [] as StatementPdfRow[],
        totalDebit: 0,
        totalCredit: 0,
        closingBalance: 0,
      };
    }

    interface RawEvent {
      date: string;
      sortOrder: number;
      docNo: string;
      description: string;
      debit: number;
      credit: number;
    }

    const events: RawEvent[] = [];

    for (const inv of selectedAccountInvoices) {
      if (inv.status === 'cancelled') continue;
      const invCurr: CurrencyCode = inv.currency || 'TRY';
      if (stmtCurrency !== 'TRY' && invCurr !== stmtCurrency) continue;

      const rate = invCurr === 'TRY' ? 1 : Number(inv.exchangeRate) || 1;
      const val =
        stmtCurrency === 'TRY'
          ? invCurr === 'TRY'
            ? inv.grandTotal
            : Math.round(inv.grandTotal * rate * 100) / 100
          : inv.grandTotal;

      const isReturn = inv.invoiceType === 'IADE';
      events.push({
        date: inv.invoiceDate,
        sortOrder: 1,
        docNo: inv.invoiceNo || inv.ettn.slice(0, 8),
        description: `e-Arşiv Fatura (${invCurr !== 'TRY' && stmtCurrency === 'TRY' ? `${formatCurrency(inv.grandTotal, invCurr)} · ` : ''}${
          inv.status === 'approved' ? 'Onaylı' : 'Taslak'
        })`,
        debit: isReturn ? 0 : val,
        credit: isReturn ? val : 0,
      });
    }

    for (const tx of selectedAccountTx) {
      // Skip auto-mirrored ledger record created by approveInvoiceAndReflect so invoices aren't double-counted
      if (tx.invoiceId && !tx.affectsBalance) continue;
      if (!tx.affectsBalance) continue;

      const txCurr: CurrencyCode = tx.currency || 'TRY';
      if (stmtCurrency !== 'TRY' && txCurr !== stmtCurrency) continue;

      const origAmt = Number(tx.originalAmount ?? tx.amount) || tx.amount;
      const val = stmtCurrency === 'TRY' ? tx.amount : origAmt;
      const isDebit = tx.entryKind === 'sale' || tx.type === 'expense';
      const docLabel =
        tx.entryKind === 'sale'
          ? 'SATIŞ'
          : tx.type === 'income'
          ? 'TAHSİLAT'
          : 'ÖDEME';
      const fxNote =
        txCurr !== 'TRY' && stmtCurrency === 'TRY'
          ? ` (${formatCurrency(origAmt, txCurr)} @ ${formatNumberTR(Number(tx.exchangeRate) || 1)})`
          : '';

      events.push({
        date: tx.date,
        sortOrder: 2,
        docNo: docLabel,
        description: `${tx.description || tx.category}${fxNote}`,
        debit: isDebit ? val : 0,
        credit: isDebit ? 0 : val,
      });
    }

    events.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.sortOrder - b.sortOrder;
    });

    const targetBalance =
      stmtCurrency === 'TRY'
        ? selectedAccount.balance
        : stmtCurrency === 'USD'
        ? selectedAccount.usdBalance || 0
        : stmtCurrency === 'EUR'
        ? selectedAccount.eurBalance || 0
        : selectedAccount.gbpBalance || 0;

    const totalAllNet = events.reduce((acc, ev) => acc + ev.debit - ev.credit, 0);
    const implicitOpening = Math.round((targetBalance - totalAllNet) * 100) / 100;

    let prePeriodBalance = implicitOpening;
    const periodEvents: RawEvent[] = [];

    for (const ev of events) {
      if (stmtStartDate && ev.date < stmtStartDate) {
        prePeriodBalance += ev.debit - ev.credit;
      } else if (stmtEndDate && ev.date > stmtEndDate) {
        continue;
      } else {
        periodEvents.push(ev);
      }
    }

    prePeriodBalance = Math.round(prePeriodBalance * 100) / 100;

    const rows: StatementPdfRow[] = [];
    let running = prePeriodBalance;
    let totalDebit = 0;
    let totalCredit = 0;

    if (stmtStartDate || Math.abs(prePeriodBalance) > 0.005) {
      rows.push({
        date: stmtStartDate || '',
        docNo: 'DEVİR',
        description: stmtStartDate ? 'Önceki Dönemden Devir Bakiye' : 'Açılış Bakiyesi',
        debit: prePeriodBalance > 0 ? prePeriodBalance : 0,
        credit: prePeriodBalance < 0 ? Math.abs(prePeriodBalance) : 0,
        balance: prePeriodBalance,
      });
      if (prePeriodBalance > 0) totalDebit += prePeriodBalance;
      else if (prePeriodBalance < 0) totalCredit += Math.abs(prePeriodBalance);
    }

    for (const ev of periodEvents) {
      running = Math.round((running + ev.debit - ev.credit) * 100) / 100;
      totalDebit = Math.round((totalDebit + ev.debit) * 100) / 100;
      totalCredit = Math.round((totalCredit + ev.credit) * 100) / 100;
      rows.push({
        date: ev.date,
        docNo: ev.docNo,
        description: ev.description,
        debit: ev.debit,
        credit: ev.credit,
        balance: running,
      });
    }

    return {
      rows,
      totalDebit,
      totalCredit,
      closingBalance: running,
    };
  }, [selectedAccount, selectedAccountInvoices, selectedAccountTx, stmtCurrency, stmtStartDate, stmtEndDate]);

  const handleAccountCurrencyChange = async (nextCurr: CurrencyCode) => {
    setCurrency(nextCurr);
    if (nextCurr === 'TRY') {
      setOpeningRate('1');
      return;
    }
    setOpeningRateLoading(true);
    try {
      const resp = await fetchExchangeRates();
      if (resp.ok && resp.rates && resp.rates[nextCurr]) {
        setOpeningRate(String(resp.rates[nextCurr]));
      }
    } finally {
      setOpeningRateLoading(false);
    }
  };

  const openNewModal = () => {
    setEditingAccount(null);
    setName('');
    setTaxId('');
    setTaxOffice('');
    setPhone('');
    setEmail('');
    setAddress('');
    setCity('');
    setDistrict('');
    setAccountType('customer');
    setCurrency('TRY');
    setOpeningBalance('0');
    setOpeningRate('1');
    setPaymentTermDays('0');
    setNextDueDate('');
    setNotes('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (acc: Account) => {
    setEditingAccount(acc);
    setName(acc.name);
    setTaxId(acc.taxId);
    setTaxOffice(acc.taxOffice);
    setPhone(acc.phone);
    setEmail(acc.email);
    setAddress(acc.address);
    setCity(acc.city);
    setDistrict(acc.district);
    setAccountType(acc.accountType);
    setCurrency(acc.currency || 'TRY');
    setPaymentTermDays(String(acc.paymentTermDays ?? 0));
    setNextDueDate(acc.nextDueDate || '');
    setNotes(acc.notes);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Cari adı / ünvanı zorunludur.');
      return;
    }
    const cleanTax = taxId.replace(/\D/g, '');
    if (cleanTax && cleanTax.length !== 10 && cleanTax.length !== 11) {
      setFormError('VKN 10 haneli, TCKN 11 haneli olmalıdır.');
      return;
    }

    const termDaysNum = Math.max(0, Math.round(Number(paymentTermDays) || 0));

    setFormError(null);
    setSaving(true);
    try {
      if (editingAccount) {
        await onUpdateAccount(editingAccount.id, {
          name: name.trim(),
          taxId: cleanTax,
          taxOffice: taxOffice.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          city: city.trim(),
          district: district.trim(),
          accountType,
          currency,
          paymentTermDays: termDaysNum,
          nextDueDate: nextDueDate.trim(),
          notes: notes.trim(),
        });
      } else {
        const rawOpening = Number(String(openingBalance).replace(',', '.')) || 0;
        const rateNum = currency === 'TRY' ? 1 : Math.max(0.0001, Number(String(openingRate).replace(',', '.')) || 1);
        const tlBalance =
          currency === 'TRY' ? rawOpening : Math.round(rawOpening * rateNum * 100) / 100;

        const newId = await onCreateAccount({
          name: name.trim(),
          taxId: cleanTax,
          taxOffice: taxOffice.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          city: city.trim(),
          district: district.trim(),
          accountType,
          balance: tlBalance,
          currency,
          usdBalance: currency === 'USD' ? rawOpening : 0,
          eurBalance: currency === 'EUR' ? rawOpening : 0,
          gbpBalance: currency === 'GBP' ? rawOpening : 0,
          paymentTermDays: termDaysNum,
          nextDueDate: nextDueDate.trim(),
          notes: notes.trim(),
        });
        setSelectedId(newId);
      }
      setModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message || 'Cari kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const handlePayCurrencyChange = async (nextCurr: CurrencyCode) => {
    setPayCurrency(nextCurr);
    if (nextCurr === 'TRY') {
      setPayRate('1');
      return;
    }
    setPayRateLoading(true);
    try {
      const resp = await fetchExchangeRates();
      if (resp.ok && resp.rates && resp.rates[nextCurr]) {
        setPayRate(String(resp.rates[nextCurr]));
      }
    } finally {
      setPayRateLoading(false);
    }
  };

  const openPaymentModal = async (mode: 'collection' | 'payment' | 'sale') => {
    setEntryMode(mode);
    setPayAmount('');
    const defaultCurr = selectedAccount?.currency || 'TRY';
    setPayMethod(mode === 'sale' ? 'transfer' : 'cash');
    const today = todayISO();
    setPayDate(today);
    if (mode === 'sale' && selectedAccount?.paymentTermDays && selectedAccount.paymentTermDays > 0) {
      setPayNewDueDate(addDaysISO(today, selectedAccount.paymentTermDays));
    } else {
      setPayNewDueDate(selectedAccount?.nextDueDate || '');
    }
    setPayDesc('');
    setPaymentModalOpen(true);
    await handlePayCurrencyChange(defaultCurr);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    const origAmt = Number(String(payAmount).replace(',', '.'));
    if (!Number.isFinite(origAmt) || origAmt <= 0) return;

    const rateNum =
      payCurrency === 'TRY'
        ? 1
        : Math.max(0.0001, Number(String(payRate).replace(',', '.')) || 1);
    const tlAmount =
      payCurrency === 'TRY' ? origAmt : Math.round(origAmt * rateNum * 100) / 100;

    const txType: 'income' | 'expense' = entryMode === 'payment' ? 'expense' : 'income';
    const entryKind: TransactionEntryKind = entryMode;
    const category =
      entryMode === 'sale'
        ? 'Dövizli / Vadeli Satış'
        : entryMode === 'collection'
        ? 'Cari Tahsilat'
        : 'Cari Ödeme';
    const defaultDesc =
      entryMode === 'sale'
        ? `${selectedAccount.name} satış kaydı`
        : entryMode === 'collection'
        ? `${selectedAccount.name} cari tahsilatı`
        : `${selectedAccount.name} cari ödemesi`;

    setPaySaving(true);
    try {
      await onRecordPayment(
        {
          type: txType,
          category,
          amount: tlAmount,
          currency: payCurrency,
          originalAmount: origAmt,
          exchangeRate: rateNum,
          entryKind,
          vatRate: 0,
          description: payDesc.trim() || defaultDesc,
          date: payDate,
          paymentMethod: payMethod,
          accountId: selectedAccount.id,
          accountName: selectedAccount.name,
          invoiceId: '',
          affectsBalance: true,
        },
        entryMode === 'sale' && payNewDueDate
          ? { nextDueDate: payNewDueDate }
          : undefined
      );
      setPaymentModalOpen(false);
    } finally {
      setPaySaving(false);
    }
  };

  const handleExportStatementPdf = async () => {
    if (!selectedAccount) return;
    setPdfExporting(true);
    try {
      await downloadAccountStatementPdf({
        businessTitle: businessProfile?.title || 'Esnaf İşletmem',
        businessTaxId: businessProfile?.taxId || '',
        account: selectedAccount,
        startDate: stmtStartDate,
        endDate: stmtEndDate,
        currencyFilter: stmtCurrency,
        rows: statementData.rows,
        totalDebit: statementData.totalDebit,
        totalCredit: statementData.totalCredit,
        closingBalance: statementData.closingBalance,
      });
    } finally {
      setPdfExporting(false);
    }
  };

  const renderDueText = (dueDate?: string) => {
    if (!dueDate) return null;
    const diff = daysUntilDue(dueDate);
    if (diff < 0) {
      return (
        <span className="inline-flex items-center gap-1 text-red-400 font-medium">
          <AlertTriangle className="w-3 h-3" />
          Vade {Math.abs(diff)} gün geçti ({formatDateTR(dueDate)})
        </span>
      );
    }
    if (diff === 0) {
      return (
        <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
          <Calendar className="w-3 h-3" />
          Vade Bugün ({formatDateTR(dueDate)})
        </span>
      );
    }
    if (diff <= 14) {
      return (
        <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
          <Calendar className="w-3 h-3" />
          Vadeye {diff} gün ({formatDateTR(dueDate)})
        </span>
      );
    }
    return <span className="text-slate-400">Vade: {formatDateTR(dueDate)}</span>;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Cari Hesap Takibi</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            TL ve dövizli cari bakiyeler, vade takibi, tahsilat ve PDF ekstre
          </p>
        </div>
        <button
          type="button"
          onClick={openNewModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Yeni Cari Ekle
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl px-5 py-4">
          <div className="text-xs text-slate-400">Toplam Müşteri Alacağı (TL Karşılığı)</div>
          <div className="text-lg font-bold font-mono-num text-emerald-400 mt-1">
            {formatTRY(totals.receivable)}
          </div>
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl px-5 py-4">
          <div className="text-xs text-slate-400">Toplam Tedarikçi Borcu (TL Karşılığı)</div>
          <div className="text-lg font-bold font-mono-num text-red-400 mt-1">
            {formatTRY(totals.payable)}
          </div>
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl px-5 py-4">
          <div className="text-xs text-slate-400">Kayıtlı Cari Sayısı</div>
          <div className="text-lg font-bold font-mono-num text-slate-100 mt-1">
            {accounts.length} hesap
          </div>
        </div>
      </div>

      {/* Split Workspace: List + Detail Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left List */}
        <div className="lg:col-span-4 bg-[#131C2E] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
          <div className="p-3.5 border-b border-slate-800 space-y-2.5 bg-[#0F172A]">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Unvan, VKN/TCKN veya telefon ara..."
                className="w-full pl-9 pr-3 py-2 bg-[#131C2E] border border-slate-800 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-100"
              />
            </div>
            <div className="flex items-center gap-1 p-1 bg-[#131C2E] rounded-lg border border-slate-800 overflow-x-auto">
              {(['all', 'customer', 'supplier', 'both'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilterType(t)}
                  className={`flex-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    filterType === t
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t === 'all' ? 'Tümü' : ACCOUNT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {filteredAccounts.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <Users className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                {accounts.length === 0
                  ? 'Henüz müşteri veya tedarikçi cari hesabı açılmadı.'
                  : 'Aramanıza uygun cari hesap bulunamadı.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70 max-h-[600px] overflow-y-auto">
              {filteredAccounts.map((acc) => {
                const isSelected = selectedAccount?.id === acc.id;
                const dueDiff = acc.nextDueDate ? daysUntilDue(acc.nextDueDate) : 9999;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => setSelectedId(acc.id)}
                    className={`w-full px-4 py-3.5 text-left flex items-center justify-between gap-3 transition-colors ${
                      isSelected ? 'bg-blue-600/15' : 'hover:bg-slate-800/35'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-100 truncate">
                        {acc.name}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {ACCOUNT_TYPE_LABELS[acc.accountType]}
                        {acc.currency && acc.currency !== 'TRY' ? ` · ${acc.currency}` : ''}
                        {acc.taxId ? ` · ${acc.taxId}` : ''}
                      </div>
                      {acc.nextDueDate && dueDiff <= 14 && Math.abs(acc.balance) > 0.01 && (
                        <div
                          className={`text-[10px] font-medium mt-0.5 ${
                            dueDiff < 0 ? 'text-red-400' : 'text-amber-400'
                          }`}
                        >
                          {dueDiff < 0
                            ? `Vade ${Math.abs(dueDiff)} gün geçti`
                            : dueDiff === 0
                            ? 'Vade bugün'
                            : `Vadeye ${dueDiff} gün`}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`text-sm font-bold font-mono-num ${
                          acc.balance > 0
                            ? 'text-emerald-400'
                            : acc.balance < 0
                            ? 'text-red-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {formatTRY(Math.abs(acc.balance))}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {acc.balance > 0 ? 'Alacaklıyız' : acc.balance < 0 ? 'Borçluyuz' : 'Mutabık'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Detail Panel */}
        <div className="lg:col-span-8 bg-[#131C2E] border border-slate-800 rounded-xl p-5">
          {!selectedAccount ? (
            <div className="h-full min-h-[340px] flex flex-col items-center justify-center text-center space-y-3">
              <Users className="w-10 h-10 text-slate-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-300">Cari Hesap Seçin</p>
                <p className="text-xs text-slate-500">
                  Ekstreyi görmek, dövizli satış/tahsilat işlemek veya PDF çıktı almak için soldan bir cari seçin.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Account Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-100">{selectedAccount.name}</h3>
                    {selectedAccount.currency && selectedAccount.currency !== 'TRY' && (
                      <span className="text-xs font-mono-num font-semibold text-blue-400">
                        ({selectedAccount.currency} Carisi)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 flex flex-wrap gap-x-2 gap-y-1">
                    <span>{ACCOUNT_TYPE_LABELS[selectedAccount.accountType]}</span>
                    {selectedAccount.taxId && (
                      <>
                        <span>·</span>
                        <span className="font-mono-num">VKN/TC: {selectedAccount.taxId}</span>
                      </>
                    )}
                    {selectedAccount.taxOffice && (
                      <>
                        <span>·</span>
                        <span>VD: {selectedAccount.taxOffice}</span>
                      </>
                    )}
                    {selectedAccount.phone && (
                      <>
                        <span>·</span>
                        <span className="font-mono-num">{selectedAccount.phone}</span>
                      </>
                    )}
                  </div>
                  {selectedAccount.nextDueDate && (
                    <div className="text-xs pt-0.5">{renderDueText(selectedAccount.nextDueDate)}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(selectedAccount)}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
                    title="Cariyi Düzenle"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteAccount(selectedAccount.id)}
                    className="p-2 bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 rounded-lg transition-colors"
                    title="Cariyi Sil"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Balance & Quick Actions */}
              <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-slate-400">Güncel Cari Bakiye (TL Karşılığı)</div>
                    <div
                      className={`text-2xl font-bold font-mono-num mt-0.5 ${
                        selectedAccount.balance > 0
                          ? 'text-emerald-400'
                          : selectedAccount.balance < 0
                          ? 'text-red-400'
                          : 'text-slate-100'
                      }`}
                    >
                      {formatTRY(Math.abs(selectedAccount.balance))}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {selectedAccount.balance > 0
                        ? 'Müşteriden alacağınız var'
                        : selectedAccount.balance < 0
                        ? 'Tedarikçiye borcunuz var'
                        : 'Hesap bakiyesi sıfır'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openPaymentModal('sale')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Dövizli / Vadeli Satış
                    </button>
                    <button
                      type="button"
                      onClick={() => openPaymentModal('collection')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      Tahsilat Al
                    </button>
                    <button
                      type="button"
                      onClick={() => openPaymentModal('payment')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      Ödeme Yap
                    </button>
                    <button
                      type="button"
                      onClick={() => onIssueInvoiceForAccount(selectedAccount)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      <FilePlus2 className="w-3.5 h-3.5" />
                      Fatura Kes
                    </button>
                  </div>
                </div>

                {/* Foreign Currency Balances Strip */}
                {(Math.abs(selectedAccount.usdBalance || 0) > 0.005 ||
                  Math.abs(selectedAccount.eurBalance || 0) > 0.005 ||
                  Math.abs(selectedAccount.gbpBalance || 0) > 0.005) && (
                  <div className="pt-3 border-t border-slate-800 flex flex-wrap gap-4 text-xs">
                    {Math.abs(selectedAccount.usdBalance || 0) > 0.005 && (
                      <div>
                        <span className="text-slate-400">USD Bakiye: </span>
                        <span
                          className={`font-mono-num font-semibold ${
                            (selectedAccount.usdBalance || 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {formatCurrency(Math.abs(selectedAccount.usdBalance || 0), 'USD')}{' '}
                          {(selectedAccount.usdBalance || 0) > 0 ? '(B)' : '(A)'}
                        </span>
                      </div>
                    )}
                    {Math.abs(selectedAccount.eurBalance || 0) > 0.005 && (
                      <div>
                        <span className="text-slate-400">EUR Bakiye: </span>
                        <span
                          className={`font-mono-num font-semibold ${
                            (selectedAccount.eurBalance || 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {formatCurrency(Math.abs(selectedAccount.eurBalance || 0), 'EUR')}{' '}
                          {(selectedAccount.eurBalance || 0) > 0 ? '(B)' : '(A)'}
                        </span>
                      </div>
                    )}
                    {Math.abs(selectedAccount.gbpBalance || 0) > 0.005 && (
                      <div>
                        <span className="text-slate-400">GBP Bakiye: </span>
                        <span
                          className={`font-mono-num font-semibold ${
                            (selectedAccount.gbpBalance || 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {formatCurrency(Math.abs(selectedAccount.gbpBalance || 0), 'GBP')}{' '}
                          {(selectedAccount.gbpBalance || 0) > 0 ? '(B)' : '(A)'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Account Statement Filters & PDF Export */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-200">
                      Cari Ekstre (Tarih Aralıklı · Borç / Alacak / Bakiye)
                    </h4>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Başlangıç</label>
                      <input
                        type="date"
                        value={stmtStartDate}
                        onChange={(e) => setStmtStartDate(e.target.value)}
                        className="px-2.5 py-1.5 bg-[#0B1120] border border-slate-700 rounded-lg text-xs font-mono-num text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Bitiş</label>
                      <input
                        type="date"
                        value={stmtEndDate}
                        onChange={(e) => setStmtEndDate(e.target.value)}
                        className="px-2.5 py-1.5 bg-[#0B1120] border border-slate-700 rounded-lg text-xs font-mono-num text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Ekstre Dövizi</label>
                      <select
                        value={stmtCurrency}
                        onChange={(e) => setStmtCurrency(e.target.value as CurrencyCode)}
                        className="px-2.5 py-1.5 bg-[#0B1120] border border-slate-700 rounded-lg text-xs text-slate-100"
                      >
                        {CURRENCY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c === 'TRY' ? 'Tümü (TRY)' : c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportStatementPdf}
                      disabled={pdfExporting}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap min-h-[32px]"
                    >
                      {pdfExporting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5" />
                      )}
                      Ekstre PDF İndir
                    </button>
                  </div>
                </div>

                {/* 6-Column Cari Ekstre Table */}
                <div className="overflow-x-auto border border-slate-800 rounded-lg">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#0F172A] border-b border-slate-800 text-[11px] text-slate-400">
                        <th className="py-2.5 px-3">Tarih</th>
                        <th className="py-2.5 px-3">Belge No</th>
                        <th className="py-2.5 px-3">Açıklama</th>
                        <th className="py-2.5 px-3 text-right">Borç</th>
                        <th className="py-2.5 px-3 text-right">Alacak</th>
                        <th className="py-2.5 px-3 text-right">Bakiye</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {statementData.rows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 px-3 text-center text-slate-500">
                            Seçili tarih aralığı ve para biriminde cari hareketi bulunmuyor.
                          </td>
                        </tr>
                      ) : (
                        statementData.rows.map((row, idx) => (
                          <tr key={`${row.docNo}-${idx}`} className="hover:bg-slate-800/30">
                            <td className="py-2.5 px-3 font-mono-num text-slate-300 whitespace-nowrap">
                              {row.date ? formatDateTR(row.date) : '-'}
                            </td>
                            <td className="py-2.5 px-3 font-mono-num font-semibold text-slate-200 whitespace-nowrap">
                              {row.docNo}
                            </td>
                            <td className="py-2.5 px-3 text-slate-300">{row.description}</td>
                            <td className="py-2.5 px-3 text-right font-mono-num text-amber-300 whitespace-nowrap">
                              {row.debit > 0 ? formatCurrency(row.debit, stmtCurrency) : '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-num text-emerald-400 whitespace-nowrap">
                              {row.credit > 0 ? formatCurrency(row.credit, stmtCurrency) : '-'}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                                row.balance > 0
                                  ? 'text-emerald-400'
                                  : row.balance < 0
                                  ? 'text-red-400'
                                  : 'text-slate-300'
                              }`}
                            >
                              {formatCurrency(Math.abs(row.balance), stmtCurrency)}{' '}
                              {row.balance > 0 ? '(B)' : row.balance < 0 ? '(A)' : ''}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {statementData.rows.length > 0 && (
                      <tfoot>
                        <tr className="bg-[#0F172A] border-t border-slate-700 font-semibold text-slate-100">
                          <td colSpan={3} className="py-2.5 px-3 text-right">
                            Dönem Toplamı
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num text-amber-300 whitespace-nowrap">
                            {formatCurrency(statementData.totalDebit, stmtCurrency)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num text-emerald-400 whitespace-nowrap">
                            {formatCurrency(statementData.totalCredit, stmtCurrency)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num whitespace-nowrap">
                            {formatCurrency(Math.abs(statementData.closingBalance), stmtCurrency)}{' '}
                            {statementData.closingBalance > 0
                              ? '(B)'
                              : statementData.closingBalance < 0
                              ? '(A)'
                              : ''}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Account Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-xl bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
              <h3 className="text-base font-semibold text-slate-100">
                {editingAccount ? 'Cari Hesabı Düzenle' : 'Yeni Cari Hesap'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAccount} className="p-5 space-y-4">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Unvan / Ad Soyad *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn: Özkan Elektrik İnşaat Ltd. Şti."
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Cari Türü
                  </label>
                  <select
                    value={accountType}
                    onChange={(e) => setAccountType(e.target.value as AccountType)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    <option value="customer">Müşteri</option>
                    <option value="supplier">Tedarikçi</option>
                    <option value="both">Müşteri &amp; Tedarikçi</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Varsayılan Döviz
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => handleAccountCurrencyChange(e.target.value as CurrencyCode)}
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Vergi Dairesi
                  </label>
                  <input
                    type="text"
                    value={taxOffice}
                    onChange={(e) => setTaxOffice(e.target.value)}
                    placeholder="Örn: Şişli"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Vade Günü (Ops.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="3650"
                    value={paymentTermDays}
                    onChange={(e) => setPaymentTermDays(e.target.value)}
                    placeholder="Örn: 30"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Sonraki Vade Tarihi
                  </label>
                  <input
                    type="date"
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                  />
                </div>
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
                    placeholder="ornek@firma.com"
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
                    placeholder="Beşiktaş"
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
                  placeholder="Fatura adresi..."
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
              </div>

              {!editingAccount && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Açılış Bakiyesi ({currency}) — Alacak (+), Borç (-)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    />
                  </div>
                  {currency !== 'TRY' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Açılış Kuru (1 {currency} = ? TRY)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          value={openingRate}
                          onChange={(e) => setOpeningRate(e.target.value)}
                          className="flex-1 px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                        />
                        {openingRateLoading && <Loader2 className="w-4 h-4 animate-spin self-center text-blue-400" />}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Notlar</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Vade veya özel not..."
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingAccount ? 'Güncelle' : 'Cari Aç'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Foreign Sale / Collection / Payment Modal */}
      {paymentModalOpen && selectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
              <h3 className="text-base font-semibold text-slate-100">
                {entryMode === 'sale'
                  ? 'Dövizli / Vadeli Satış Kaydı'
                  : entryMode === 'collection'
                  ? 'Cari Tahsilat Al'
                  : 'Cari Ödeme Yap'}
              </h3>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handlePaymentSubmit} className="p-5 space-y-4">
              <div className="text-xs text-slate-300 bg-[#0F172A] px-3 py-2.5 rounded-lg border border-slate-800">
                Cari: <span className="font-semibold text-slate-100">{selectedAccount.name}</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#0B1120] border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setEntryMode('sale')}
                  className={`py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                    entryMode === 'sale' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Satış (Borç)
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode('collection')}
                  className={`py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                    entryMode === 'collection'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tahsilat Al
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode('payment')}
                  className={`py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                    entryMode === 'payment'
                      ? 'bg-red-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Ödeme Yap
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Para Birimi
                  </label>
                  <select
                    value={payCurrency}
                    onChange={(e) => handlePayCurrencyChange(e.target.value as CurrencyCode)}
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
                    Tutar ({payCurrency}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    required
                    autoFocus
                  />
                </div>
              </div>

              {payCurrency !== 'TRY' && (
                <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-slate-300">
                      Döviz Kuru (1 {payCurrency} = ? TRY)
                    </label>
                    <button
                      type="button"
                      onClick={() => handlePayCurrencyChange(payCurrency)}
                      disabled={payRateLoading}
                      className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                    >
                      {payRateLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      TCMB Kuru
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <input
                      type="number"
                      step="0.0001"
                      min="0.0001"
                      value={payRate}
                      onChange={(e) => setPayRate(e.target.value)}
                      className="w-32 px-2.5 py-1.5 bg-[#131C2E] border border-slate-700 rounded-lg text-xs font-mono-num text-slate-100"
                    />
                    <span className="text-xs font-mono-num text-slate-300">
                      TL:{' '}
                      {formatTRY(
                        (Number(String(payAmount).replace(',', '.')) || 0) *
                          (Number(String(payRate).replace(',', '.')) || 1)
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Tarih</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Ödeme Kanalı
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    <option value="cash">Nakit Kasa</option>
                    <option value="bank">Banka Hesabı</option>
                    <option value="pos">Kredi Kartı / POS</option>
                    <option value="transfer">Havale / EFT</option>
                  </select>
                </div>
              </div>

              {entryMode === 'sale' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Vade Tarihi (Opsiyonel Bildirim İçin)
                  </label>
                  <input
                    type="date"
                    value={payNewDueDate}
                    onChange={(e) => setPayNewDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Açıklama
                </label>
                <input
                  type="text"
                  value={payDesc}
                  onChange={(e) => setPayDesc(e.target.value)}
                  placeholder="Belge no, ürün veya ödeme açıklaması..."
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={paySaving}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  {paySaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  İşlemi Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
