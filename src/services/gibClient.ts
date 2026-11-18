import type { GibMode, Invoice } from '../types';

export interface GibLoginPayload {
  mode: GibMode;
  userCode: string;
  password: string;
  rememberCredentials?: boolean;
  profileFallback?: {
    title?: string;
    taxId?: string;
    taxOffice?: string;
    address?: string;
    city?: string;
    district?: string;
  };
}

export interface GibLoginResponse {
  ok: boolean;
  sessionId?: string;
  mode?: GibMode;
  userCode?: string;
  encryptedSecret?: string;
  sellerInfo?: {
    title: string;
    taxId: string;
    taxOffice: string;
    address: string;
    city: string;
    district: string;
  };
  error?: string;
}

async function parseApiJson<T extends { ok?: boolean; error?: string }>(
  res: Response,
  fallbackError: string
): Promise<T> {
  const raw = await res.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${fallbackError} (Boş sunucu yanıtı HTTP ${res.status})` } as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    if (trimmed.startsWith('<')) {
      const isStaticGithubPages =
        typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
      if (isStaticGithubPages) {
        return {
          ok: false,
          error:
            'Statik GitHub Pages üzerinde sunucu API çalışmaz. GİB bağlantısı için uygulamanın AI Studio tam yığın linkini kullanın.',
        } as T;
      }
      return {
        ok: false,
        error: `Sunucu geçici olarak JSON yerine HTML sayfası döndürdü (HTTP ${res.status}). Lütfen sayfayı yenileyip tekrar deneyin.`,
      } as T;
    }
    return {
      ok: false,
      error: `${fallbackError} (HTTP ${res.status})`,
    } as T;
  }
}

export async function gibLogin(payload: GibLoginPayload): Promise<GibLoginResponse> {
  const res = await fetch('/api/gib/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseApiJson<GibLoginResponse>(res, 'GİB giriş yanıtı işlenemedi.');
}

export async function gibEncryptCredentials(
  userCode: string,
  password: string
): Promise<{ ok: boolean; userCode?: string; encryptedSecret?: string; error?: string }> {
  const res = await fetch('/api/gib/save-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userCode, password }),
  });
  return parseApiJson(res, 'GİB bilgileri şifrelenemedi.');
}

export async function gibLoginSaved(payload: {
  mode: GibMode;
  userCode: string;
  encryptedSecret: string;
  profileFallback?: GibLoginPayload['profileFallback'];
}): Promise<GibLoginResponse> {
  const res = await fetch('/api/gib/login-saved', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseApiJson<GibLoginResponse>(res, 'Kayıtlı GİB oturumu açılamadı.');
}

export async function gibLookupRecipient(
  sessionId: string,
  taxId: string
): Promise<{ ok: boolean; recipient?: { name: string; taxOffice: string }; error?: string }> {
  const res = await fetch('/api/gib/recipient', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, taxId }),
  });
  return parseApiJson(res, 'Mükellef sorgulama yanıtı işlenemedi.');
}

export async function gibCreateDraftAndSendSms(
  sessionId: string,
  invoice: Omit<Invoice, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<{
  ok: boolean;
  mode?: GibMode;
  ettn?: string;
  draftInvoiceNo?: string;
  oid?: string;
  maskedPhone?: string;
  error?: string;
}> {
  const res = await fetch('/api/gib/create-and-send-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, invoice }),
  });
  return parseApiJson(res, 'GİB taslak/SMS yanıtı işlenemedi.');
}

export async function gibVerifySms(
  sessionId: string,
  oid: string,
  code: string,
  ettn: string,
  invoiceDate: string
): Promise<{
  ok: boolean;
  mode?: GibMode;
  invoiceNo?: string;
  ettn?: string;
  approvedAt?: string;
  error?: string;
}> {
  const res = await fetch('/api/gib/verify-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, oid, code, ettn, invoiceDate }),
  });
  return parseApiJson(res, 'SMS doğrulama yanıtı işlenemedi.');
}

export async function gibLogout(sessionId: string): Promise<void> {
  await fetch('/api/gib/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}

export function gibLogoutBeacon(sessionId: string): void {
  if (!sessionId || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  try {
    const blob = new Blob([JSON.stringify({ sessionId })], { type: 'text/plain' });
    navigator.sendBeacon('/api/gib/logout', blob);
  } catch {
    // Ignore beacon failures on unload
  }
}

export async function fetchExchangeRates(): Promise<{
  ok: boolean;
  date?: string;
  rates?: Record<'TRY' | 'USD' | 'EUR' | 'GBP', number>;
  error?: string;
}> {
  const res = await fetch('/api/exchange-rates');
  return parseApiJson(res, 'TCMB kur verisi alınamadı.');
}

export async function gibGetOfficialInvoiceHtml(
  sessionId: string,
  ettn: string,
  status: 'draft' | 'approved' | 'cancelled'
): Promise<{ ok: boolean; html?: string; error?: string }> {
  const res = await fetch('/api/gib/invoice-html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, ettn, status }),
  });
  return parseApiJson(res, 'GİB orijinal fatura görünümü alınamadı.');
}
