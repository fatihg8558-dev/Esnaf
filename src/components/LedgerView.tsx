import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Account,
  CurrencyCode,
  ExpenseCategory,
  PaymentMethod,
  Transaction,
  TransactionType,
} from '../types';
import {
  CURRENCY_LABELS,
  CURRENCY_OPTIONS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHOD_LABELS,
  formatCurrency,
  formatDateTR,
  formatTRY,
  todayISO,
} from '../utils/formatters';
import { fetchExchangeRates } from '../services/gibClient';

interface LedgerViewProps {
  transactions: Transaction[];
  accounts: Account[];
  customExpenseCategories: ExpenseCategory[];
  onCreate: (input: Omit<Transaction, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  onUpdate: (
    id: string,
    input: Pick<
      Transaction,
      | 'type'
      | 'category'
      | 'amount'
      | 'currency'
      | 'originalAmount'
      | 'exchangeRate'
      | 'entryKind'
      | 'vatRate'
      | 'description'
      | 'date'
      | 'paymentMethod'
      | 'accountId'
      | 'accountName'
    >
  ) => Promise<void>;
  onDelete: (tx: Transaction) => Promise<void>;
  externalModalOpen?: boolean;
  onCloseExternalModal?: () => void;
}

export const LedgerView: React.FC<LedgerViewProps> = ({
  transactions,
  accounts,
  customExpenseCategories,
  onCreate,
  onUpdate,
  onDelete,
  externalModalOpen,
  onCloseExternalModal,
}) => {
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all');
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  // Form states
  const [type, setType] = useState<TransactionType>('income');
  const [category, setCategory] = useState(INCOME_CATEGORIES[0]);
  const [currency, setCurrency] = useState<CurrencyCode>('TRY');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [rateLoading, setRateLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState('20');
  const [date, setDate] = useState(todayISO());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [affectsBalance, setAffectsBalance] = useState(true);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isModalVisible = modalOpen || Boolean(externalModalOpen);

  const mergedExpenseCategories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const c of [...customExpenseCategories.map((x) => x.name), ...EXPENSE_CATEGORIES]) {
      const key = c.toLocaleLowerCase('tr');
      if (!seen.has(key)) {
        seen.add(key);
        list.push(c);
      }
    }
    return list;
  }, [customExpenseCategories]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.date && tx.date.length >= 7) set.add(tx.date.slice(0, 7));
    });
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (filterType !== 'all' && tx.type !== filterType) return false;
      if (monthFilter && !tx.date.startsWith(monthFilter)) return false;
      if (q) {
        const hay = `${tx.category} ${tx.description} ${tx.accountName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, filterType, monthFilter, search]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of filteredTransactions) {
      if (tx.entryKind === 'sale') continue;
      if (tx.type === 'income') income += tx.amount;
      else expense += tx.amount;
    }
    return { income, expense, net: income - expense };
  }, [filteredTransactions]);

  const handleCurrencyChange = async (nextCurr: CurrencyCode) => {
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

  const openCreateModal = (defaultType: TransactionType = 'income') => {
    setEditingTx(null);
    setType(defaultType);
    setCategory(defaultType === 'income' ? INCOME_CATEGORIES[0] : mergedExpenseCategories[0]);
    setCurrency('TRY');
    setExchangeRate('1');
    setAmount('');
    setVatRate('20');
    setDate(todayISO());
    setPaymentMethod('cash');
    setAccountId('');
    setAffectsBalance(true);
    setDescription('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (tx: Transaction) => {
    setEditingTx(tx);
    setType(tx.type);
    setCategory(tx.category);
    setCurrency(tx.currency || 'TRY');
    setExchangeRate(String(tx.exchangeRate || 1));
    setAmount(String(tx.originalAmount ?? tx.amount));
    setVatRate(String(tx.vatRate));
    setDate(tx.date);
    setPaymentMethod(tx.paymentMethod);
    setAccountId(tx.accountId || '');
    setAffectsBalance(tx.affectsBalance);
    setDescription(tx.description || '');
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTx(null);
    if (onCloseExternalModal) onCloseExternalModal();
  };

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType);
    setCategory(nextType === 'income' ? INCOME_CATEGORIES[0] : mergedExpenseCategories[0]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericOrig = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(numericOrig) || numericOrig <= 0) {
      setFormError('Lütfen 0’dan büyük geçerli bir tutar girin.');
      return;
    }
    const rateNum =
      currency === 'TRY'
        ? 1
        : Math.max(0.0001, Number(String(exchangeRate).replace(',', '.')) || 1);
    const tlAmount =
      currency === 'TRY' ? numericOrig : Math.round(numericOrig * rateNum * 100) / 100;

    const selectedAccount = accounts.find((a) => a.id === accountId);

    setFormError(null);
    setSaving(true);
    try {
      if (editingTx) {
        await onUpdate(editingTx.id, {
          type,
          category,
          amount: tlAmount,
          currency,
          originalAmount: numericOrig,
          exchangeRate: rateNum,
          entryKind: editingTx.entryKind || 'ledger',
          vatRate: Number(vatRate) || 0,
          description: description.trim(),
          date,
          paymentMethod,
          accountId: selectedAccount?.id || '',
          accountName: selectedAccount?.name || '',
        });
      } else {
        await onCreate({
          type,
          category,
          amount: tlAmount,
          currency,
          originalAmount: numericOrig,
          exchangeRate: rateNum,
          entryKind: 'ledger',
          vatRate: Number(vatRate) || 0,
          description: description.trim(),
          date,
          paymentMethod,
          accountId: selectedAccount?.id || '',
          accountName: selectedAccount?.name || '',
          invoiceId: '',
          affectsBalance: Boolean(selectedAccount && affectsBalance),
        });
      }
      closeModal();
    } catch (err: any) {
      setFormError(err?.message || 'Kayıt kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const baseCategories = type === 'income' ? INCOME_CATEGORIES : mergedExpenseCategories;
  const categories = baseCategories.includes(category)
    ? baseCategories
    : [category, ...baseCategories];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Gelir-Gider Defteri</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Günlük kasa, banka, POS tahsilat ve gider kayıtlarınız · Özel gider kalemlerinizi Ayarlar’dan ekleyebilirsiniz
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => openCreateModal('expense')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-[#131C2E] hover:bg-slate-800 border border-slate-700 text-red-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowUpRight className="w-4 h-4" />
            Gider Ekle
          </button>
          <button
            type="button"
            onClick={() => openCreateModal('income')}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Gelir Ekle
          </button>
        </div>
      </div>

      {/* Period Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">Listelenen Tahsilat / Gelir</div>
            <div className="text-lg font-bold font-mono-num text-emerald-400 mt-1">
              {formatTRY(totals.income)}
            </div>
          </div>
          <ArrowDownLeft className="w-5 h-5 text-emerald-500/70" />
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">Listelenen Gider</div>
            <div className="text-lg font-bold font-mono-num text-red-400 mt-1">
              {formatTRY(totals.expense)}
            </div>
          </div>
          <ArrowUpRight className="w-5 h-5 text-red-500/70" />
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">Net Fark</div>
            <div
              className={`text-lg font-bold font-mono-num mt-1 ${
                totals.net >= 0 ? 'text-slate-100' : 'text-red-400'
              }`}
            >
              {formatTRY(totals.net)}
            </div>
          </div>
          <span className="text-xs text-slate-400 font-mono-num">
            {filteredTransactions.length} kayıt
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-[#0B1120] rounded-lg border border-slate-800 self-start">
          {(['all', 'income', 'expense'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filterType === t
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'all' ? 'Tümü' : t === 'income' ? 'Gelirler' : 'Giderler'}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col sm:flex-row gap-2.5 md:max-w-lg">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kategori, açıklama veya cari ara..."
              className="w-full pl-9 pr-3 py-2 bg-[#0B1120] border border-slate-800 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-100"
            />
          </div>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="px-3 py-2 bg-[#0B1120] border border-slate-800 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-200"
          >
            <option value="">Tüm Aylar</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl overflow-hidden">
        {filteredTransactions.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-3">
            <p className="text-sm font-medium text-slate-300">
              {transactions.length === 0
                ? 'Gelir-gider defterinizde henüz kayıt bulunmuyor.'
                : 'Arama kriterlerinize uygun kayıt bulunamadı.'}
            </p>
            <button
              type="button"
              onClick={() => openCreateModal('income')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Yeni Kayıt Oluştur
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold text-slate-400">
                  <th className="py-3 px-4">Tarih</th>
                  <th className="py-3 px-4">Tür &amp; Kategori</th>
                  <th className="py-3 px-4">Açıklama</th>
                  <th className="py-3 px-4">Ödeme Kanalı</th>
                  <th className="py-3 px-4">Cari Hesap</th>
                  <th className="py-3 px-4 text-right">Tutar</th>
                  <th className="py-3 px-4 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredTransactions.map((tx) => {
                  const txCurr = tx.currency || 'TRY';
                  const origAmt = tx.originalAmount ?? tx.amount;
                  return (
                    <tr key={tx.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-mono-num text-slate-300 whitespace-nowrap">
                        {formatDateTR(tx.date)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {tx.entryKind === 'sale' ? (
                            <ArrowDownLeft className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : tx.type === 'income' ? (
                            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <ArrowUpRight className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          )}
                          <span className="font-medium text-slate-100">{tx.category}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-300 max-w-xs truncate">
                        {tx.description || <span className="text-slate-500">-</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        {PAYMENT_METHOD_LABELS[tx.paymentMethod] || tx.paymentMethod} · %{tx.vatRate} KDV
                      </td>
                      <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                        {tx.accountName || <span className="text-slate-500">-</span>}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                          tx.entryKind === 'sale'
                            ? 'text-amber-300'
                            : tx.type === 'income'
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        }`}
                      >
                        <div>
                          {tx.type === 'income' ? '+' : '-'}
                          {formatTRY(tx.amount)}
                        </div>
                        {txCurr !== 'TRY' && (
                          <div className="text-[11px] font-normal text-slate-400">
                            {formatCurrency(origAmt, txCurr)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(tx)}
                            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors"
                            title="Düzenle"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(tx)}
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                            title="Sil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Transaction Modal */}
      {isModalVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
              <h3 className="text-base font-semibold text-slate-100">
                {editingTx ? 'Hareketi Düzenle' : 'Yeni Gelir / Gider Kaydı'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 p-1 bg-[#0B1120] border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => handleTypeChange('income')}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                    type === 'income'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Gelir / Tahsilat
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('expense')}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                    type === 'expense'
                      ? 'bg-red-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Gider / Ödeme
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Para Birimi
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => handleCurrencyChange(e.target.value as CurrencyCode)}
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
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Tarih *</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    required
                  />
                </div>
              </div>

              {currency !== 'TRY' && (
                <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
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
                      onClick={() => handleCurrencyChange(currency)}
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
                    TL:{' '}
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
                    Kategori
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Ödeme Kanalı
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    <option value="cash">Nakit Kasa</option>
                    <option value="bank">Banka Hesabı</option>
                    <option value="pos">Kredi Kartı / POS</option>
                    <option value="transfer">Havale / EFT</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Cari Hesap (İsteğe Bağlı)
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
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    KDV Oranı (%)
                  </label>
                  <select
                    value={vatRate}
                    onChange={(e) => setVatRate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  >
                    <option value="0">%0</option>
                    <option value="1">%1</option>
                    <option value="10">%10</option>
                    <option value="20">%20</option>
                  </select>
                </div>
              </div>

              {accountId && !editingTx && (
                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={affectsBalance}
                    onChange={(e) => setAffectsBalance(e.target.checked)}
                    className="rounded border-slate-600 bg-[#0F172A] text-blue-500 focus:ring-blue-500"
                  />
                  <span>
                    {type === 'income'
                      ? 'Tahsilat olarak seçili cari bakiyesinden düş'
                      : 'Ödeme olarak seçili cari borcundan düş'}
                  </span>
                </label>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Açıklama
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="İşlem detayı veya belge notu..."
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={closeModal}
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
                  {editingTx ? 'Güncelle' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
