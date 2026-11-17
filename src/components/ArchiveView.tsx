import React, { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  FileDown,
  FilePlus2,
  Loader2,
  Receipt,
  Search,
  Trash2,
} from 'lucide-react';
import type { CurrencyCode, GibSessionState, Invoice, InvoiceStatus } from '../types';
import { formatCurrency, formatDateTR, formatTRY } from '../utils/formatters';
import {
  gibCreateDraftAndSendSms,
  gibGetOfficialInvoiceHtml,
  gibVerifySms,
} from '../services/gibClient';
import { downloadGibInvoicePdf } from '../services/pdfService';
import { InvoicePreviewModal } from './InvoicePreviewModal';

interface ArchiveViewProps {
  invoices: Invoice[];
  gibSession: GibSessionState;
  onCancelInvoice: (invoiceId: string) => Promise<void>;
  onDeleteInvoice: (invoiceId: string) => Promise<void>;
  onApproveDraft: (
    invoice: Invoice,
    approvedInvoiceNo: string,
    approvedAt: string,
    options: { reflectToIncome: boolean; reflectToAccountBalance: boolean }
  ) => Promise<void>;
  onGoToCreate: () => void;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({
  invoices,
  gibSession,
  onCancelInvoice,
  onDeleteInvoice,
  onApproveDraft,
  onGoToCreate,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (q) {
        const hay = `${inv.invoiceNo} ${inv.ettn} ${inv.recipientName} ${inv.recipientTaxId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, search]);

  const approvedTotalTry = useMemo(
    () =>
      filteredInvoices
        .filter((i) => i.status === 'approved')
        .reduce((acc, i) => {
          const curr = i.currency || 'TRY';
          const rate = curr === 'TRY' ? 1 : Number(i.exchangeRate) || 1;
          return acc + i.grandTotal * rate;
        }, 0),
    [filteredInvoices]
  );

  const handleDownloadPdf = async (inv: Invoice) => {
    setDownloadingPdfId(inv.id);
    try {
      let officialHtml: string | undefined;
      if (gibSession.connected && gibSession.sessionId && inv.ettn && inv.status === 'approved') {
        try {
          const resp = await gibGetOfficialInvoiceHtml(
            gibSession.sessionId,
            inv.ettn,
            inv.status
          );
          if (resp.ok && resp.html) {
            officialHtml = resp.html;
          }
        } catch {
          // Fall back silently to faithful local GİB XSLT template
        }
      }
      await downloadGibInvoicePdf(inv, gibSession.sellerInfo, { officialHtml });
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const handleSendSmsForDraft = async (inv: Invoice) => {
    if (!gibSession.connected || !gibSession.sessionId) {
      return { ok: false, error: 'Taslağı onaylamak için önce Ayarlar sayfasından GİB oturumu açmalısınız.' };
    }
    const resp = await gibCreateDraftAndSendSms(gibSession.sessionId, inv);
    if (!resp.ok) {
      return { ok: false, error: resp.error || 'SMS gönderilemedi.' };
    }
    return {
      ok: true,
      oid: resp.oid,
      ettn: resp.ettn,
      draftInvoiceNo: inv.invoiceNo,
      maskedPhone: resp.maskedPhone,
    };
  };

  const handleVerifySmsForDraft = async (inv: Invoice, oid: string, code: string, ettn: string) => {
    if (!gibSession.connected || !gibSession.sessionId) {
      return { ok: false, error: 'GİB oturumu bulunamadı.' };
    }
    const resp = await gibVerifySms(gibSession.sessionId, oid, code, ettn, inv.invoiceDate);
    if (!resp.ok) {
      return { ok: false, error: resp.error || 'SMS doğrulanamadı.' };
    }
    const officialNo = resp.invoiceNo || inv.invoiceNo;
    await onApproveDraft(inv, officialNo, resp.approvedAt || new Date().toISOString(), {
      reflectToIncome: true,
      reflectToAccountBalance: false,
    });
    return { ok: true, invoiceNo: officialNo };
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">e-Arşiv Fatura Geçmişi</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Oluşturulan tüm onaylı, taslak ve iptal edilmiş faturalarınızın arşivi · Tek tıkla GİB PDF çıktı
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <FilePlus2 className="w-4 h-4" />
          Yeni Fatura Kes
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-[#0B1120] border border-slate-800 rounded-lg self-start overflow-x-auto">
          {(['all', 'approved', 'draft', 'cancelled'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === st
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {st === 'all'
                ? 'Tümü'
                : st === 'approved'
                ? 'Onaylı'
                : st === 'draft'
                ? 'Taslak'
                : 'İptal'}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col sm:flex-row sm:items-center gap-3 md:max-w-lg justify-end">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Fatura no, alıcı adı, VKN veya ETTN ara..."
              className="w-full pl-9 pr-3 py-2 bg-[#0B1120] border border-slate-800 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-100"
            />
          </div>
          <div className="text-xs text-slate-400 whitespace-nowrap font-mono-num">
            Onaylı Toplam: <span className="text-emerald-400 font-semibold">{formatTRY(approvedTotalTry)}</span>
          </div>
        </div>
      </div>

      {/* Archive List */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl overflow-hidden">
        {filteredInvoices.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-3">
            <Receipt className="w-9 h-9 text-slate-600 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-300">
                {invoices.length === 0
                  ? 'Arşivinizde henüz oluşturulmuş fatura bulunmuyor.'
                  : 'Filtrelerinize uygun fatura bulunamadı.'}
              </p>
              <p className="text-xs text-slate-500">
                Yeni bir e-Arşiv faturası oluşturduğunuzda geçmişi burada listelenir.
              </p>
            </div>
            <button
              type="button"
              onClick={onGoToCreate}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <FilePlus2 className="w-4 h-4" />
              İlk Faturayı Kes
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold text-slate-400">
                  <th className="py-3 px-4">Fatura No &amp; ETTN</th>
                  <th className="py-3 px-4">Tarih</th>
                  <th className="py-3 px-4">Alıcı (VKN / TCKN)</th>
                  <th className="py-3 px-4">Ortam</th>
                  <th className="py-3 px-4">Durum</th>
                  <th className="py-3 px-4 text-right">Genel Toplam</th>
                  <th className="py-3 px-4 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredInvoices.map((inv) => {
                  const curr: CurrencyCode = inv.currency || 'TRY';
                  const rate = Number(inv.exchangeRate) || 1;
                  const isPdfBusy = downloadingPdfId === inv.id;

                  return (
                    <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-mono-num font-semibold text-slate-100">
                          {inv.invoiceNo}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-500">
                          {inv.ettn.slice(0, 14)}...
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono-num text-slate-300 whitespace-nowrap">
                        {formatDateTR(inv.invoiceDate)}
                        <div className="text-[11px] text-slate-500">{inv.invoiceTime}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-100 max-w-xs truncate">
                          {inv.recipientName}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-400">
                          {inv.recipientTaxId}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-300">
                        Canlı GİB
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {inv.status === 'approved' ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Onaylı
                          </span>
                        ) : inv.status === 'cancelled' ? (
                          <span className="inline-flex items-center gap-1.5 text-red-400 font-medium">
                            <Ban className="w-3.5 h-3.5" />
                            İptal Edildi
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                            <Clock className="w-3.5 h-3.5" />
                            Taslak
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-num font-bold text-slate-100 whitespace-nowrap">
                        <div>{formatCurrency(inv.grandTotal, curr)}</div>
                        {curr !== 'TRY' && (
                          <div className="text-[11px] font-normal text-slate-400">
                            ≈ {formatTRY(inv.grandTotal * rate)}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(inv)}
                            disabled={isPdfBusy}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/35 border border-blue-500/30 text-blue-300 rounded-md transition-colors"
                            title="GİB Formatında PDF İndir"
                          >
                            {isPdfBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FileDown className="w-3.5 h-3.5" />
                            )}
                            <span>PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedInvoice(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors"
                            title="Ön İzle / Yazdır"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Görüntüle</span>
                          </button>
                          {inv.status === 'approved' && (
                            <button
                              type="button"
                              onClick={() => onCancelInvoice(inv.id)}
                              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-md transition-colors"
                              title="Faturayı İptal Et"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {inv.status === 'draft' && (
                            <button
                              type="button"
                              onClick={() => onDeleteInvoice(inv.id)}
                              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-md transition-colors"
                              title="Arşivden Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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

      {/* Preview Modal from Archive */}
      {selectedInvoice && (
        <InvoicePreviewModal
          invoice={selectedInvoice}
          mode="view"
          gibSession={gibSession}
          onClose={() => setSelectedInvoice(null)}
          onSendSms={
            selectedInvoice.status === 'draft'
              ? () => handleSendSmsForDraft(selectedInvoice)
              : undefined
          }
          onVerifySms={
            selectedInvoice.status === 'draft'
              ? (oid, code, ettn) => handleVerifySmsForDraft(selectedInvoice, oid, code, ettn)
              : undefined
          }
        />
      )}
    </div>
  );
};
