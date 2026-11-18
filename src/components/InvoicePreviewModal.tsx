import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [viewMode, setViewMode] = useState<'official' | 'local'>('official');
  const [iframeHeight, setIframeHeight] = useState<number>(840);
  const [error, setError] = useState<string | null>(null);
  const [oid, setOid] = useState('');
  const [activeEttn, setActiveEttn] = useState(invoice.ettn);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [countdown, setCountdown] = useState(180);
  const [finalInvoiceNo, setFinalInvoiceNo] = useState(invoice.invoiceNo);
  const officialIframeRef = useRef<HTMLIFrameElement | null>(null);

  const currency: CurrencyCode = invoice.currency || 'TRY';
  const exchangeRate = Number(invoice.exchangeRate) || 1;
  const tlEquivalent =
    currency !== 'TRY' && exchangeRate > 0
      ? Math.round(invoice.grandTotal * exchangeRate * 100) / 100
      : null;

  const isApproved = step === 'approved' || invoice.status === 'approved';

  useEffect(() => {
    if (step !== 'sms') return;
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, countdown]);

  // Automatically fetch literal GİB e-Arşiv Portal HTML for approved invoices when GİB session is active
  useEffect(() => {
    if (!isApproved || !gibSession.connected || !gibSession.sessionId || !activeEttn) {
      return;
    }

    let cancelled = false;
    setOfficialHtmlLoading(true);
    gibGetOfficialInvoiceHtml(gibSession.sessionId, activeEttn, 'approved')
      .then((resp) => {
        if (cancelled) return;
        if (resp.ok && resp.html) {
          setOfficialHtml(resp.html);
          setViewMode('official');
        }
      })
      .catch(() => {
        // Silent fallback to authentic 1:1 local GİB layout
      })
      .finally(() => {
        if (!cancelled) setOfficialHtmlLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isApproved, gibSession.connected, gibSession.sessionId, activeEttn]);

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

  const emblemSvg = useMemo(() => buildGibEmblemSvg(86), []);
  const qrSvg = useMemo(
    () =>
      buildDeterministicQrSvg(
        `${activeEttn}|${finalInvoiceNo}|${invoice.grandTotal}|${currency}`,
        140
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

  const gibShortTime = useMemo(() => {
    const clean = String(invoice.invoiceTime || '').trim();
    const match = clean.match(/^(\d{2}:\d{2})/);
    return match ? match[1] : '00:00';
  }, [invoice.invoiceTime]);

  const formatGibAmount = (val: number, curr: CurrencyCode = currency) => {
    const num = formatNumberTR(val, 2);
    if (curr === 'TRY') return `${num} TL`;
    return `${num} ${curr}`;
  };

  const formatGibQty = (qty: number) =>
    Number.isInteger(qty) ? String(qty) : formatNumberTR(qty, 2);

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

  const sellerTaxId = String(invoice.sellerTaxId || gibSession.sellerInfo?.taxId || '-').trim();
  const sellerTaxLabel = sellerTaxId.replace(/\D/g, '').length === 11 ? 'TCKN' : 'VKN';
  const sellerLoc = [gibSession.sellerInfo?.district, gibSession.sellerInfo?.city, 'Türkiye']
    .filter(Boolean)
    .join('/ ');

  const cleanRecipientTax = String(invoice.recipientTaxId || '').trim();
  const recipientTaxLabel = cleanRecipientTax.replace(/\D/g, '').length === 11 ? 'TCKN' : 'VKN';
  const recipientLoc = [invoice.recipientDistrict, invoice.recipientCity]
    .filter(Boolean)
    .join('/ ');

  const fillerRowCount = Math.max(0, 15 - invoice.items.length);

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
    if (officialHtml) {
      setViewMode((prev) => (prev === 'official' ? 'local' : 'official'));
      return;
    }
    if (!gibSession.connected || !gibSession.sessionId || !activeEttn) return;
    setError(null);
    setOfficialHtmlLoading(true);
    try {
      const resp = await gibGetOfficialInvoiceHtml(
        gibSession.sessionId,
        activeEttn,
        isApproved ? 'approved' : invoice.status
      );
      if (!resp.ok || !resp.html) {
        setError(resp.error || 'GİB Portaldan orijinal HTML görünümü alınamadı.');
        return;
      }
      setOfficialHtml(resp.html);
      setViewMode('official');
    } catch (err: any) {
      setError(err?.message || 'GİB orijinal görünüm alınamadı.');
    } finally {
      setOfficialHtmlLoading(false);
    }
  };

  const handleIframeLoad = () => {
    try {
      const doc = officialIframeRef.current?.contentDocument;
      if (!doc) return;
      const scrollH = Math.max(
        doc.body?.scrollHeight || 0,
        doc.documentElement?.scrollHeight || 0
      );
      if (scrollH > 300) {
        setIframeHeight(scrollH + 32);
      }
    } catch {
      // ignore cross-origin restrictions if any
    }
  };

  const handlePrint = () => {
    if (officialHtml && viewMode === 'official' && officialIframeRef.current?.contentWindow) {
      try {
        officialIframeRef.current.contentWindow.focus();
        officialIframeRef.current.contentWindow.print();
        return;
      } catch {
        // Fallback to window print
      }
    }
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
  body { font-family: Arial, Helvetica, sans-serif; color: #000000; margin: 24px; background: #ffffff; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000000; padding: 3px 5px; font-size: 9px; }
  th { background: #ffffff; font-weight: 700; }
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

  const showOfficialIframe = Boolean(officialHtml && viewMode === 'official');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-4xl bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[94vh]">
        {/* Modal Header */}
        <div className="no-print flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-blue-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-100 truncate">
                {step === 'preview' &&
                  (showOfficialIframe
                    ? 'Resmi GİB e-Arşiv Fatura Görünümü'
                    : 'Fatura Ön İzleme (e-Arşiv Portal Görünümü)')}
                {step === 'sms' && 'GİB e-Arşiv SMS Doğrulama'}
                {step === 'approved' && 'e-Arşiv Fatura Onaylandı'}
              </h3>
              <p className="text-xs text-slate-400 truncate">
                Canlı GİB e-Arşiv Portal · ETTN: {activeEttn}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {officialHtmlLoading && (
              <span className="inline-flex items-center gap-1.5 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/25 px-2.5 py-1 rounded-md">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                GİB Belgesi Yükleniyor
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
              aria-label="Kapat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
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

          {/* Literal Official GİB e-Arşiv Portal HTML Document (when approved & GİB connected) */}
          {showOfficialIframe ? (
            <div className="bg-white border border-slate-700 rounded-sm overflow-hidden shadow-sm">
              <iframe
                ref={officialIframeRef}
                title={`GİB e-Arşiv Fatura - ${finalInvoiceNo}`}
                srcDoc={officialHtml || ''}
                onLoad={handleIframeLoad}
                style={{ height: `${iframeHeight}px` }}
                className="w-full bg-white border-0 block"
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            /* Authentic 1:1 Monochrome GİB e-Arşiv XSLT Document */
            <div
              id="earsiv-a4-sheet"
              className="print-only-sheet bg-white text-black border border-slate-300 p-5 sm:p-6 shadow-sm text-[10px] leading-[1.35]"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
            >
              {/* Top 3-Column Official GİB Header */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                {/* Left Column: Seller + SAYIN + ETTN */}
                <div className="md:col-span-5">
                  <div className="border-t-[2.5px] border-b-[2.5px] border-black py-1.5 px-0.5 text-[9.5px] text-[#222] space-y-0.5">
                    <div className="text-[10px] uppercase text-[#111]">
                      {invoice.sellerTitle || gibSession.sellerInfo?.title || 'İşletme Unvanı'}
                    </div>
                    <div>
                      {invoice.sellerAddress || gibSession.sellerInfo?.address || '-'}
                    </div>
                    {sellerLoc && <div>{sellerLoc}</div>}
                    <div>Tel: Fax:</div>
                    <div>Web Sitesi:</div>
                    <div>E-Posta:</div>
                    <div>
                      Vergi Dairesi: {invoice.sellerTaxOffice || gibSession.sellerInfo?.taxOffice || '-'}
                    </div>
                    <div>
                      {sellerTaxLabel}: {sellerTaxId}
                    </div>
                  </div>

                  <div className="h-6" />

                  <div className="border-t-[2.5px] border-b-[2.5px] border-black py-1.5 px-0.5 text-[9.5px] text-[#222] space-y-0.5">
                    <div className="font-bold text-black text-[10px]">SAYIN</div>
                    <div className="text-[#111]">{invoice.recipientName}</div>
                    {invoice.recipientAddress && <div>{invoice.recipientAddress}</div>}
                    {recipientLoc && <div>{recipientLoc} Türkiye</div>}
                    <div>Web Sitesi:</div>
                    <div>E-Posta:</div>
                    <div>Tel: Fax:</div>
                    <div>
                      {recipientTaxLabel}: {cleanRecipientTax}
                    </div>
                  </div>

                  <div className="mt-1.5 text-[9.5px] text-[#222] break-all">
                    <span className="font-bold text-black">ETTN:</span> {activeEttn}
                  </div>
                  {currency !== 'TRY' && (
                    <div className="mt-0.5 text-[9px] text-[#222]">
                      <span className="font-bold text-black">Para Birimi:</span> {currency} |{' '}
                      <span className="font-bold text-black">Kur:</span>{' '}
                      {formatNumberTR(exchangeRate, 4)} TL
                    </div>
                  )}
                </div>

                {/* Center Column: Official GİB Crest + e-Arşiv Fatura */}
                <div className="md:col-span-3 flex flex-col items-center text-center pt-5">
                  <div dangerouslySetInnerHTML={{ __html: emblemSvg }} />
                  <div className="mt-1.5 text-[13px] font-bold text-[#222]">
                    e-Arşiv Fatura
                  </div>
                  {!isApproved && (
                    <div className="mt-1.5 text-[9px] font-bold text-red-700">
                      {invoice.status === 'cancelled' ? 'İPTAL EDİLMİŞTİR' : 'TASLAK / ÖN İZLEME'}
                    </div>
                  )}
                </div>

                {/* Right Column: Top-Right Large QR Code + Bottom-Right 5-Row Metadata Grid */}
                <div className="md:col-span-4 flex flex-col items-end">
                  <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
                  <div className="h-7" />
                  <table className="w-full border-collapse border border-black text-[9.5px]">
                    <tbody>
                      <tr>
                        <td className="border border-black px-1.5 py-0.5 font-bold w-[48%]">
                          Özelleştirme No:
                        </td>
                        <td className="border border-black px-1.5 py-0.5">TR1.2</td>
                      </tr>
                      <tr>
                        <td className="border border-black px-1.5 py-0.5 font-bold">Senaryo:</td>
                        <td className="border border-black px-1.5 py-0.5">EARSIVFATURA</td>
                      </tr>
                      <tr>
                        <td className="border border-black px-1.5 py-0.5 font-bold">Fatura Tipi:</td>
                        <td className="border border-black px-1.5 py-0.5">
                          {invoice.invoiceType === 'IADE' ? 'IADE' : 'SATIS'}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-black px-1.5 py-0.5 font-bold">Fatura No:</td>
                        <td className="border border-black px-1.5 py-0.5">{finalInvoiceNo}</td>
                      </tr>
                      <tr>
                        <td className="border border-black px-1.5 py-0.5 font-bold">
                          Fatura Tarihi:
                        </td>
                        <td className="border border-black px-1.5 py-0.5">
                          {gibDashDate} {gibShortTime}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Official 11-Column GİB Line Items Table (Pure White Headers + Empty Ruled Rows) */}
              <div className="overflow-x-auto mt-3">
                <table className="w-full border-collapse border border-black text-[9px]">
                  <thead>
                    <tr className="bg-white text-black">
                      <th className="border border-black px-1 py-1 text-center font-bold">
                        Sıra<br />No
                      </th>
                      <th className="border border-black px-1.5 py-1 text-center font-bold">
                        Mal Hizmet
                      </th>
                      <th className="border border-black px-1.5 py-1 text-center font-bold">
                        Miktar
                      </th>
                      <th className="border border-black px-1.5 py-1 text-center font-bold">
                        Birim Fiyat
                      </th>
                      <th className="border border-black px-1 py-1 text-center font-bold">
                        İskonto/<br />Arttırım<br />Oranı
                      </th>
                      <th className="border border-black px-1 py-1 text-center font-bold">
                        İskonto/<br />Arttırım<br />Tutarı
                      </th>
                      <th className="border border-black px-1 py-1 text-center font-bold">
                        İskonto/<br />Arttırım<br />Nedeni
                      </th>
                      <th className="border border-black px-1 py-1 text-center font-bold">
                        KDV<br />Oranı
                      </th>
                      <th className="border border-black px-1.5 py-1 text-center font-bold">
                        KDV Tutarı
                      </th>
                      <th className="border border-black px-1.5 py-1 text-center font-bold">
                        Diğer Vergiler
                      </th>
                      <th className="border border-black px-1.5 py-1 text-center font-bold">
                        Mal<br />Hizmet<br />Tutarı
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td className="border border-black px-1.5 py-1 text-left">
                          {idx + 1}
                        </td>
                        <td className="border border-black px-1.5 py-1 text-black">{item.name}</td>
                        <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">
                          {formatGibQty(item.quantity)} {item.unit}
                        </td>
                        <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">
                          {formatGibAmount(item.unitPrice)}
                        </td>
                        <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">
                          %0,00
                        </td>
                        <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">
                          {formatGibAmount(0)}
                        </td>
                        <td className="border border-black px-1.5 py-1 text-center whitespace-nowrap">
                          İskonto -
                        </td>
                        <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">
                          %{formatNumberTR(item.vatRate, 2)}
                        </td>
                        <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">
                          {formatGibAmount(item.lineVat)}
                        </td>
                        <td className="border border-black px-1.5 py-1 text-right" />
                        <td className="border border-black px-1.5 py-1 text-right whitespace-nowrap">
                          {formatGibAmount(item.lineSubtotal)}
                        </td>
                      </tr>
                    ))}
                    {Array.from({ length: fillerRowCount }).map((_, idx) => (
                      <tr key={`empty-${idx}`}>
                        {Array.from({ length: 11 }).map((__, colIdx) => (
                          <td key={colIdx} className="border border-black h-[15px] px-1">
                            &nbsp;
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Right-Aligned Official Totals Grid */}
              <div className="mt-1 flex justify-end">
                <div className="w-full sm:w-[43%]">
                  <table className="w-full border-collapse border border-black text-[9.5px]">
                    <tbody>
                      <tr>
                        <td className="border border-black px-2 py-0.5 text-right font-bold">
                          Mal Hizmet Toplam Tutarı
                        </td>
                        <td className="border border-black px-2 py-0.5 text-right whitespace-nowrap">
                          {formatGibAmount(invoice.subtotal)}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-black px-2 py-0.5 text-right font-bold">
                          Toplam İskonto
                        </td>
                        <td className="border border-black px-2 py-0.5 text-right whitespace-nowrap">
                          {formatGibAmount(0)}
                        </td>
                      </tr>
                      {Object.entries(vatBreakdown).map(([rate, vals]) => (
                        <tr key={rate}>
                          <td className="border border-black px-2 py-0.5 text-right font-bold">
                            Hesaplanan KDV(%{rate})
                          </td>
                          <td className="border border-black px-2 py-0.5 text-right whitespace-nowrap">
                            {formatGibAmount(vals.vat)}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="border border-black px-2 py-0.5 text-right font-bold">
                          Vergiler Dahil Toplam Tutar
                        </td>
                        <td className="border border-black px-2 py-0.5 text-right whitespace-nowrap">
                          {formatGibAmount(invoice.grandTotal)}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-black px-2 py-0.5 text-right font-bold">
                          Ödenecek Tutar
                        </td>
                        <td className="border border-black px-2 py-0.5 text-right whitespace-nowrap">
                          {formatGibAmount(invoice.grandTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Full-Width Official Notes Box */}
              <div className="mt-3 border border-black px-3 py-2 min-h-[76px] text-[9.5px] text-black space-y-0.5">
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
                <div className="text-[8.5px] text-[#222] pt-1">
                  Bu belge 509 Sıra No&apos;lu VUK Genel Tebliği uyarınca elektronik ortamda e-Arşiv
                  Fatura olarak düzenlenmiştir.
                </div>
              </div>
            </div>
          )}
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
                {officialHtml
                  ? viewMode === 'official'
                    ? 'Standart Görünüm'
                    : 'GİB Orijinal Görünüm'
                  : 'GİB Orijinal Belge'}
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
    </div>
  );
};
