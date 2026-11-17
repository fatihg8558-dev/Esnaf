import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  Printer,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { CurrencyCode, GibSessionState, Invoice } from '../types';
import {
  formatDateTR,
  formatNumberTR,
  numberToTurkishWords,
} from '../utils/formatters';
import { gibGetOfficialInvoiceHtml } from '../services/gibClient';
import {
  buildDeterministicQrSvg,
  buildGibEmblemSvg,
  downloadGibInvoicePdf,
} from '../services/pdfService';

interface InvoicePreviewModalProps {
  invoice: Invoice;
  mode: 'confirm' | 'view';
  gibSession: GibSessionState;
  onClose: () => void;
  onSendSms?: () => Promise<{
    ok: boolean;
    oid?: string;
    ettn?: string;
    draftInvoiceNo?: string;
    maskedPhone?: string;
    error?: string;
  }>;
  onVerifySms?: (
    oid: string,
    code: string,
    ettn: string
  ) => Promise<{ ok: boolean; invoiceNo?: string; error?: string }>;
  onGoToArchive?: () => void;
  initialStep?: 'preview' | 'sms' | 'approved';
}

export const InvoicePreviewModal: React.FC<InvoicePreviewModalProps> = ({
  invoice,
  mode,
  gibSession,
  onClose,
  onSendSms,
  onVerifySms,
  onGoToArchive,
  initialStep = 'preview',
}) => {
  const [step, setStep] = useState<'preview' | 'sms' | 'approved'>(
    mode === 'view' ? 'preview' : initialStep
  );
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [officialHtmlLoading, setOfficialHtmlLoading] = useState(false);
  const [officialHtml, setOfficialHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oid, setOid] = useState('');
  const [activeEttn, setActiveEttn] = useState(invoice.ettn);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [countdown, setCountdown] = useState(180);
  const [finalInvoiceNo, setFinalInvoiceNo] = useState(invoice.invoiceNo);

  const currency: CurrencyCode = invoice.currency || 'TRY';
  const exchangeRate = Number(invoice.exchangeRate) || 1;
  const tlEquivalent =
    currency !== 'TRY' && exchangeRate > 0
      ? Math.round(invoice.grandTotal * exchangeRate * 100) / 100
      : null;

  useEffect(() => {
    if (step !== 'sms') return;
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, countdown]);

  const vatBreakdown = invoice.items.reduce<Record<number, { base: number; vat: number }>>(
    (acc, item) => {
      const rate = Number(item.vatRate) || 0;
      if (!acc[rate]) acc[rate] = { base: 0, vat: 0 };
      acc[rate].base += item.lineSubtotal;
      acc[rate].vat += item.lineVat;
      return acc;
    },
    {}
  );

  const emblemSvg = useMemo(() => buildGibEmblemSvg(74), []);
  const qrSvg = useMemo(
    () =>
      buildDeterministicQrSvg(
        `${activeEttn}|${finalInvoiceNo}|${invoice.grandTotal}|${currency}`,
        80
      ),
    [activeEttn, finalInvoiceNo, invoice.grandTotal, currency]
  );

  const gibDashDate = useMemo(() => {
    const parts = String(invoice.invoiceDate || '').split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return formatDateTR(invoice.invoiceDate).replace(/\./g, '-');
  }, [invoice.invoiceDate]);

  const formatGibAmount = (val: number, curr: CurrencyCode = currency) => {
    const num = formatNumberTR(val, 2);
    if (curr === 'TRY') return `${num} TL`;
    return `${num} ${curr}`;
  };

  const currencyWordsText = useMemo(
    () => numberToTurkishWords(invoice.grandTotal, currency),
    [invoice.grandTotal, currency]
  );

  const extraNoteLines = useMemo(() => {
    if (!invoice.note) return [];
    return String(invoice.note)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.toUpperCase().startsWith('YALNIZ '));
  }, [invoice.note]);

  const handleRequestSms = async () => {
    if (!onSendSms) return;
    setError(null);
    setLoading(true);
    try {
      const res = await onSendSms();
      if (!res.ok) {
        setError(res.error || 'SMS onay kodu gönderilemedi.');
        return;
      }
      setOid(res.oid || '');
      if (res.ettn) setActiveEttn(res.ettn);
      if (res.draftInvoiceNo) setFinalInvoiceNo(res.draftInvoiceNo);
      setMaskedPhone(res.maskedPhone || 'Kayıtlı Telefon');
      setCountdown(180);
      setStep('sms');
    } catch (err: any) {
      setError(err?.message || 'SMS gönderimi sırasında beklenmeyen bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onVerifySms) return;
    if (!smsCode.trim()) {
      setError('Lütfen cep telefonunuza gelen SMS onay kodunu girin.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await onVerifySms(oid, smsCode.trim(), activeEttn);
      if (!res.ok) {
        setError(res.error || 'SMS doğrulaması başarısız.');
        return;
      }
      if (res.invoiceNo) setFinalInvoiceNo(res.invoiceNo);
      setStep('approved');
    } catch (err: any) {
      setError(err?.message || 'Fatura onaylanırken hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    setError(null);
    setPdfLoading(true);
    try {
      const effectiveStatus = step === 'approved' ? 'approved' : invoice.status;
      let fetchedOfficialHtml: string | undefined = officialHtml || undefined;
      if (
        !fetchedOfficialHtml &&
        gibSession.connected &&
        gibSession.sessionId &&
        activeEttn &&
        effectiveStatus === 'approved'
      ) {
        try {
          const resp = await gibGetOfficialInvoiceHtml(
            gibSession.sessionId,
            activeEttn,
            effectiveStatus
          );
          if (resp.ok && resp.html) {
            fetchedOfficialHtml = resp.html;
          }
        } catch {
          // Fall back silently to faithful local GİB XSLT template
        }
      }

      await downloadGibInvoicePdf(
        {
          ...invoice,
          ettn: activeEttn,
          invoiceNo: finalInvoiceNo,
          status: effectiveStatus,
        },
        gibSession.sellerInfo,
        { officialHtml: fetchedOfficialHtml }
      );
    } catch (err: any) {
      setError(err?.message || 'PDF oluşturulurken hata oluştu.');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleFetchOfficialHtml = async () => {
    if (!gibSession.connected || !gibSession.sessionId || !activeEttn) return;
    setError(null);
    setOfficialHtmlLoading(true);
    try {
      const resp = await gibGetOfficialInvoiceHtml(
        gibSession.sessionId,
        activeEttn,
        step === 'approved' ? 'approved' : invoice.status
      );
      if (!resp.ok || !resp.html) {
        setError(resp.error || 'GİB Portaldan orijinal HTML görünümü alınamadı.');
        return;
      }
      setOfficialHtml(resp.html);
    } catch (err: any) {
      setError(err?.message || 'GİB orijinal görünüm alınamadı.');
    } finally {
      setOfficialHtmlLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadHtml = () => {
    if (officialHtml) {
      const blob = new Blob([officialHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `e-arsiv-${finalInvoiceNo || activeEttn}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    const sheetEl = document.getElementById('earsiv-a4-sheet');
    if (!sheetEl) return;
    const htmlContent = `<!doctype html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<title>e-Arşiv Fatura - ${finalInvoiceNo}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #000000; margin: 24px; background: #ffffff; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000000; padding: 4px 6px; font-size: 10px; }
  th { background: #ededed; font-weight: 700; }
</style>
</head>
<body>${sheetEl.innerHTML}</body>
</html>`;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `e-arsiv-${finalInvoiceNo || activeEttn}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isApproved = step === 'approved' || invoice.status === 'approved';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-4xl bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[94vh]">
        {/* Modal Header */}
        <div className="no-print flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-blue-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-100 truncate">
                {step === 'preview' && 'Fatura Ön İzleme (e-Arşiv Portal Görünümü)'}
                {step === 'sms' && 'GİB e-Arşiv SMS Doğrulama'}
                {step === 'approved' && 'e-Arşiv Fatura Onaylandı'}
              </h3>
              <p className="text-xs text-slate-400 truncate">
                Canlı GİB e-Arşiv Portal · ETTN: {activeEttn.slice(0, 18)}...
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-5 flex-1">
          {error && (
            <div className="no-print bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {step === 'sms' && (
            <form
              onSubmit={handleConfirmSms}
              className="no-print bg-[#0F172A] border border-slate-800 rounded-xl p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-slate-100">
                      Cep Telefonunuza SMS Şifresi Gönderildi
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Alıcı telefon: <span className="text-slate-200 font-medium">{maskedPhone}</span> · İşlem No:{' '}
                      <span className="font-mono-num text-slate-300">{oid}</span>
                    </p>
                  </div>
                </div>
                <div className="text-xs font-mono-num text-amber-400 font-semibold whitespace-nowrap">
                  Kalan Süre: {formatTimer(countdown)}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    6 Haneli SMS Onay Kodu
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value)}
                    placeholder="Örn: 482910"
                    className="w-full px-3.5 py-2.5 bg-[#131C2E] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-slate-100 font-mono-num text-base tracking-widest"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || countdown === 0}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  SMS Kodunu Doğrula &amp; Faturayı Kes
                </button>
              </div>
            </form>
          )}

          {step === 'approved' && (
            <div className="no-print bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-200">
                    Faturanız başarıyla onaylandı ve arşive kaydedildi.
                  </p>
                  <p className="text-xs text-emerald-300/80 font-mono-num mt-0.5">
                    Resmi Fatura No: {finalInvoiceNo}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={pdfLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {pdfLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  GİB PDF İndir
                </button>
                {onGoToArchive && (
                  <button
                    type="button"
                    onClick={onGoToArchive}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    Fatura Arşivine Git
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Authentic Monochrome GİB e-Arşiv XSLT Document */}
          <div
            id="earsiv-a4-sheet"
            className="print-only-sheet bg-white text-black border border-black p-5 sm:p-7 shadow-sm text-[11px] leading-[1.38]"
            style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
          >
            {/* Top 3-Column Official GİB Header */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              {/* Left Column: Seller + SAYIN */}
              <div className="md:col-span-5 space-y-5">
                <div className="border-t-2 border-b-2 border-black py-2 px-0.5 space-y-0.5">
                  <div className="text-[11.5px] font-bold uppercase text-black">
                    {invoice.sellerTitle || gibSession.sellerInfo?.title || 'İşletme Unvanı'}
                  </div>
                  <div className="text-black">
                    {invoice.sellerAddress || gibSession.sellerInfo?.address || '-'}
                  </div>
                  {(gibSession.sellerInfo?.district || gibSession.sellerInfo?.city) && (
                    <div className="text-black">
                      {[gibSession.sellerInfo?.district, gibSession.sellerInfo?.city]
                        .filter(Boolean)
                        .join(' / ')}
                    </div>
                  )}
                  <div className="text-black pt-0.5">
                    Vergi Dairesi: {invoice.sellerTaxOffice || gibSession.sellerInfo?.taxOffice || '-'}
                  </div>
                  <div className="text-black font-mono-num">
                    VKN/TCKN: {invoice.sellerTaxId || gibSession.sellerInfo?.taxId || '-'}
                  </div>
                </div>

                <div className="border-t-2 border-b-2 border-black py-2 px-0.5 space-y-0.5">
                  <div className="font-bold text-black">SAYIN</div>
                  <div className="font-bold text-black">{invoice.recipientName}</div>
                  {invoice.recipientAddress && (
                    <div className="text-black">{invoice.recipientAddress}</div>
                  )}
                  {(invoice.recipientDistrict || invoice.recipientCity) && (
                    <div className="text-black">
                      {[invoice.recipientDistrict, invoice.recipientCity].filter(Boolean).join(' / ')}
                    </div>
                  )}
                  <div className="text-black pt-0.5">
                    Vergi Dairesi: {invoice.recipientTaxOffice || '-'}
                  </div>
                  <div className="text-black font-mono-num">
                    VKN/TCKN: {invoice.recipientTaxId}
                  </div>
                </div>
              </div>

              {/* Center Column: GİB Emblem + e-ARŞİV FATURA + QR */}
              <div className="md:col-span-3 flex flex-col items-center text-center pt-1">
                <div dangerouslySetInnerHTML={{ __html: emblemSvg }} />
                <div className="mt-2 text-[12px] font-bold text-black tracking-wide">
                  e-ARŞİV FATURA
                </div>
                <div className="mt-4" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <div className="mt-1 text-[9.5px] font-bold text-black">
                  {isApproved
                    ? 'e-Arşiv İmzalı'
                    : invoice.status === 'cancelled'
                    ? 'İPTAL EDİLMİŞTİR'
                    : 'TASLAK / ÖN İZLEME'}
                </div>
              </div>

              {/* Right Column: Official Bordered Metadata Grid */}
              <div className="md:col-span-4">
                <table className="w-full border-collapse border border-black text-[10.5px]">
                  <tbody>
                    <tr>
                      <td className="border border-black px-2 py-1 font-bold w-[48%]">
                        Özelleştirme No:
                      </td>
                      <td className="border border-black px-2 py-1 font-mono-num">TR1.2</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-1 font-bold">Senaryo:</td>
                      <td className="border border-black px-2 py-1 font-mono-num">EARSIVFATURA</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-1 font-bold">Fatura Tipi:</td>
                      <td className="border border-black px-2 py-1">
                        {invoice.invoiceType === 'IADE' ? 'IADE' : 'SATIS'}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-1 font-bold">Fatura No:</td>
                      <td className="border border-black px-2 py-1 font-mono-num font-bold">
                        {finalInvoiceNo}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-1 font-bold">Fatura Tarihi:</td>
                      <td className="border border-black px-2 py-1 font-mono-num">{gibDashDate}</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-1 font-bold">
                        Düzenleme Tarihi:
                      </td>
                      <td className="border border-black px-2 py-1 font-mono-num">{gibDashDate}</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-1 font-bold">
                        Düzenleme Zamanı:
                      </td>
                      <td className="border border-black px-2 py-1 font-mono-num">
                        {invoice.invoiceTime || '00:00:00'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ETTN Strip */}
            <div className="mt-4 mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-black">
              <div className="font-mono-num break-all">
                <span className="font-bold">ETTN:</span> {activeEttn}
              </div>
              <div className="font-mono-num">
                <span className="font-bold">Para Birimi:</span> {currency}
                {currency !== 'TRY' && ` | Kur: ${formatNumberTR(exchangeRate, 4)} TL`}
              </div>
            </div>

            {/* Official 10-Column GİB Line Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-black text-[10px]">
                <thead>
                  <tr className="bg-[#ededed] text-black">
                    <th className="border border-black px-1.5 py-1.5 text-center font-bold">
                      Sıra No
                    </th>
                    <th className="border border-black px-2 py-1.5 text-left font-bold">
                      Mal Hizmet
                    </th>
                    <th className="border border-black px-1.5 py-1.5 text-right font-bold">
                      Miktar
                    </th>
                    <th className="border border-black px-1.5 py-1.5 text-right font-bold">
                      Birim Fiyat
                    </th>
                    <th className="border border-black px-1.5 py-1.5 text-right font-bold">
                      İskonto Oranı
                    </th>
                    <th className="border border-black px-1.5 py-1.5 text-right font-bold">
                      İskonto Tutarı
                    </th>
                    <th className="border border-black px-1.5 py-1.5 text-right font-bold">
                      KDV Oranı
                    </th>
                    <th className="border border-black px-1.5 py-1.5 text-right font-bold">
                      KDV Tutarı
                    </th>
                    <th className="border border-black px-1.5 py-1.5 text-right font-bold">
                      Diğer Vergiler
                    </th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">
                      Mal Hizmet Tutarı
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className="border border-black px-1.5 py-1 text-center font-mono-num">
                        {idx + 1}
                      </td>
                      <td className="border border-black px-2 py-1 text-black">{item.name}</td>
                      <td className="border border-black px-1.5 py-1 text-right font-mono-num whitespace-nowrap">
                        {formatNumberTR(item.quantity, 2)} {item.unit}
                      </td>
                      <td className="border border-black px-1.5 py-1 text-right font-mono-num whitespace-nowrap">
                        {formatGibAmount(item.unitPrice)}
                      </td>
                      <td className="border border-black px-1.5 py-1 text-right font-mono-num whitespace-nowrap">
                        %0,00
                      </td>
                      <td className="border border-black px-1.5 py-1 text-right font-mono-num whitespace-nowrap">
                        {formatGibAmount(0)}
                      </td>
                      <td className="border border-black px-1.5 py-1 text-right font-mono-num">
                        %{item.vatRate}
                      </td>
                      <td className="border border-black px-1.5 py-1 text-right font-mono-num whitespace-nowrap">
                        {formatGibAmount(item.lineVat)}
                      </td>
                      <td className="border border-black px-1.5 py-1 text-right font-mono-num whitespace-nowrap">
                        {formatGibAmount(0)}
                      </td>
                      <td className="border border-black px-2 py-1 text-right font-mono-num font-bold whitespace-nowrap">
                        {formatGibAmount(item.lineSubtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Right-Aligned Official Totals Grid */}
            <div className="mt-2.5 flex justify-end">
              <div className="w-full sm:w-[46%]">
                <table className="w-full border-collapse border border-black text-[10.5px]">
                  <tbody>
                    <tr>
                      <td className="border border-black px-2.5 py-1 font-bold">
                        Mal Hizmet Toplam Tutarı
                      </td>
                      <td className="border border-black px-2.5 py-1 text-right font-mono-num whitespace-nowrap">
                        {formatGibAmount(invoice.subtotal)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2.5 py-1 font-bold">
                        Toplam İskonto
                      </td>
                      <td className="border border-black px-2.5 py-1 text-right font-mono-num whitespace-nowrap">
                        {formatGibAmount(0)}
                      </td>
                    </tr>
                    {Object.entries(vatBreakdown).map(([rate, vals]) => (
                      <tr key={rate}>
                        <td className="border border-black px-2.5 py-1 font-bold">
                          Hesaplanan KDV(%{rate})
                        </td>
                        <td className="border border-black px-2.5 py-1 text-right font-mono-num whitespace-nowrap">
                          {formatGibAmount(vals.vat)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="border border-black px-2.5 py-1 font-bold">
                        Vergiler Dahil Toplam Tutar
                      </td>
                      <td className="border border-black px-2.5 py-1 text-right font-mono-num whitespace-nowrap">
                        {formatGibAmount(invoice.grandTotal)}
                      </td>
                    </tr>
                    <tr className="bg-[#f5f5f5]">
                      <td className="border border-black px-2.5 py-1.5 font-bold">
                        Ödenecek Tutar
                      </td>
                      <td className="border border-black px-2.5 py-1.5 text-right font-mono-num font-bold whitespace-nowrap">
                        {formatGibAmount(invoice.grandTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Full-Width Official Notes Box */}
            <div className="mt-3.5 border border-black px-3 py-2 text-[10px] text-black space-y-1">
              <div>
                <span className="font-bold">Not:</span> {currencyWordsText}
              </div>
              {tlEquivalent !== null && (
                <div>
                  <span className="font-bold">TL Karşılığı:</span>{' '}
                  {formatGibAmount(tlEquivalent, 'TRY')} (1 {currency} ={' '}
                  {formatNumberTR(exchangeRate, 4)} TL)
                </div>
              )}
              {extraNoteLines.map((line, i) => {
                if (/^iban\s*:/i.test(line)) {
                  const rest = line.replace(/^iban\s*:\s*/i, '');
                  return (
                    <div key={i}>
                      <span className="font-bold">IBAN:</span> {rest}
                    </div>
                  );
                }
                return <div key={i}>{line}</div>;
              })}
              <div className="text-[9px] text-neutral-700 pt-0.5">
                Bu belge 509 Sıra No&apos;lu VUK Genel Tebliği uyarınca elektronik ortamda e-Arşiv
                Fatura olarak düzenlenmiştir.
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-slate-800 bg-[#0F172A]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              {pdfLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              GİB PDF İndir
            </button>
            {gibSession.connected && isApproved && activeEttn && (
              <button
                type="button"
                onClick={handleFetchOfficialHtml}
                disabled={officialHtmlLoading}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                {officialHtmlLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5" />
                )}
                GİB Orijinal Belge
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              Yazdır
            </button>
            <button
              type="button"
              onClick={handleDownloadHtml}
              className="inline-flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              HTML
            </button>
          </div>

          <div className="flex items-center gap-3">
            {mode === 'confirm' && step === 'preview' && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  Düzenlemeye Dön
                </button>
                <button
                  type="button"
                  onClick={handleRequestSms}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Taslak Oluştur &amp; SMS Onayı Gönder
                </button>
              </>
            )}

            {mode === 'view' && invoice.status === 'draft' && step === 'preview' && onSendSms && (
              <button
                type="button"
                onClick={handleRequestSms}
                disabled={loading || !gibSession.connected}
                title={!gibSession.connected ? 'Onay için önce GİB oturumu açmalısınız' : undefined}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {gibSession.connected ? 'SMS ile Onayla' : 'Onay İçin GİB Girişi Gerekli'}
              </button>
            )}

            {(mode === 'view' || step === 'approved') && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                Kapat
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Live GİB Official HTML Sub-Modal */}
      {officialHtml && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4">
          <div className="w-full max-w-4xl h-[88vh] bg-[#131C2E] border border-slate-700 rounded-xl flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#0F172A]">
              <span className="text-sm font-semibold text-slate-100">
                GİB Portal Orijinal Belge Görünümü ({finalInvoiceNo})
              </span>
              <button
                type="button"
                onClick={() => setOfficialHtml(null)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe
              title="GİB Orijinal Fatura"
              srcDoc={officialHtml}
              className="w-full flex-1 bg-white"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      )}
    </div>
  );
};
