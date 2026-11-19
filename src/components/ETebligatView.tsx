import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { BusinessProfile, DvSessionState, ETebligatItem, GibCredential } from '../types';
import { addDaysISO, daysUntilDue, formatDateTR, todayISO } from '../utils/formatters';
import {
  dvCompleteLogin,
  dvFetchETebligatContent,
  dvFetchETebligatFile,
  dvFetchETebligatlar,
  dvLogout,
  dvStartLogin,
  gibEncryptCredentials,
  type ETebligatAttachment,
} from '../services/gibClient';
import { createETebligatSummaryPdfBlob } from '../services/pdfService';
import type { UpsertETebligatInput } from '../services/firestoreService';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.replace(/\s+/g, '');
  const binaryStr = atob(clean);
  const len = binaryStr.length;
  const bytes = new Uint8Array(new ArrayBuffer(len));
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PdfCanvasViewer: React.FC<{
  pdfBytes: Uint8Array;
  onDownloadFallback: () => void;
}> = ({ pdfBytes, onDownloadFallback }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1.25);
  const [numPages, setNumPages] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    const renderPdf = async () => {
      const container = containerRef.current;
      if (!container) return;

      setRendering(true);
      setRenderError(null);
      container.innerHTML = '';

      try {
        // Pass a fresh copy so PDF.js worker transfer doesn't detach the caller's Uint8Array
        const copy = new Uint8Array(pdfBytes);
        loadingTask = pdfjsLib.getDocument({ data: copy });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        setNumPages(pdf.numPages);
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const maxContainerWidth = Math.max(300, container.clientWidth - 32);

        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNo);
          const unscaledViewport = page.getViewport({ scale: 1 });
          const fitScale = Math.min(1.5, maxContainerWidth / unscaledViewport.width);
          const effectiveScale = fitScale * scale;
          const viewport = page.getViewport({ scale: effectiveScale });

          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'bg-white shadow-xl rounded overflow-hidden mx-auto mb-4';
          pageWrapper.style.width = `${Math.floor(viewport.width)}px`;

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.style.display = 'block';

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          pageWrapper.appendChild(canvas);
          container.appendChild(pageWrapper);

          await page.render({
            canvasContext: ctx,
            canvas,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise;
        }
      } catch (err: any) {
        if (!cancelled) {
          setRenderError(err?.message || 'PDF önizlemesi oluşturulamadı.');
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy().catch(() => {});
      }
    };
  }, [pdfBytes, scale]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0B1120] rounded-lg border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800 bg-[#0F172A] text-xs">
        <span className="text-slate-400 font-mono-num">
          {numPages > 0 ? `${numPages} Sayfa` : rendering ? 'PDF yükleniyor...' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.7, Number((s - 0.15).toFixed(2))))}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
            title="Küçült"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono-num text-slate-300 w-12 text-center">
            %{Math.round(scale * 100)}
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(2.2, Number((s + 0.15).toFixed(2))))}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
            title="Büyüt"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto p-4 min-h-[55vh] max-h-[68vh]">
        {rendering && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            <span>PDF sayfaları hazırlanıyor...</span>
          </div>
        )}
        {renderError && (
          <div className="max-w-md mx-auto my-8 bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center space-y-3">
            <p className="text-xs text-red-300">{renderError}</p>
            <button
              type="button"
              onClick={onDownloadFallback}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              PDF Olarak İndir
            </button>
          </div>
        )}
        <div ref={containerRef} />
      </div>
    </div>
  );
};

interface ETebligatPdfPreviewState {
  item: ETebligatItem;
  pdfBytes: Uint8Array;
  blob: Blob;
  blobUrl: string;
  fileName: string;
  isOfficial: boolean;
  ekler: ETebligatAttachment[];
  tarafId?: string;
  tarafSecureId?: string;
}

interface ETebligatViewProps {
  profile?: BusinessProfile | null;
  eTebligatlar: ETebligatItem[];
  dvSession: DvSessionState;
  savedGibCred: GibCredential | null;
  onDvSessionChange: (next: DvSessionState) => void;
  onSaveGibCredential: (
    cred: Pick<GibCredential, 'userCode' | 'encryptedSecret' | 'mode' | 'autoConnect'>
  ) => Promise<void>;
  onUpsertETebligatlar: (
    items: UpsertETebligatInput[]
  ) => Promise<{ added: number; updated: number }>;
  onCreateManualETebligat: (input: {
    subject: string;
    senderUnit: string;
    documentNo?: string;
    sentDate: string;
    notes?: string;
  }) => Promise<string>;
  onToggleRead: (id: string, isRead: boolean) => Promise<void>;
  onDeleteETebligat: (id: string) => Promise<void>;
  onNotify: (msg: string) => void;
}

