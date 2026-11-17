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

export async function gibLogin(payload: GibLoginPayload): Promise<GibLoginResponse> {
  const res = await fetch('/api/gib/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
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
  return res.json();
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
  return res.json();
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
  return res.json();
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
  return res.json();
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
  return res.json();
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
  return res.json();
}