export const ETebligatView: React.FC<ETebligatViewProps> = ({
  profile,
  eTebligatlar,
  dvSession,
  savedGibCred,
  onDvSessionChange,
  onSaveGibCredential,
  onUpsertETebligatlar,
  onCreateManualETebligat,
  onToggleRead,
  onDeleteETebligat,
  onNotify,
}) => {
  const [querying, setQuerying] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [portalUnavailable, setPortalUnavailable] = useState(false);

  // Interactive Dijital VD Login & CAPTCHA state
  const [pendingDvId, setPendingDvId] = useState<string | null>(null);
  const [needsCredentials, setNeedsCredentials] = useState(false);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [dvUserCode, setDvUserCode] = useState(savedGibCred?.userCode || '');
  const [dvPassword, setDvPassword] = useState('');
  const [verifyingLogin, setVerifyingLogin] = useState(false);

  useEffect(() => {
    if (savedGibCred?.userCode) {
      setDvUserCode((prev) => prev || savedGibCred.userCode);
    }
  }, [savedGibCred?.userCode]);

  // Manual Entry Modal
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualSubject, setManualSubject] = useState('');
  const [manualSender, setManualSender] = useState('Vergi Dairesi Müdürlüğü');
  const [manualDocNo, setManualDocNo] = useState('');
  const [manualSentDate, setManualSentDate] = useState(todayISO());
  const [manualNotes, setManualNotes] = useState('');
  const [savingManual, setSavingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Detail, PDF & Delete state
  const [detailItem, setDetailItem] = useState<ETebligatItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<ETebligatPdfPreviewState | null>(null);
  const [loadingPdfId, setLoadingPdfId] = useState<string | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  const pendingPdfItemRef = useRef<ETebligatItem | null>(null);

  useEffect(() => {
    const currentUrl = pdfPreview?.blobUrl;
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [pdfPreview?.blobUrl]);

  // Filters
  const [search, setSearch] = useState('');
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eTebligatlar.filter((item) => {
      if (readFilter === 'unread' && item.isRead) return false;
      if (readFilter === 'read' && !item.isRead) return false;
      if (!q) return true;
      return (
        item.subject.toLowerCase().includes(q) ||
        item.senderUnit.toLowerCase().includes(q) ||
        (item.documentNo || '').toLowerCase().includes(q)
      );
    });
  }, [eTebligatlar, readFilter, search]);

  const stats = useMemo(() => {
    let unread = 0;
    let legalWindow = 0;
    for (const item of eTebligatlar) {
      if (!item.isRead) {
        unread++;
        const diff = daysUntilDue(item.legalServedDate || addDaysISO(item.sentDate, 5));
        if (diff >= 0 && diff <= 5) legalWindow++;
      }
    }
    return {
      total: eTebligatlar.length,
      unread,
      legalWindow,
      read: eTebligatlar.length - unread,
    };
  }, [eTebligatlar]);

  const openETebligatPdf = async (
    item: ETebligatItem,
    overrideSessionId?: string
  ): Promise<void> => {
    setPortalError(null);
    setPortalUnavailable(false);

    if (item.source === 'manual') {
      setLoadingPdfId(item.id);
      try {
        const { blob, fileName } = await createETebligatSummaryPdfBlob(item, profile);
        const ab = await blob.arrayBuffer();
        const pdfBytes = new Uint8Array(ab);
        const blobUrl = URL.createObjectURL(blob);
        setDetailItem(null);
        setPdfPreview({
          item,
          pdfBytes,
          blob,
          blobUrl,
          fileName,
          isOfficial: false,
          ekler: [],
        });
      } catch (err: any) {
        onNotify(err?.message || 'PDF önizlemesi oluşturulamadı.');
      } finally {
        setLoadingPdfId(null);
      }
      return;
    }

    const activeSessionId = overrideSessionId || (dvSession.connected ? dvSession.dvSessionId : null);
    if (!activeSessionId) {
      pendingPdfItemRef.current = item;
      onNotify("Tebligat PDF'ini görüntülemek için Dijital VD doğrulamasını tamamlayın.");
      await initiateDvLogin();
      return;
    }

    setLoadingPdfId(item.id);
    try {
      const resp = await dvFetchETebligatContent({
        dvSessionId: activeSessionId,
        tebligatId: item.tebligatId,
        documentNo: item.documentNo,
        tarafId: item.tarafId,
        tarafSecureId: item.tarafSecureId,
        tebligId: item.tebligId,
        tebligSecureId: item.tebligSecureId,
      });

      if (resp.sessionExpired) {
        onDvSessionChange({ connected: false, dvSessionId: null, userCode: '' });
        pendingPdfItemRef.current = item;
        onNotify("Oturum süresi doldu. PDF'i açmak için güvenlik kodunu girin.");
        await initiateDvLogin();
        return;
      }

      if (!resp.ok || !resp.pdfBase64) {
        setPortalUnavailable(Boolean(resp.portalUnavailable));
        setPortalError(resp.error || 'e-Tebligat PDF içeriği alınamadı.');
        return;
      }

      const pdfBytes = base64ToBytes(resp.pdfBase64);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);

      setDetailItem(null);
      setPdfPreview({
        item,
        pdfBytes,
        blob,
        blobUrl,
        fileName: resp.fileName || `etebligat-${item.documentNo || item.tebligatId}.pdf`,
        isOfficial: true,
        ekler: resp.ekler || [],
        tarafId: resp.tarafId || item.tarafId,
        tarafSecureId: resp.tarafSecureId || item.tarafSecureId,
      });

      if (
        (!item.tarafId || !item.tarafSecureId || !item.tebligId || !item.tebligSecureId) &&
        resp.tarafId &&
        resp.tarafSecureId &&
        resp.tebligId &&
        resp.tebligSecureId
      ) {
        await onUpsertETebligatlar([
          {
            tebligatId: item.tebligatId,
            tarafId: resp.tarafId,
            tarafSecureId: resp.tarafSecureId,
            tebligId: resp.tebligId,
            tebligSecureId: resp.tebligSecureId,
            subject: item.subject,
            senderUnit: item.senderUnit,
            documentNo: item.documentNo,
            sentDate: item.sentDate,
            legalServedDate: item.legalServedDate,
            notes: item.notes,
            portalUrl: item.portalUrl,
          },
        ]).catch(() => {});
      }

      if (!item.isRead) {
        await onToggleRead(item.id, true).catch(() => {});
      }
    } catch (err: any) {
      setPortalError(err?.message || 'e-Tebligat PDF içeriği yüklenemedi.');
    } finally {
      setLoadingPdfId(null);
    }
  };

  const fetchListWithDvSession = async (activeDvId: string): Promise<'ok' | 'expired' | 'error'> => {
    const resp = await dvFetchETebligatlar(activeDvId);
    if (resp.sessionExpired) {
      onDvSessionChange({ connected: false, dvSessionId: null, userCode: '' });
      return 'expired';
    }
    if (!resp.ok || !resp.items) {
      setPortalUnavailable(Boolean(resp.portalUnavailable));
      setPortalError(resp.error || 'e-Tebligat listesi alınamadı.');
      return 'error';
    }
    const res = await onUpsertETebligatlar(resp.items);
    setNeedsCaptcha(false);
    setNeedsCredentials(false);
    setPendingDvId(null);
    setCaptchaImage(null);
    setCaptchaCode('');
    onNotify(
      resp.items.length === 0
        ? 'Dijital Vergi Dairesinde e-Tebligat bulunamadı.'
        : `${resp.items.length} e-Tebligat sorgulandı (${res.added} yeni, ${res.updated} güncellendi).`
    );

    const queuedPdf = pendingPdfItemRef.current;
    if (queuedPdf) {
      pendingPdfItemRef.current = null;
      const matched = resp.items.find(
        (r) =>
          r.tebligatId === queuedPdf.tebligatId ||
          (queuedPdf.documentNo && r.documentNo === queuedPdf.documentNo)
      );
      const enrichedItem: ETebligatItem = matched
        ? {
            ...queuedPdf,
            tarafId: matched.tarafId || queuedPdf.tarafId,
            tarafSecureId: matched.tarafSecureId || queuedPdf.tarafSecureId,
            tebligId: matched.tebligId || queuedPdf.tebligId,
            tebligSecureId: matched.tebligSecureId || queuedPdf.tebligSecureId,
          }
        : queuedPdf;
      void openETebligatPdf(enrichedItem, activeDvId);
    }
    return 'ok';
  };

  const initiateDvLogin = async () => {
    setPortalError(null);
    setPortalUnavailable(false);
    setQuerying(true);
    try {
      const code = (dvUserCode.trim() || savedGibCred?.userCode || '').trim();
      const pass = dvPassword.trim();
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
        await fetchListWithDvSession(resp.dvSessionId);
        return;
      }

      if (resp.dvSessionId) setPendingDvId(resp.dvSessionId);
      if (resp.requiresCredentials) {
        setNeedsCredentials(true);
        setPortalError(resp.error || 'Dijital Vergi Dairesi kullanıcı kodu ve şifresini girin.');
        return;
      }
      if (resp.requiresCaptcha && resp.captchaImage) {
        setNeedsCaptcha(true);
        setCaptchaImage(resp.captchaImage);
        setCaptchaCode('');
        return;
      }

      setPortalUnavailable(Boolean(resp.portalUnavailable));
      setPortalError(
        resp.error ||
          'Dijital Vergi Dairesine doğrudan bağlanılamadı. Portal üzerinden kontrol edip manuel kayıt ekleyebilirsiniz.'
      );
    } catch (err: any) {
      setPortalUnavailable(true);
      setPortalError(err?.message || 'Dijital Vergi Dairesi sorgusu başarısız.');
    } finally {
      setQuerying(false);
    }
  };

  const handleStartQuery = async () => {
    setPortalError(null);
    setPortalUnavailable(false);
    if (dvSession.connected && dvSession.dvSessionId && !needsCaptcha && !needsCredentials) {
      setQuerying(true);
      try {
        const result = await fetchListWithDvSession(dvSession.dvSessionId);
        if (result !== 'expired') {
          return;
        }
      } catch {
        // Re-initiate if stale
      } finally {
        setQuerying(false);
      }
    }

    await initiateDvLogin();
  };

  const handleSubmitDvChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setPortalError(null);
    setVerifyingLogin(true);
    try {
      const code = (dvUserCode.trim() || savedGibCred?.userCode || '').trim();
      const pass = dvPassword.trim();

      if (!pendingDvId) {
        const startResp = await dvStartLogin({
          userCode: code,
          encryptedSecret: pass ? undefined : savedGibCred?.encryptedSecret,
          password: pass || undefined,
        });
        if (startResp.ok && startResp.dvSessionId) {
          onDvSessionChange({
            connected: true,
            dvSessionId: startResp.dvSessionId,
            userCode: startResp.userCode || code,
          });
          await fetchListWithDvSession(startResp.dvSessionId);
          return;
        }
        if (startResp.requiresCaptcha && startResp.dvSessionId && startResp.captchaImage) {
          setPendingDvId(startResp.dvSessionId);
          setNeedsCaptcha(true);
          setNeedsCredentials(false);
          setCaptchaImage(startResp.captchaImage);
          return;
        }
        setPortalUnavailable(Boolean(startResp.portalUnavailable));
        setPortalError(startResp.error || 'Dijital Vergi Dairesi bağlantısı başlatılamadı.');
        return;
      }

      const compResp = await dvCompleteLogin({
        dvSessionId: pendingDvId,
        userCode: code,
        encryptedSecret: pass ? undefined : savedGibCred?.encryptedSecret,
        password: pass || undefined,
        captchaCode: captchaCode.trim(),
      });

      if (compResp.sessionExpired) {
        setPendingDvId(null);
        await initiateDvLogin();
        return;
      }

      if (compResp.ok && compResp.dvSessionId) {
        if (code && pass && !savedGibCred) {
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
        setDvPassword('');
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
      setPortalUnavailable(Boolean(compResp.portalUnavailable));
      setPortalError(compResp.error || 'Doğrulama tamamlanamadı.');
    } catch (err: any) {
      setPortalError(err?.message || 'Doğrulama sırasında hata oluştu.');
    } finally {
      setVerifyingLogin(false);
    }
  };

  const handleCancelChallenge = () => {
    if (pendingDvId) {
      dvLogout(pendingDvId);
    }
    pendingPdfItemRef.current = null;
    setPendingDvId(null);
    setNeedsCaptcha(false);
    setNeedsCredentials(false);
    setCaptchaImage(null);
    setCaptchaCode('');
  };

  const handleDownloadAttachment = async (ek: ETebligatAttachment) => {
    if (!pdfPreview || !dvSession.dvSessionId || !pdfPreview.tarafId || !pdfPreview.tarafSecureId) {
      onNotify('Ek dosya indirmek için aktif Dijital VD oturumu gerekiyor.');
      return;
    }
    setDownloadingAttachmentId(ek.id);
    try {
      const resp = await dvFetchETebligatFile({
        dvSessionId: dvSession.dvSessionId,
        tarafId: pdfPreview.tarafId,
        tarafSecureId: pdfPreview.tarafSecureId,
        id: ek.id,
        secureId: ek.secureId,
        belgeTip: ek.belgeTip,
        uzanti: ek.uzanti,
        adi: ek.adi,
      });
      if (resp.sessionExpired) {
        onDvSessionChange({ connected: false, dvSessionId: null, userCode: '' });
        onNotify('Oturum süresi doldu. Lütfen yeniden doğrulama yapın.');
        return;
      }
      if (!resp.ok || !resp.base64) {
        onNotify(resp.error || 'Tebligat eki indirilemedi.');
        return;
      }
      const bytes = base64ToBytes(resp.base64);
      const blob = new Blob([new Uint8Array(bytes)], {
        type: resp.mimeType || 'application/octet-stream',
      });
      triggerBlobDownload(blob, resp.fileName || `${ek.adi}.${ek.uzanti || 'pdf'}`);
    } finally {
      setDownloadingAttachmentId(null);
    }
  };

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSubject.trim() || !manualSender.trim()) {
      setManualError('Tebligat konusu ve gönderen birim zorunludur.');
      return;
    }
    setManualError(null);
    setSavingManual(true);
    try {
      await onCreateManualETebligat({
        subject: manualSubject.trim(),
        senderUnit: manualSender.trim(),
        documentNo: manualDocNo.trim(),
        sentDate: manualSentDate,
        notes: manualNotes.trim(),
      });
      setManualModalOpen(false);
      setManualSubject('');
      setManualDocNo('');
      setManualNotes('');
      onNotify('e-Tebligat kaydı eklendi ve 5 günlük yasal tebliğ tarihi hesaplandı.');
    } catch (err: any) {
      setManualError(err?.message || 'Tebligat eklenemedi.');
    } finally {
      setSavingManual(false);
    }
  };

  const renderLegalCountdown = (item: ETebligatItem) => {
    const legalDate = item.legalServedDate || addDaysISO(item.sentDate, 5);
    const diff = daysUntilDue(legalDate);
    if (diff > 0) {
      return (
        <span className="text-[11px] font-semibold text-amber-300">
          {diff} gün içinde yasal tebliğ
        </span>
      );
    }
    if (diff === 0) {
      return <span className="text-[11px] font-semibold text-red-400">Bugün tebliğ sayılır</span>;
    }
    return <span className="text-[11px] text-slate-400">Tebliğ edildi</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Dijital Vergi Dairesi e-Tebligat</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            e-Tebligat bildirimlerini sorgulayın, 5 günlük yasal tebliğ süresini ve okundu durumunu takip edin
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="https://dijital.gib.gov.tr"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-[#131C2E] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
            Dijital VD’yi Aç
          </a>
          <button
            type="button"
            onClick={() => {
              setManualSentDate(todayISO());
              setManualError(null);
              setManualModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-[#131C2E] hover:bg-slate-800 border border-slate-700 text-amber-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Manuel Tebligat Ekle
          </button>
          <button
            type="button"
            onClick={handleStartQuery}
            disabled={querying}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            {querying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Tebligatları Sorgula
          </button>
        </div>
      </div>

      {/* Interactive Challenge Panel (CAPTCHA / Credentials) */}
      {(needsCaptcha || needsCredentials) && (
        <form
          onSubmit={handleSubmitDvChallenge}
          className="bg-[#131C2E] border border-blue-500/35 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-4 h-4 text-blue-400 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Dijital Vergi Dairesi Doğrulaması
                </h3>
                <p className="text-xs text-slate-400">
                  {needsCaptcha
                    ? 'Portalın istediği güvenlik kodunu (CAPTCHA) girerek tebligat kutusuna bağlanın'
                    : 'Dijital Vergi Dairesi kullanıcı kodu ve şifrenizi girin'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancelChallenge}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {(needsCredentials || !savedGibCred) && (
              <>
                <div className="md:col-span-4">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Kullanıcı Kodu
                  </label>
                  <input
                    type="text"
                    value={dvUserCode}
                    onChange={(e) => setDvUserCode(e.target.value)}
                    placeholder="GİB / İVD Kullanıcı Kodu"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    required
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Dijital VD Şifre
                  </label>
                  <input
                    type="password"
                    value={dvPassword}
                    onChange={(e) => setDvPassword(e.target.value)}
                    placeholder="Şifreniz"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                    required
                  />
                </div>
              </>
            )}

            {needsCaptcha && captchaImage && (
              <div className="md:col-span-5 flex items-end gap-3">
                <img
                  src={captchaImage}
                  alt="Dijital Vergi Dairesi Güvenlik Kodu"
                  className="h-10 rounded border border-slate-700 bg-white px-1 object-contain"
                />
                <div className="flex-1 min-w-[120px]">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-300">
                      Güvenlik Kodu *
                    </label>
                    <button
                      type="button"
                      onClick={initiateDvLogin}
                      disabled={querying || verifyingLogin}
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

            <div className="md:col-span-4 flex items-center gap-2">
              <button
                type="submit"
                disabled={verifyingLogin}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
              >
                {verifyingLogin && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Doğrula &amp; Tebligatları Çek
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Portal Notice / Error Banner */}
      {portalError && (
        <div
          className={`rounded-xl px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3 border ${
            portalUnavailable
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-start gap-2.5 max-w-3xl">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">{portalError}</div>
              {portalUnavailable && (
                <div className="text-[11px] opacity-85 mt-0.5">
                  Dijital Vergi Dairesini tarayıcıda açıp gelen bildirimi “Manuel Tebligat Ekle” ile kaydederseniz 5 günlük yasal tebliğ uyarısı burada otomatik takip edilir.
                </div>
              )}
            </div>
          </div>
          {portalUnavailable && (
            <button
              type="button"
              onClick={() => setManualModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold rounded-lg whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Manuel Kayıt Ekle
            </button>
          )}
        </div>
      )}

      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Toplam Tebligat</div>
          <div className="text-xl font-bold font-mono-num text-slate-100">{stats.total} adet</div>
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Okunmamış Bildirim</div>
          <div className="text-xl font-bold font-mono-num text-amber-400">{stats.unread} adet</div>
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">5 Günlük Yasal Sürede</div>
          <div className="text-xl font-bold font-mono-num text-red-400">
            {stats.legalWindow} adet
          </div>
        </div>
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Okundu İşaretlenen</div>
          <div className="text-xl font-bold font-mono-num text-emerald-400">
            {stats.read} adet
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
            placeholder="Konu, vergi dairesi veya belge no ara..."
            className="w-full pl-9 pr-3 py-2 bg-[#131C2E] border border-slate-800 focus:border-blue-500 focus:outline-none rounded-lg text-xs text-slate-100"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#131C2E] border border-slate-800 rounded-lg">
          {(
            [
              { id: 'all', label: 'Tümü' },
              { id: 'unread', label: 'Okunmadı' },
              { id: 'read', label: 'Okundu' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setReadFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                readFilter === tab.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tebligat List Table */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="py-14 px-6 text-center space-y-2.5">
            <BellRing className="w-9 h-9 text-slate-600 mx-auto" />
            <p className="text-sm font-medium text-slate-300">
              {eTebligatlar.length === 0
                ? 'Henüz e-Tebligat kaydı bulunmuyor'
                : 'Filtrenize uygun e-Tebligat yok'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              “Tebligatları Sorgula” ile Dijital Vergi Dairesinden otomatik çekebilir veya SMS/e-posta ile gelen tebligatları manuel ekleyebilirsiniz.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold text-slate-400">
                  <th className="py-3 px-4">Durum</th>
                  <th className="py-3 px-4">Gönderen Birim &amp; Konu</th>
                  <th className="py-3 px-4">Gönderim / Yasal Tebliğ</th>
                  <th className="py-3 px-4 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredItems.map((item) => {
                  const legalDate = item.legalServedDate || addDaysISO(item.sentDate, 5);
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-800/30 ${
                        !item.isRead ? 'bg-amber-500/[0.03]' : ''
                      }`}
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {item.isRead ? (
                            <MailOpen className="w-4 h-4 text-slate-500" />
                          ) : (
                            <Mail className="w-4 h-4 text-amber-400" />
                          )}
                          <span
                            className={`text-[11px] font-semibold ${
                              item.isRead ? 'text-slate-400' : 'text-amber-300'
                            }`}
                          >
                            {item.isRead ? 'Okundu' : 'Okunmadı'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => openETebligatPdf(item)}
                          className="text-left font-semibold text-slate-100 hover:text-blue-300 transition-colors"
                        >
                          {item.subject}
                        </button>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {item.senderUnit}
                          {item.documentNo ? ` · Belge No: ${item.documentNo}` : ''}
                          {' · '}
                          {item.source === 'live' ? 'Dijital VD' : 'Manuel Kayıt'}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono-num text-slate-200">
                          {formatDateTR(item.sentDate)} → {formatDateTR(legalDate)}
                        </div>
                        <div>{renderLegalCountdown(item)}</div>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openETebligatPdf(item)}
                            disabled={loadingPdfId === item.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-md text-[11px] font-semibold"
                          >
                            {loadingPdfId === item.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                            PDF Gör
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailItem(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[11px] font-medium"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Detay
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleRead(item.id, !item.isRead)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold ${
                              item.isRead
                                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                : 'bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300'
                            }`}
                          >
                            {item.isRead ? (
                              <>
                                <Mail className="w-3.5 h-3.5" />
                                Okunmadı Yap
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                Okundu İşaretle
                              </>
                            )}
                          </button>
                          {confirmDeleteId === item.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteETebligat(item.id);
                                  setConfirmDeleteId(null);
                                  onNotify('e-Tebligat kaydı silindi.');
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
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="p-1.5 text-slate-500 hover:text-red-400"
                              title="Sil"
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

      {/* Manual e-Tebligat Modal */}
      {manualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
              <h3 className="text-base font-semibold text-slate-100">Manuel e-Tebligat Ekle</h3>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateManual} className="p-5 space-y-4">
              {manualError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{manualError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Tebligat Konusu *
                </label>
                <input
                  type="text"
                  maxLength={240}
                  value={manualSubject}
                  onChange={(e) => setManualSubject(e.target.value)}
                  placeholder="Örn: KDV Beyannamesi İzaha Davet Yazısı"
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Gönderen Birim *
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={manualSender}
                    onChange={(e) => setManualSender(e.target.value)}
                    placeholder="Örn: Ümraniye Vergi Dairesi"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Belge / Evrak No
                  </label>
                  <input
                    type="text"
                    maxLength={64}
                    value={manualDocNo}
                    onChange={(e) => setManualDocNo(e.target.value)}
                    placeholder="Örn: 2026-ETEB-4910"
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Gönderim Tarihi *
                  </label>
                  <input
                    type="date"
                    value={manualSentDate}
                    onChange={(e) => setManualSentDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm font-mono-num text-slate-100"
                    required
                  />
                </div>
                <div className="bg-[#0B1120] border border-slate-800 rounded-lg px-3 py-2 text-xs">
                  <div className="text-slate-400">Yasal Tebliğ Tarihi (+5 Gün)</div>
                  <div className="font-mono-num font-semibold text-amber-300 mt-0.5">
                    {formatDateTR(addDaysISO(manualSentDate, 5))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Notlar</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Mali müşavire iletildi veya yapılacak aksiyon..."
                  className="w-full px-3 py-2 bg-[#0F172A] border border-slate-700 focus:border-blue-500 focus:outline-none rounded-lg text-sm text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setManualModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={savingManual}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  {savingManual && <Loader2 className="w-4 h-4 animate-spin" />}
                  Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0F172A]">
              <h3 className="text-base font-semibold text-slate-100 truncate">
                e-Tebligat Detayı
              </h3>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <div className="text-slate-400">Konu</div>
                <div className="text-sm font-semibold text-slate-100 mt-0.5">
                  {detailItem.subject}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-[#0B1120] border border-slate-800 rounded-lg p-3.5">
                <div>
                  <div className="text-slate-400">Gönderen Birim</div>
                  <div className="font-medium text-slate-100 mt-0.5">{detailItem.senderUnit}</div>
                </div>
                <div>
                  <div className="text-slate-400">Belge No</div>
                  <div className="font-mono-num text-slate-100 mt-0.5">
                    {detailItem.documentNo || '-'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Gönderim Tarihi</div>
                  <div className="font-mono-num text-slate-100 mt-0.5">
                    {formatDateTR(detailItem.sentDate)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Yasal Tebliğ (+5 Gün)</div>
                  <div className="font-mono-num font-semibold text-amber-300 mt-0.5">
                    {formatDateTR(
                      detailItem.legalServedDate || addDaysISO(detailItem.sentDate, 5)
                    )}
                  </div>
                </div>
              </div>

              {detailItem.notes && (
                <div>
                  <div className="text-slate-400">Notlar</div>
                  <div className="text-slate-200 mt-0.5 whitespace-pre-wrap">
                    {detailItem.notes}
                  </div>
                </div>
              )}

              <div className="text-[11px] text-slate-400 bg-slate-900/80 border border-slate-800 rounded-lg p-3">
                VUK 107/A maddesi gereğince elektronik tebligatlar, muhatabın elektronik adresine ulaştığı tarihi izleyen 5. günün sonunda tebliğ edilmiş sayılır.
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-slate-800 bg-[#0F172A]">
              <button
                type="button"
                onClick={() => openETebligatPdf(detailItem)}
                disabled={loadingPdfId === detailItem.id}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold rounded-lg"
              >
                {loadingPdfId === detailItem.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                PDF Olarak Göster
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const nextRead = !detailItem.isRead;
                    await onToggleRead(detailItem.id, nextRead);
                    setDetailItem({ ...detailItem, isRead: nextRead });
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {detailItem.isRead ? 'Okunmadı Yap' : 'Okundu İşaretle'}
                </button>
                <button
                  type="button"
                  onClick={() => setDetailItem(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF Content Viewer Modal */}
      {pdfPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5">
          <div className="w-full max-w-5xl bg-[#131C2E] border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800 bg-[#0F172A]">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
                  {pdfPreview.item.subject}
                </h3>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {pdfPreview.item.senderUnit}
                  {pdfPreview.item.documentNo ? ` · Belge No: ${pdfPreview.item.documentNo}` : ''}
                  {' · '}
                  {pdfPreview.isOfficial
                    ? 'Dijital Vergi Dairesi Orijinal Tebligat PDF'
                    : 'e-Tebligat Özet PDF'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => triggerBlobDownload(pdfPreview.blob, pdfPreview.fileName)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF İndir
                </button>
                <button
                  type="button"
                  onClick={() => setPdfPreview(null)}
                  className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg"
                  title="Kapat"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-[#0B1120] p-3 sm:p-4 overflow-hidden flex flex-col gap-3 min-h-0">
              <PdfCanvasViewer
                pdfBytes={pdfPreview.pdfBytes}
                onDownloadFallback={() => triggerBlobDownload(pdfPreview.blob, pdfPreview.fileName)}
              />

              {pdfPreview.ekler.length > 0 && (
                <div className="bg-[#131C2E] border border-slate-800 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <Paperclip className="w-3.5 h-3.5 text-blue-400" />
                    <span>Tebligat Ekleri ({pdfPreview.ekler.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pdfPreview.ekler.map((ek) => (
                      <button
                        key={ek.id}
                        type="button"
                        onClick={() => handleDownloadAttachment(ek)}
                        disabled={downloadingAttachmentId === ek.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F172A] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg transition-colors"
                      >
                        {downloadingAttachmentId === ek.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        ) : (
                          <Download className="w-3.5 h-3.5 text-blue-400" />
                        )}
                        <span>{ek.adi}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-slate-800 bg-[#0F172A] text-[11px] text-slate-400">
              <span>
                Gönderim: {formatDateTR(pdfPreview.item.sentDate)} · Yasal Tebliğ:{' '}
                {formatDateTR(
                  pdfPreview.item.legalServedDate || addDaysISO(pdfPreview.item.sentDate, 5)
                )}
              </span>
              <div className="flex items-center gap-3">
                <a
                  href={pdfPreview.blobUrl}
                  download={pdfPreview.fileName}
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Tarayıcı PDF açmazsa buradan indirin
                </a>
                <a
                  href={pdfPreview.item.portalUrl || 'https://dijital.gib.gov.tr'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-300 hover:text-slate-100"
                >
                  <ExternalLink className="w-3 h-3" />
                  Dijital VD
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
