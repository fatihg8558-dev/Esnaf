import express from 'express';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GIB_BASE_URL = 'https://earsivportal.efatura.gov.tr/earsiv-services';

function getCredentialSeed(): string {
  let seed = process.env.GIB_CRED_SECRET || '';
  if (!seed) {
    try {
      const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        seed = `${cfg.projectId || ''}:${cfg.firestoreDatabaseId || ''}:gib-vault`;
      }
    } catch {
      // ignore
    }
  }
  return seed || 'esnaf-earsiv-fallback-key';
}

const CREDENTIAL_SEED = getCredentialSeed();
const CREDENTIAL_KEY = crypto.scryptSync(CREDENTIAL_SEED, 'esnaf-earsiv-gib-salt-v1', 32);
const CREDENTIAL_KEY_V2 = crypto
  .createHash('sha256')
  .update(`${CREDENTIAL_SEED}:esnaf-earsiv-gib-v2`)
  .digest();

function encryptGibPassword(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CREDENTIAL_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptGibPassword(payload: string): string {
  const raw = String(payload || '').trim();
  if (raw.startsWith('v2:')) {
    const parts = raw.slice(3).split(':');
    if (parts.length !== 3) {
      throw new Error('Kayıtlı GİB şifre verisi geçersiz.');
    }
    const [ivHex, tagHex, cipherHex] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      CREDENTIAL_KEY_V2,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  const parts = raw.split(':');
  if (parts.length !== 3) {
    throw new Error('Kayıtlı GİB şifre verisi geçersiz.');
  }
  const [ivHex, tagHex, cipherHex] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    CREDENTIAL_KEY,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

const gibHttpsAgent = new https.Agent({
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  keepAlive: true,
  timeout: 20000,
});

interface GibSession {
  id: string;
  mode: 'live';
  userCode: string;
  gibToken: string;
  gsmNo?: string;
  createdAt: number;
  lastActivity: number;
  sellerInfo: {
    title: string;
    taxId: string;
    taxOffice: string;
    address: string;
    city: string;
    district: string;
  };
  pendingSms?: {
    oid: string;
    ettn: string;
    draftRow?: Record<string, any>;
    expiresAt: number;
  };
}

const gibSessions = new Map<string, GibSession>();

// Cleanup expired ephemeral GİB sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of gibSessions.entries()) {
    if (now - session.lastActivity > 30 * 60 * 1000) {
      gibSessions.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

function postFormToGib(endpoint: string, formParams: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(formParams).toString();
    const url = new URL(`${GIB_BASE_URL}${endpoint}`);

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        agent: gibHttpsAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://earsivportal.efatura.gov.tr',
          'Referer': 'https://earsivportal.efatura.gov.tr/intragiris.html',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        timeout: 14000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve(parsed);
          } catch {
            reject(new Error(`GİB sunucusundan beklenmeyen yanıt alındı (HTTP ${res.statusCode}).`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('GİB e-Arşiv Portal bağlantısı zaman aşımına uğradı.'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

async function gibDispatch(token: string, cmd: string, pageName: string, jp: Record<string, unknown> = {}) {
  return postFormToGib('/dispatch', {
    cmd,
    callid: crypto.randomUUID(),
    pageName,
    token,
    jp: JSON.stringify(jp),
  });
}

function getGibErrorMessage(res: any, fallback: string): string {
  if (!res) return fallback;
  if (typeof res.data === 'string' && res.data.trim() && !res.data.toLowerCase().includes('başarıyla')) {
    return res.data.trim();
  }
  if (res.data && typeof res.data === 'object') {
    if (typeof res.data.hata === 'string' && res.data.hata.trim()) return res.data.hata.trim();
    if (typeof res.data.mesaj === 'string' && res.data.mesaj.trim()) return res.data.mesaj.trim();
  }
  if (res.error) {
    if (Array.isArray(res.messages) && res.messages.length > 0) {
      return res.messages.map((m: any) => m.text || String(m)).join(' ');
    }
    if (typeof res.error === 'string') return res.error;
  }
  return fallback;
}

function formatGibDateFromISO(isoDate?: string, offsetDays = 0): string {
  let base: Date;
  const parts = String(isoDate || '').split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    base = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  } else {
    // Current date in Europe/Istanbul
    const istanbulStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const p = istanbulStr.split('-');
    base = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  }
  if (offsetDays !== 0) {
    base.setUTCDate(base.getUTCDate() + offsetDays);
  }
  const d = String(base.getUTCDate()).padStart(2, '0');
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const y = base.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

function normalizeGibTime(rawTime?: string): string {
  const clean = String(rawTime || '').trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(clean)) return clean;
  if (/^\d{2}:\d{2}$/.test(clean)) return `${clean}:00`;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function mapUnitToGibCode(unit?: string): string {
  const key = String(unit || '').trim().toLowerCase();
  const table: Record<string, string> = {
    adet: 'C62',
    hizmet: 'C62',
    saat: 'HUR',
    gün: 'DAY',
    gun: 'DAY',
    ay: 'MON',
    kg: 'KGM',
    kilogram: 'KGM',
    gram: 'GRM',
    litre: 'LTR',
    paket: 'PA',
    kutu: 'BX',
    metre: 'MTR',
    'm²': 'MTK',
  };
  return table[key] || 'C62';
}

async function fetchGibDraftRows(
  token: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  try {
    const r1 = await gibDispatch(token, 'EARSIV_PORTAL_TASLAKLARI_GETIR', 'RG_TASLAKLAR', {
      baslangic: startDate,
      bitis: endDate,
      hangiTip: '5000/30000',
    });
    if (Array.isArray(r1?.data)) return r1.data;
  } catch {
    // Fallback below
  }

  try {
    const r2 = await gibDispatch(token, 'EARSIV_PORTAL_TASLAKLARI_GETIR', 'RG_BASITTASLAKLAR', {
      baslangic: startDate,
      bitis: endDate,
      hangiTip: '5000/30000',
      table: [],
    });
    if (Array.isArray(r2?.data)) return r2.data;
  } catch {
    // Ignore
  }

  return [];
}

function parseGibTrNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const str = String(raw ?? '').trim();
  if (!str) return 0;
  // Remove currency suffixes or spaces
  const cleaned = str.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  // If both '.' and ',' appear, '.' is thousands separator and ',' is decimal (TR format)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (cleaned.includes(',')) {
    return Number(cleaned.replace(',', '.')) || 0;
  }
  return Number(cleaned) || 0;
}

function parseGibDateToIso(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const m = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (
    compact &&
    Number(compact[2]) >= 1 &&
    Number(compact[2]) <= 12 &&
    Number(compact[3]) >= 1 &&
    Number(compact[3]) <= 31
  ) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  return s.slice(0, 10);
}

function addDaysToIso(isoDate: string, days: number): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return isoDate;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return d.toISOString().slice(0, 10);
}

interface DvETebligatLookup {
  tarafId: string;
  tarafSecureId: string;
  tebligId: string;
  tebligSecureId: string;
  documentNo: string;
}

interface DvSession {
  id: string;
  userCode: string;
  cookies: string[];
  captchaId?: string;
  dvToken?: string;
  etebligatRows?: Map<string, DvETebligatLookup>;
  createdAt: number;
  lastActivity: number;
}

const dvSessions = new Map<string, DvSession>();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of dvSessions.entries()) {
    if (now - s.lastActivity > 20 * 60 * 1000) {
      dvSessions.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

function mergeSetCookies(existing: string[], setCookieHeader: string[] | string | undefined): string[] {
  if (!setCookieHeader) return existing;
  const incomingList = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const map = new Map<string, string>();
  for (const c of existing) {
    const idx = c.indexOf('=');
    if (idx > 0) map.set(c.slice(0, idx), c);
  }
  for (const raw of incomingList) {
    const pair = raw.split(';')[0]?.trim();
    if (!pair) continue;
    const idx = pair.indexOf('=');
    if (idx > 0) map.set(pair.slice(0, idx), pair);
  }
  return Array.from(map.values());
}

function extractDvErrorMessage(json: any, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  const messages = Array.isArray(json.messages) ? json.messages : [];
  const errObj =
    messages.find((m: any) => m?.type === 'ERROR') ||
    messages.find((m: any) => m?.type === 'WARNING') ||
    messages[0];
  const msgText = String(
    errObj?.text ||
      json.errorMessage ||
      json.warningMessage ||
      json.message ||
      json.error ||
      ''
  ).trim();
  return msgText || fallback;
}

function getTodayIstanbulIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function requestDijitalVdRaw(
  urlOrPath: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    cookies?: string[];
    token?: string;
    extraHeaders?: Record<string, string>;
    redirectDepth?: number;
  } = {}
): Promise<{ status: number; contentType: string; buffer: Buffer; json: any; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const payload = options.body ? JSON.stringify(options.body) : '';
    const isAbsolute = /^https?:\/\//i.test(urlOrPath);
    const targetUrl = new URL(
      isAbsolute ? urlOrPath : `https://dijital.gib.gov.tr${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`
    );
    const isGibHost =
      targetUrl.hostname === 'dijital.gib.gov.tr' || targetUrl.hostname.endsWith('.gib.gov.tr');

    const headers: Record<string, string | number> = {
      Accept: 'application/json, application/pdf, application/octet-stream, text/plain, */*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ...(options.extraHeaders || {}),
    };
    if (isGibHost) {
      headers.Origin = 'https://dijital.gib.gov.tr';
      headers.Referer = 'https://dijital.gib.gov.tr/';
      headers['ui-client'] = 'fe';
      if (options.cookies && options.cookies.length > 0) {
        headers.Cookie = options.cookies.join('; ');
      }
      if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
      }
    }
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json;charset=UTF-8';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const isHttp = targetUrl.protocol === 'http:';
    const requestOptions: https.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port ? Number(targetUrl.port) : isHttp ? 80 : 443,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method,
      agent: isHttp ? undefined : gibHttpsAgent,
      headers,
      timeout: 20000,
    };

    const handleResponse = (res: http.IncomingMessage) => {
      const updatedCookies = mergeSetCookies(options.cookies || [], res.headers['set-cookie']);
      const status = res.statusCode || 500;
      const location = res.headers.location;
      if (
        location &&
        status >= 300 &&
        status < 400 &&
        (options.redirectDepth || 0) < 3
      ) {
        res.resume();
        const nextUrl = new URL(location, targetUrl).toString();
        requestDijitalVdRaw(nextUrl, {
          method: 'GET',
          cookies: updatedCookies,
          token: options.token,
          redirectDepth: (options.redirectDepth || 0) + 1,
        })
          .then(resolve)
          .catch(reject);
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        let parsed: any = null;
        const looksJson =
          contentType.includes('json') ||
          contentType.includes('text') ||
          (buffer.length > 0 && (buffer[0] === 0x7b || buffer[0] === 0x5b));
        if (looksJson && buffer.length < 5 * 1024 * 1024) {
          try {
            parsed = JSON.parse(buffer.toString('utf8'));
          } catch {
            parsed = null;
          }
        }
        resolve({
          status,
          contentType,
          buffer,
          json: parsed,
          cookies: updatedCookies,
        });
      });
    };

    const req = isHttp
      ? http.request(requestOptions, handleResponse)
      : https.request(requestOptions, handleResponse);

    req.on('timeout', () => {
      req.destroy(new Error('Dijital Vergi Dairesi bağlantısı zaman aşımına uğradı.'));
    });
    req.on('error', reject);
    if (method === 'POST' && payload) {
      req.write(payload);
    }
    req.end();
  });
}

function guessMimeFromExtension(uzanti?: string): string {
  const ext = String(uzanti || '').toLowerCase().replace(/^\./, '');
  if (ext === 'pdf' || !ext) return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'xml') return 'application/xml';
  if (ext === 'zip') return 'application/zip';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'html' || ext === 'htm') return 'text/html';
  return 'application/octet-stream';
}

interface BerHeaderInfo {
  tag: number;
  constructed: boolean;
  indefinite: boolean;
  length: number;
  contentStart: number;
  nextOffset: number; // only valid when !indefinite
}

function readBerHeader(buf: Buffer, offset: number, limit: number): BerHeaderInfo | null {
  if (offset >= limit) return null;
  const tag = buf[offset];
  const constructed = (tag & 0x20) !== 0;
  let pos = offset + 1;
  // Support high-tag-number form just in case
  if ((tag & 0x1f) === 0x1f) {
    while (pos < limit && (buf[pos] & 0x80) !== 0) pos++;
    pos++;
  }
  if (pos >= limit) return null;
  const lenByte = buf[pos++];
  if (lenByte === 0x80) {
    return {
      tag,
      constructed,
      indefinite: true,
      length: 0,
      contentStart: pos,
      nextOffset: limit,
    };
  }
  if ((lenByte & 0x80) === 0) {
    const length = lenByte;
    if (pos + length > limit) return null;
    return {
      tag,
      constructed,
      indefinite: false,
      length,
      contentStart: pos,
      nextOffset: pos + length,
    };
  }
  const numBytes = lenByte & 0x7f;
  if (numBytes === 0 || numBytes > 4 || pos + numBytes > limit) return null;
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    length = length * 256 + buf[pos++];
  }
  if (pos + length > limit) return null;
  return {
    tag,
    constructed,
    indefinite: false,
    length,
    contentStart: pos,
    nextOffset: pos + length,
  };
}

function skipBerElement(buf: Buffer, offset: number, limit: number, depth = 0): number {
  if (depth > 32 || offset >= limit) return limit;
  const hdr = readBerHeader(buf, offset, limit);
  if (!hdr) return limit;
  if (!hdr.indefinite) return hdr.nextOffset;
  let pos = hdr.contentStart;
  while (pos + 1 < limit) {
    if (buf[pos] === 0x00 && buf[pos + 1] === 0x00) {
      return pos + 2;
    }
    const next = skipBerElement(buf, pos, limit, depth + 1);
    if (next <= pos) return limit;
    pos = next;
  }
  return limit;
}

function collectBerOctetString(
  buf: Buffer,
  offset: number,
  limit: number,
  depth = 0
): { bytes: Buffer; nextOffset: number } | null {
  if (depth > 32 || offset >= limit) return null;
  const hdr = readBerHeader(buf, offset, limit);
  if (!hdr) return null;

  if ((hdr.tag & 0x1f) === 0x04 && !hdr.constructed) {
    if (hdr.indefinite) return null;
    return {
      bytes: buf.subarray(hdr.contentStart, hdr.nextOffset),
      nextOffset: hdr.nextOffset,
    };
  }

  if ((hdr.tag & 0x1f) === 0x04 && hdr.constructed) {
    const parts: Buffer[] = [];
    const childLimit = hdr.indefinite ? limit : hdr.nextOffset;
    let pos = hdr.contentStart;
    while (pos < childLimit) {
      if (hdr.indefinite && pos + 1 < childLimit && buf[pos] === 0x00 && buf[pos + 1] === 0x00) {
        return { bytes: Buffer.concat(parts), nextOffset: pos + 2 };
      }
      const child = collectBerOctetString(buf, pos, childLimit, depth + 1);
      if (!child || child.nextOffset <= pos) break;
      parts.push(child.bytes);
      pos = child.nextOffset;
    }
    return { bytes: Buffer.concat(parts), nextOffset: hdr.indefinite ? pos : hdr.nextOffset };
  }

  return null;
}

function extractPkcs7SignedContent(buf: Buffer): Buffer | null {
  if (buf.length < 24 || buf[0] !== 0x30) return null;
  // ContentInfo ::= SEQUENCE
  const ci = readBerHeader(buf, 0, buf.length);
  if (!ci || ci.tag !== 0x30) return null;
  const ciLimit = ci.indefinite ? buf.length : ci.nextOffset;

  // Child 0: contentType OID (must be 1.2.840.113549.1.7.2 = signedData)
  const oidHdr = readBerHeader(buf, ci.contentStart, ciLimit);
  if (!oidHdr || oidHdr.tag !== 0x06 || oidHdr.indefinite) return null;
  const oidBytes = buf.subarray(oidHdr.contentStart, oidHdr.nextOffset);
  const signedDataOid = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  if (!oidBytes.equals(signedDataOid)) return null;

  // Child 1: content [0] EXPLICIT SignedData
  const ctx0 = readBerHeader(buf, oidHdr.nextOffset, ciLimit);
  if (!ctx0 || (ctx0.tag & 0xe0) !== 0xa0) return null;
  const ctx0Limit = ctx0.indefinite ? ciLimit : ctx0.nextOffset;

  const sd = readBerHeader(buf, ctx0.contentStart, ctx0Limit);
  if (!sd || sd.tag !== 0x30) return null;
  const sdLimit = sd.indefinite ? ctx0Limit : sd.nextOffset;

  // SignedData Child 0: version (INTEGER)
  let pos = skipBerElement(buf, sd.contentStart, sdLimit);
  // SignedData Child 1: digestAlgorithms (SET)
  pos = skipBerElement(buf, pos, sdLimit);
  // SignedData Child 2: encapContentInfo (SEQUENCE)
  const eci = readBerHeader(buf, pos, sdLimit);
  if (!eci || eci.tag !== 0x30) return null;
  const eciLimit = eci.indefinite ? sdLimit : eci.nextOffset;

  // encapContentInfo Child 0: eContentType (OID)
  pos = skipBerElement(buf, eci.contentStart, eciLimit);
  if (pos >= eciLimit) return null;

  // encapContentInfo Child 1: eContent [0] EXPLICIT OCTET STRING
  const eContentCtx = readBerHeader(buf, pos, eciLimit);
  if (!eContentCtx || (eContentCtx.tag & 0xe0) !== 0xa0) return null;
  const eContentLimit = eContentCtx.indefinite ? eciLimit : eContentCtx.nextOffset;

  const collected = collectBerOctetString(buf, eContentCtx.contentStart, eContentLimit);
  if (!collected || collected.bytes.length === 0) return null;
  return collected.bytes;
}

function unwrapPdfBufferIfWrapped(buf: Buffer): { buffer: Buffer; isPdf: boolean } {
  const pdfSig = Buffer.from('%PDF-');
  if (buf.length >= 5 && buf.subarray(0, 5).equals(pdfSig)) {
    return { buffer: buf, isPdf: true };
  }

  // 1. Try full ASN.1 BER PKCS#7 / CAdES SignedData eContent extraction
  const pkcs7Payload = extractPkcs7SignedContent(buf);
  if (pkcs7Payload) {
    const idx = pkcs7Payload.indexOf(pdfSig);
    if (idx >= 0 && idx <= 64) {
      return {
        buffer: idx === 0 ? pkcs7Payload : pkcs7Payload.subarray(idx),
        isPdf: true,
      };
    }
  }

  // 2. Fallback: look for %PDF- header near start and trim to %%EOF
  const searchWindow = buf.subarray(0, Math.min(buf.length, 8192));
  const pdfIdx = searchWindow.indexOf(pdfSig);
  if (pdfIdx >= 0) {
    const eofSig = Buffer.from('%%EOF');
    const eofIdx = buf.lastIndexOf(eofSig);
    if (eofIdx > pdfIdx) {
      let endIdx = eofIdx + eofSig.length;
      while (endIdx < buf.length && (buf[endIdx] === 0x0d || buf[endIdx] === 0x0a)) {
        endIdx++;
      }
      return { buffer: buf.subarray(pdfIdx, endIdx), isPdf: true };
    }
    return { buffer: buf.subarray(pdfIdx), isPdf: true };
  }

  return { buffer: buf, isPdf: false };
}

async function resolveDvReportLinkToBuffer(
  reportLink: string,
  dvSession: DvSession,
  fallbackExt?: string
): Promise<{ ok: boolean; buffer?: Buffer; mimeType?: string; error?: string }> {
  const clean = String(reportLink || '').trim();
  if (!clean) {
    return { ok: false, error: 'Belge bağlantısı boş döndü.' };
  }

  // 1. Data URI: data:application/pdf;base64,JVBERi...
  const dataMatch = clean.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]+)$/i);
  if (dataMatch) {
    const mimeType = (dataMatch[1] || guessMimeFromExtension(fallbackExt)).trim();
    const b64 = dataMatch[2].replace(/\s+/g, '');
    return { ok: true, buffer: Buffer.from(b64, 'base64'), mimeType };
  }

  // 2. URL or relative path
  if (
    /^https?:\/\//i.test(clean) ||
    clean.startsWith('/') ||
    clean.startsWith('apigateway/')
  ) {
    const target = /^https?:\/\//i.test(clean)
      ? clean
      : clean.startsWith('/')
      ? clean
      : `/${clean}`;
    const fileResp = await requestDijitalVdRaw(target, {
      method: 'GET',
      cookies: dvSession.cookies,
      token: dvSession.dvToken,
    });
    dvSession.cookies = fileResp.cookies;
    if (fileResp.status === 401) {
      return { ok: false, error: 'SESSION_EXPIRED' };
    }
    if (fileResp.status >= 400) {
      return {
        ok: false,
        error: extractDvErrorMessage(
          fileResp.json,
          `Belge indirilemedi (HTTP ${fileResp.status}).`
        ),
      };
    }
    if (fileResp.json && (fileResp.json.reportLink || fileResp.json.data?.reportLink)) {
      const nested = String(fileResp.json.reportLink || fileResp.json.data?.reportLink);
      return resolveDvReportLinkToBuffer(nested, dvSession, fallbackExt);
    }
    const mimeType =
      fileResp.contentType && !fileResp.contentType.includes('octet-stream')
        ? fileResp.contentType.split(';')[0].trim()
        : guessMimeFromExtension(fallbackExt);
    return { ok: true, buffer: fileResp.buffer, mimeType };
  }

  // 3. Raw base64 payload (e.g. JVBERi0... for %PDF- or general base64)
  if (/^[A-Za-z0-9+/=\s]+$/.test(clean) && clean.length > 64) {
    const buf = Buffer.from(clean.replace(/\s+/g, ''), 'base64');
    return { ok: true, buffer: buf, mimeType: guessMimeFromExtension(fallbackExt) };
  }

  return { ok: false, error: 'Desteklenmeyen belge biçimi alındı.' };
}

function requestDijitalVd(
  endpointPath: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    cookies?: string[];
    token?: string;
    extraHeaders?: Record<string, string>;
  } = {}
): Promise<{ status: number; json: any; raw: string; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const payload = options.body ? JSON.stringify(options.body) : '';
    const headers: Record<string, string | number> = {
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://dijital.gib.gov.tr',
      Referer: 'https://dijital.gib.gov.tr/',
      'ui-client': 'fe',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ...(options.extraHeaders || {}),
    };
    if (options.cookies && options.cookies.length > 0) {
      headers.Cookie = options.cookies.join('; ');
    }
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json;charset=UTF-8';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        hostname: 'dijital.gib.gov.tr',
        port: 443,
        path: endpointPath,
        method,
        agent: gibHttpsAgent,
        headers,
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          const updatedCookies = mergeSetCookies(options.cookies || [], res.headers['set-cookie']);
          let parsed: any = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
          resolve({
            status: res.statusCode || 500,
            json: parsed,
            raw,
            cookies: updatedCookies,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Dijital Vergi Dairesi bağlantısı zaman aşımına uğradı.'));
    });
    req.on('error', reject);
    if (method === 'POST' && payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function fetchDvCaptcha(cookies: string[]): Promise<{
  ok: boolean;
  captchaId?: string;
  captchaImage?: string;
  cookies: string[];
  error?: string;
}> {
  try {
    const resp = await requestDijitalVd('/apigateway/captcha/getnewcaptcha', {
      method: 'GET',
      cookies,
    });
    const cid = String(resp.json?.cid || resp.json?.captchaId || resp.json?.id || '').trim();
    const rawImg = String(
      resp.json?.captchaImgBase64 || resp.json?.image || resp.json?.img || ''
    ).trim();
    if (cid && rawImg) {
      const captchaImage = rawImg.startsWith('data:')
        ? rawImg
        : `data:image/png;base64,${rawImg}`;
      return { ok: true, captchaId: cid, captchaImage, cookies: resp.cookies };
    }
    return {
      ok: false,
      cookies: resp.cookies,
      error: extractDvErrorMessage(
        resp.json,
        `Dijital Vergi Dairesi güvenlik kodu (CAPTCHA) alınamadı (HTTP ${resp.status}).`
      ),
    };
  } catch (err: any) {
    return {
      ok: false,
      cookies,
      error: `Dijital Vergi Dairesi güvenlik kodu alınamadı: ${err?.message || 'Bağlantı hatası.'}`,
    };
  }
}

let cachedExchangeRates: {
  fetchedAt: number;
  date: string;
  rates: Record<'TRY' | 'USD' | 'EUR' | 'GBP', number>;
} | null = null;

function fetchTcmbRates(): Promise<{
  date: string;
  rates: Record<'TRY' | 'USD' | 'EUR' | 'GBP', number>;
}> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      'https://www.tcmb.gov.tr/kurlar/today.xml',
      {
        timeout: 6000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/xml,text/xml,*/*',
        },
      },
      (res) => {
        let xml = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          xml += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`TCMB HTTP ${res.statusCode}`));
          }
          const extractRate = (code: string): number => {
            const blockMatch = xml.match(
              new RegExp(`<Currency[^>]*CurrencyCode="${code}"[^>]*>([\\s\\S]*?)<\\/Currency>`, 'i')
            );
            if (!blockMatch) return 0;
            const block = blockMatch[1];
            const sellingMatch =
              block.match(/<ForexSelling>([\d.]+)<\/ForexSelling>/i) ||
              block.match(/<BanknoteSelling>([\d.]+)<\/BanknoteSelling>/i);
            return sellingMatch ? Number(sellingMatch[1]) || 0 : 0;
          };
          const usd = extractRate('USD');
          const eur = extractRate('EUR');
          const gbp = extractRate('GBP');
          if (!usd && !eur) {
            return reject(new Error('TCMB kur verisi ayrıştırılamadı.'));
          }
          const dateMatch = xml.match(/Tarih="([^"]+)"/i);
          resolve({
            date: dateMatch?.[1] || new Date().toISOString().slice(0, 10),
            rates: { TRY: 1, USD: usd, EUR: eur, GBP: gbp },
          });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('TCMB kur sorgusu zaman aşımına uğradı.')));
    req.on('error', reject);
  });
}

async function startServer() {
  const app = express();
  app.use('/api', (req, res, next) => {
    const origin = String(req.headers.origin || '');
    if (
      origin &&
      (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin) ||
        /^https:\/\/[a-z0-9-]+\.([a-z0-9-]+\.)?run\.app$/i.test(origin) ||
        /^http:\/\/localhost(:\d+)?$/i.test(origin))
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: 'text/plain', limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'esnaf-earsiv-api' });
  });

  app.get('/api/exchange-rates', async (_req, res) => {
    try {
      const now = Date.now();
      if (cachedExchangeRates && now - cachedExchangeRates.fetchedAt < 15 * 60 * 1000) {
        return res.json({
          ok: true,
          source: 'TCMB',
          date: cachedExchangeRates.date,
          rates: cachedExchangeRates.rates,
        });
      }
      const fresh = await fetchTcmbRates();
      cachedExchangeRates = { fetchedAt: now, ...fresh };
      return res.json({
        ok: true,
        source: 'TCMB',
        date: fresh.date,
        rates: fresh.rates,
      });
    } catch (err: any) {
      if (cachedExchangeRates) {
        return res.json({
          ok: true,
          source: 'TCMB-cache',
          date: cachedExchangeRates.date,
          rates: cachedExchangeRates.rates,
        });
      }
      return res.status(502).json({
        ok: false,
        error: err?.message || 'TCMB kurları alınamadı. Kuru manuel girebilirsiniz.',
      });
    }
  });

  async function executeGibLogin(
    cleanCode: string,
    cleanPass: string,
    profileFallback: any
  ): Promise<{
    status: number;
    body: {
      ok: boolean;
      sessionId?: string;
      mode?: 'live';
      userCode?: string;
      sellerInfo?: GibSession['sellerInfo'];
      error?: string;
    };
  }> {
    if (!cleanCode || !cleanPass) {
      return {
        status: 400,
        body: { ok: false, error: 'GİB kullanıcı kodu ve şifre zorunludur.' },
      };
    }

    const loginResp = await postFormToGib('/assos-login', {
      assoscmd: 'anologin',
      rtype: 'json',
      userid: cleanCode,
      sifre: cleanPass,
      sifre2: cleanPass,
      parola: '1',
    });

    if (!loginResp?.token) {
      const msg = getGibErrorMessage(
        loginResp,
        'GİB e-Arşiv Portal girişi başarısız. Kullanıcı kodu veya şifrenizi kontrol edin.'
      );
      return { status: 401, body: { ok: false, error: msg } };
    }

    const gibToken = String(loginResp.token);
    let sellerInfo = {
      title: String(profileFallback?.title || 'GİB Mükellefi'),
      taxId: String(profileFallback?.taxId || ''),
      taxOffice: String(profileFallback?.taxOffice || ''),
      address: String(profileFallback?.address || ''),
      city: String(profileFallback?.city || ''),
      district: String(profileFallback?.district || ''),
    };

    try {
      const userResp = await gibDispatch(gibToken, 'EARSIV_PORTAL_KULLANICI_BILGILERI_GETIR', 'RG_KULLANICI', {});
      const d = userResp?.data;
      if (d) {
        const fullName = d.unvan || [d.ad, d.soyad].filter(Boolean).join(' ');
        sellerInfo = {
          title: fullName || sellerInfo.title,
          taxId: d.vknTckn || sellerInfo.taxId,
          taxOffice: d.vergiDairesi || sellerInfo.taxOffice,
          address: [d.cadde, d.apartmanAdi, d.kapiNo ? `No:${d.kapiNo}` : ''].filter(Boolean).join(' ') || sellerInfo.address,
          city: d.il || sellerInfo.city,
          district: d.ilce || sellerInfo.district,
        };
      }
    } catch {
      // Fallback to saved business profile if user info endpoint fails
    }

    const sessionId = crypto.randomUUID();
    gibSessions.set(sessionId, {
      id: sessionId,
      mode: 'live',
      userCode: cleanCode,
      gibToken,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      sellerInfo,
    });

    return {
      status: 200,
      body: {
        ok: true,
        sessionId,
        mode: 'live',
        userCode: cleanCode,
        sellerInfo,
      },
    };
  }

  // 1. GİB e-Arşiv Portal Giriş (Canlı Portal)
  app.post('/api/gib/login', async (req, res) => {
    try {
      const { mode, userCode, password, profileFallback, rememberCredentials } = req.body || {};
      if (mode === 'test') {
        return res.status(400).json({
          ok: false,
          error: 'Test modu kaldırılmıştır. Lütfen Canlı GİB e-Arşiv Portal bilgilerinizle giriş yapın.',
        });
      }
      const cleanCode = String(userCode || '').trim();
      const cleanPass = String(password || '').trim();

      const result = await executeGibLogin(cleanCode, cleanPass, profileFallback);
      if (result.body.ok && rememberCredentials) {
        return res.status(result.status).json({
          ...result.body,
          encryptedSecret: encryptGibPassword(cleanPass),
        });
      }
      return res.status(result.status).json(result.body);
    } catch (err: any) {
      return res.status(502).json({
        ok: false,
        error: `GİB Portal bağlantı hatası: ${err?.message || 'Sunucuya ulaşılamadı.'}`,
      });
    }
  });

  // 1b. Kayıtlı Şifreli GİB Bilgileri ile Giriş
  app.post('/api/gib/login-saved', async (req, res) => {
    try {
      const { userCode, encryptedSecret, profileFallback } = req.body || {};
      const cleanCode = String(userCode || '').trim();

      if (!cleanCode || !encryptedSecret) {
        return res.status(400).json({ ok: false, error: 'Kayıtlı GİB bilgisi eksik.' });
      }

      let plainPass = '';
      try {
        plainPass = decryptGibPassword(String(encryptedSecret));
      } catch {
        return res.status(400).json({
          ok: false,
          error: 'Kayıtlı GİB şifresi çözülemedi. Lütfen şifrenizi yeniden girerek kaydedin.',
        });
      }

      const result = await executeGibLogin(cleanCode, plainPass, profileFallback);
      return res.status(result.status).json(result.body);
    } catch (err: any) {
      return res.status(502).json({
        ok: false,
        error: `Kayıtlı GİB giriş hatası: ${err?.message || 'Sunucuya ulaşılamadı.'}`,
      });
    }
  });

  // 1c. GİB Bilgilerini Doğrudan Şifreleyerek Hazırla (Bağlanmadan kaydetme desteği)
  app.post('/api/gib/save-credentials', (req, res) => {
    try {
      const { userCode, password } = req.body || {};
      const cleanCode = String(userCode || '').trim();
      const cleanPass = String(password || '').trim();
      if (!cleanCode || !cleanPass) {
        return res.status(400).json({ ok: false, error: 'GİB kullanıcı kodu ve şifre zorunludur.' });
      }
      return res.json({
        ok: true,
        userCode: cleanCode,
        encryptedSecret: encryptGibPassword(cleanPass),
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        error: err?.message || 'GİB bilgileri şifrelenemedi.',
      });
    }
  });

  // 2. VKN / TCKN ile Alıcı Sorgulama
  app.post('/api/gib/recipient', async (req, res) => {
    try {
      const { sessionId, taxId } = req.body || {};
      const session = gibSessions.get(String(sessionId || ''));
      const cleanTaxId = String(taxId || '').replace(/\D/g, '');

      if (!session) {
        return res.status(401).json({ ok: false, error: 'Aktif GİB oturumu bulunamadı. Lütfen tekrar giriş yapın.' });
      }
      session.lastActivity = Date.now();

      if (cleanTaxId.length !== 10 && cleanTaxId.length !== 11) {
        return res.status(400).json({ ok: false, error: 'Geçerli bir 10 haneli VKN veya 11 haneli TCKN girin.' });
      }

      const resp = await gibDispatch(session.gibToken, 'EARSIV_PORTAL_MERNIS_BILGILERI_GETIR', 'RG_BASITFATURA', {
        vknTcknn: cleanTaxId,
      });

      if (resp?.error) {
        return res.status(400).json({ ok: false, error: getGibErrorMessage(resp, 'VKN/TCKN sorgulanamadı.') });
      }

      const d = resp?.data || {};
      const name = d.unvan || [d.adi, d.soyadi].filter(Boolean).join(' ');
      return res.json({
        ok: true,
        recipient: {
          name: name || '',
          taxOffice: d.vergiDairesi || '',
        },
      });
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: err?.message || 'Alıcı sorgulama hatası.' });
    }
  });

  // 3. Taslak Fatura Oluşturma + SMS Şifre Gönderme
  app.post('/api/gib/create-and-send-sms', async (req, res) => {
    try {
      const { sessionId, invoice } = req.body || {};
      const session = gibSessions.get(String(sessionId || ''));

      if (!session) {
        return res.status(401).json({ ok: false, error: 'Aktif GİB oturumu bulunamadı. Lütfen GİB girişi yapın.' });
      }
      session.lastActivity = Date.now();

      if (!invoice || !Array.isArray(invoice.items) || invoice.items.length === 0) {
        return res.status(400).json({ ok: false, error: 'Faturada en az 1 mal/hizmet kalemi olmalıdır.' });
      }

      // Live GİB e-Arşiv Draft Creation
      const gibDate = formatGibDateFromISO(invoice.invoiceDate);
      const gibTime = normalizeGibTime(invoice.invoiceTime);
      const cleanRecipientTaxId = String(invoice.recipientTaxId || '').replace(/\D/g, '');
      const isPerson = cleanRecipientTaxId.length === 11;
      const nameParts = String(invoice.recipientName || '').trim().split(/\s+/);
      const firstName = isPerson ? nameParts.slice(0, -1).join(' ') || nameParts[0] || '' : '';
      const lastName = isPerson ? (nameParts.length > 1 ? nameParts[nameParts.length - 1] : '.') : '';

      let calcSubtotal = 0;
      let calcVatTotal = 0;

      const malHizmetTable = invoice.items.map((item: any) => {
        const qty = Math.max(0.001, Number(item.quantity) || 1);
        const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
        const vatRate = Math.max(0, Math.round(Number(item.vatRate) || 0));
        const lineSubtotal = Math.round(qty * unitPrice * 100) / 100;
        const lineVat = Math.round(lineSubtotal * (vatRate / 100) * 100) / 100;
        calcSubtotal += lineSubtotal;
        calcVatTotal += lineVat;

        return {
          malHizmet: String(item.name || '').slice(0, 180),
          miktar: qty,
          birim: mapUnitToGibCode(item.unit),
          birimFiyat: unitPrice.toFixed(2),
          fiyat: lineSubtotal.toFixed(2),
          iskontoArttm: 'İskonto',
          iskontoOrani: 0,
          iskontoTutari: '0',
          iskontoNedeni: '',
          malHizmetTutari: lineSubtotal.toFixed(2),
          kdvOrani: String(vatRate),
          vergiOrani: 0,
          kdvTutari: lineVat.toFixed(2),
          vergininKdvTutari: '0',
          ozelMatrahTutari: '0',
          ozelMatrahOrani: 0,
          ozelMatrahVergiTutari: '0',
        };
      });

      const roundedSubtotal = Math.round(calcSubtotal * 100) / 100;
      const roundedVat = Math.round(calcVatTotal * 100) / 100;
      const roundedGrand = Math.round((roundedSubtotal + roundedVat) * 100) / 100;

      // IMPORTANT: Do NOT send faturaUuid for a new draft; GİB assigns the canonical ETTN on creation.
      const invoiceCurrency = ['TRY', 'USD', 'EUR', 'GBP'].includes(String(invoice.currency))
        ? String(invoice.currency)
        : 'TRY';
      const invoiceRate =
        invoiceCurrency === 'TRY'
          ? '0'
          : Number(invoice.exchangeRate || 0) > 0
          ? Number(invoice.exchangeRate).toFixed(4)
          : '1';

      const gibDraftPayload = {
        belgeNumarasi: '',
        faturaTarihi: gibDate,
        saat: gibTime,
        paraBirimi: invoiceCurrency,
        dovzTLkur: invoiceRate,
        faturaTipi: invoice.invoiceType === 'IADE' ? 'IADE' : 'SATIS',
        hangiTip: '5000/30000',
        vknTckn: cleanRecipientTaxId,
        aliciUnvan: isPerson ? '' : String(invoice.recipientName || '').trim(),
        aliciAdi: firstName,
        aliciSoyadi: lastName,
        binaAdi: '',
        binaNo: '',
        kapiNo: '',
        kasabaKoy: '',
        vergiDairesi: String(invoice.recipientTaxOffice || '').trim(),
        ulke: 'Türkiye',
        bulvarcaddesokak: String(invoice.recipientAddress || '').trim(),
        mahalleSemtIlce: String(invoice.recipientDistrict || '').trim(),
        sehir: String(invoice.recipientCity || '').trim(),
        postaKodu: '',
        tel: '',
        fax: '',
        eposta: '',
        websitesi: '',
        iadeTable: [],
        ozelMatrahTutari: '0',
        ozelMatrahOrani: '0',
        ozelMatrahVergiTutari: '0',
        vergiCesidi: ' ',
        malHizmetTable,
        tip: 'İskonto',
        matrah: roundedSubtotal.toFixed(2),
        malhizmetToplamTutari: roundedSubtotal.toFixed(2),
        toplamIskonto: '0',
        hesaplanankdv: roundedVat.toFixed(2),
        vergilerToplami: roundedVat.toFixed(2),
        vergilerDahilToplamTutar: roundedGrand.toFixed(2),
        odenecekTutar: roundedGrand.toFixed(2),
        not: String(invoice.note || '').trim().slice(0, 1000),
        siparisNumarasi: '',
        siparisTarihi: '',
        irsaliyeNumarasi: '',
        irsaliyeTarihi: '',
        fisNo: '',
        fisTarihi: '',
        fisSaati: '',
        fisTipi: ' ',
        zRaporNo: '',
        okcSeriNo: '',
      };

      const createResp = await gibDispatch(
        session.gibToken,
        'EARSIV_PORTAL_FATURA_OLUSTUR',
        'RG_BASITFATURA',
        gibDraftPayload
      );

      const createDataText = typeof createResp?.data === 'string' ? createResp.data : '';
      const createSucceeded =
        !createResp?.error && createDataText.toLowerCase().includes('başarıyla');

      if (!createSucceeded) {
        return res.status(400).json({
          ok: false,
          error: getGibErrorMessage(
            createResp,
            'GİB taslak fatura oluşturulamadı. Fatura ve alıcı bilgilerini kontrol edin.'
          ),
        });
      }

      // Immediately verify the created draft exists in GİB Portal and capture GİB's canonical ETTN
      let draftRows = await fetchGibDraftRows(session.gibToken, gibDate, gibDate);
      if (draftRows.length === 0) {
        const prevDate = formatGibDateFromISO(invoice.invoiceDate, -1);
        const nextDate = formatGibDateFromISO(invoice.invoiceDate, 1);
        draftRows = await fetchGibDraftRows(session.gibToken, prevDate, nextDate);
      }

      const unsignedCandidates = [...draftRows].reverse().filter((row: any) => {
        const st = String(row?.onayDurumu || '').toLowerCase();
        return !st.includes('silin') && st !== 'onaylandı';
      });

      const matchedDraft =
        unsignedCandidates.find(
          (row: any) =>
            String(row?.aliciVknTckn || '').replace(/\D/g, '') === cleanRecipientTaxId &&
            String(row?.belgeTarihi || '') === gibDate
        ) ||
        unsignedCandidates.find(
          (row: any) =>
            String(row?.aliciVknTckn || '').replace(/\D/g, '') === cleanRecipientTaxId
        ) ||
        unsignedCandidates[0];

      const resolvedEttn = String(matchedDraft?.ettn || matchedDraft?.faturaUuid || '').trim();
      if (!matchedDraft || !resolvedEttn) {
        return res.status(400).json({
          ok: false,
          error:
            'GİB taslak yanıtı döndü ancak fatura GİB Düzenlenen Belgeler listesinde doğrulanamadı. SMS gönderimi güvenlik amacıyla durduruldu.',
        });
      }

      // Fetch registered GSM number if needed
      let gsmNo = session.gsmNo;
      if (!gsmNo) {
        const phoneResp = await gibDispatch(session.gibToken, 'EARSIV_PORTAL_TELEFONNO_SORGULA', 'RG_BASITTASLAKLAR', {});
        gsmNo = phoneResp?.data?.telefon || '';
        session.gsmNo = gsmNo;
      }

      const smsResp = await gibDispatch(session.gibToken, 'EARSIV_PORTAL_SMSSIFRE_GONDER', 'RG_SMSONAY', {
        CEPTEL: gsmNo || '',
        KCEPTEL: false,
        TIP: '',
      });

      const oid = smsResp?.data?.oid;
      if (!oid) {
        return res.status(400).json({
          ok: false,
          error: getGibErrorMessage(smsResp, 'GİB SMS onay kodu gönderilemedi.'),
        });
      }

      session.pendingSms = {
        oid: String(oid),
        ettn: resolvedEttn,
        draftRow: matchedDraft,
        expiresAt: Date.now() + 3 * 60 * 1000,
      };

      return res.json({
        ok: true,
        mode: 'live',
        ettn: resolvedEttn,
        draftInvoiceNo:
          String(matchedDraft.belgeNumarasi || '').trim() ||
          `TASLAK-${resolvedEttn.slice(0, 8).toUpperCase()}`,
        oid: String(oid),
        maskedPhone: gsmNo ? `${gsmNo.slice(0, 4)}***${gsmNo.slice(-2)}` : 'Kayıtlı Cep Telefonunuz',
      });
    } catch (err: any) {
      return res.status(502).json({
        ok: false,
        error: `GİB taslak/SMS işlemi başarısız: ${err?.message || 'Bağlantı hatası.'}`,
      });
    }
  });

  // 4. SMS Doğrulama ve Fatura Onaylama
  app.post('/api/gib/verify-sms', async (req, res) => {
    try {
      const { sessionId, oid, code, ettn, invoiceDate } = req.body || {};
      const session = gibSessions.get(String(sessionId || ''));

      if (!session) {
        return res.status(401).json({ ok: false, error: 'Aktif GİB oturumu bulunamadı.' });
      }
      session.lastActivity = Date.now();

      const cleanCode = String(code || '').trim();
      if (cleanCode.length < 4) {
        return res.status(400).json({ ok: false, error: 'Lütfen telefonunuza gelen SMS onay kodunu girin.' });
      }

      // Live GİB SMS Verification
      const gibDate = formatGibDateFromISO(invoiceDate);
      const targetEttn = String(ettn || session.pendingSms?.ettn || '').trim();
      if (!targetEttn) {
        return res.status(400).json({ ok: false, error: 'Onaylanacak faturanın ETTN bilgisi bulunamadı.' });
      }

      let draftItem: Record<string, unknown> | null =
        session.pendingSms?.draftRow &&
        String(session.pendingSms.draftRow.ettn || session.pendingSms.draftRow.faturaUuid || '').toLowerCase() ===
          targetEttn.toLowerCase()
          ? {
              ...session.pendingSms.draftRow,
              belgeTuru: session.pendingSms.draftRow.belgeTuru || 'FATURA',
              ettn: targetEttn,
            }
          : null;

      if (!draftItem) {
        let rows = await fetchGibDraftRows(session.gibToken, gibDate, gibDate);
        if (rows.length === 0) {
          rows = await fetchGibDraftRows(
            session.gibToken,
            formatGibDateFromISO(invoiceDate, -1),
            formatGibDateFromISO(invoiceDate, 1)
          );
        }
        const matched = rows.find(
          (row: any) =>
            String(row?.ettn || row?.faturaUuid || '').toLowerCase() === targetEttn.toLowerCase()
        );
        if (matched) {
          draftItem = {
            ...matched,
            belgeTuru: matched.belgeTuru || 'FATURA',
            ettn: String(matched.ettn || matched.faturaUuid || targetEttn),
          };
        }
      }

      if (!draftItem) {
        return res.status(400).json({
          ok: false,
          error:
            'Onaylanacak taslak fatura GİB Düzenlenen Belgeler listesinde bulunamadı. Lütfen faturayı yeniden oluşturun.',
        });
      }

      const verifyResp = await gibDispatch(session.gibToken, '0lhozfib5410mp', 'RG_SMSONAY', {
        SIFRE: cleanCode,
        OID: String(oid || session.pendingSms?.oid || ''),
        OPR: 1,
        DATA: [draftItem],
      });

      const sonuc = verifyResp?.data?.sonuc;
      if (verifyResp?.error || String(sonuc) !== '1') {
        const remoteMsg = getGibErrorMessage(
          verifyResp,
          'SMS kodu doğrulanamadı veya GİB faturayı onaylamadı. Kodu kontrol edip tekrar deneyin.'
        );
        return res.status(400).json({
          ok: false,
          error: remoteMsg,
        });
      }

      // Confirm invoice status & fetch official GİB invoice number from Düzenlenen Belgeler
      let officialInvoiceNo = String(verifyResp?.data?.belgeNumarasi || '').trim();
      let updatedRows = await fetchGibDraftRows(session.gibToken, gibDate, gibDate);
      if (updatedRows.length === 0) {
        updatedRows = await fetchGibDraftRows(
          session.gibToken,
          formatGibDateFromISO(invoiceDate, -1),
          formatGibDateFromISO(invoiceDate, 1)
        );
      }

      const approvedRow = updatedRows.find(
        (row: any) =>
          String(row?.ettn || row?.faturaUuid || '').toLowerCase() === targetEttn.toLowerCase()
      );

      if (approvedRow) {
        if (String(approvedRow.onayDurumu || '').toLowerCase() === 'onaylanmadı') {
          return res.status(400).json({
            ok: false,
            error:
              'SMS yanıtı alındı ancak fatura GİB Portalda hâlâ Onaylanmadı görünüyor. Lütfen GİB Portal > Düzenlenen Belgeler ekranını kontrol edin.',
          });
        }
        if (approvedRow.belgeNumarasi) {
          officialInvoiceNo = String(approvedRow.belgeNumarasi).trim();
        }
      }

      if (!officialInvoiceNo) {
        officialInvoiceNo = `GIB-${targetEttn.slice(0, 8).toUpperCase()}`;
      }

      session.pendingSms = undefined;
      return res.json({
        ok: true,
        mode: 'live',
        invoiceNo: officialInvoiceNo,
        ettn: targetEttn,
        approvedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(502).json({
        ok: false,
        error: `SMS doğrulama hatası: ${err?.message || 'Sunucu yanıt vermedi.'}`,
      });
    }
  });

  // 4b. Onaylı/Taslak Faturanın GİB Portal Orijinal HTML Görünümünü Getirme
  app.post('/api/gib/invoice-html', async (req, res) => {
    try {
      const { sessionId, ettn, status } = req.body || {};
      const session = gibSessions.get(String(sessionId || ''));
      if (!session) {
        return res.status(401).json({ ok: false, error: 'Aktif GİB oturumu bulunamadı.' });
      }
      session.lastActivity = Date.now();
      const cleanEttn = String(ettn || '').trim();
      if (!cleanEttn) {
        return res.status(400).json({ ok: false, error: 'Fatura ETTN bilgisi zorunludur.' });
      }

      const onayDurumu = status === 'approved' ? 'Onaylandı' : 'Onaylanmadı';
      const resp = await gibDispatch(session.gibToken, 'EARSIV_PORTAL_FATURA_GOSTER', 'RG_TASLAKLAR', {
        ettn: cleanEttn,
        onayDurumu,
      });

      if (resp?.error || typeof resp?.data !== 'string' || !resp.data.trim()) {
        return res.status(400).json({
          ok: false,
          error: getGibErrorMessage(resp, 'GİB Portal üzerinden fatura görünümü alınamadı.'),
        });
      }

      let html = resp.data;
      if (/<head[^>]*>/i.test(html) && !/<base\b/i.test(html)) {
        html = html.replace(
          /<head([^>]*)>/i,
          '<head$1><base href="https://earsivportal.efatura.gov.tr/">'
        );
      }

      return res.json({ ok: true, html });
    } catch (err: any) {
      return res.status(502).json({
        ok: false,
        error: `GİB belge alma hatası: ${err?.message || 'Sunucu yanıt vermedi.'}`,
      });
    }
  });

  // 5. GİB Oturumunu Güvenli Kapatma (Oturum Çakışmasını Önler)
  app.post('/api/gib/logout', async (req, res) => {
    try {
      let parsedBody = req.body;
      if (typeof parsedBody === 'string') {
        try {
          parsedBody = JSON.parse(parsedBody);
        } catch {
          parsedBody = {};
        }
      }
      const { sessionId } = parsedBody || {};
      const session = gibSessions.get(String(sessionId || ''));
      if (session) {
        if (session.gibToken) {
          try {
            await postFormToGib('/assos-login', {
              assoscmd: 'logout',
              rtype: 'json',
              token: session.gibToken,
            });
          } catch {
            // Ignore remote logout errors while clearing local session
          }
        }
        gibSessions.delete(session.id);
      }
      return res.json({ ok: true });
    } catch {
      return res.json({ ok: true });
    }
  });

  // 6. Alınan e-Arşiv Faturalar (Adımıza Düzenlenen Belgeler)
  app.post('/api/gib/received-invoices', async (req, res) => {
    try {
      const { sessionId, startDate, endDate } = req.body || {};
      const session = gibSessions.get(String(sessionId || ''));
      if (!session) {
        return res.status(401).json({
          ok: false,
          error: 'Aktif GİB oturumu bulunamadı. Lütfen önce GİB e-Arşiv Portalına bağlanın.',
        });
      }
      session.lastActivity = Date.now();

      const startGibSlash = startDate
        ? formatGibDateFromISO(String(startDate))
        : formatGibDateFromISO(undefined, -30);
      const endGibSlash = endDate
        ? formatGibDateFromISO(String(endDate))
        : formatGibDateFromISO(undefined, 0);
      const startGibDot = startGibSlash.replace(/\//g, '.');
      const endGibDot = endGibSlash.replace(/\//g, '.');

      const attempts: Array<{ page: string; jp: Record<string, unknown> }> = [
        {
          page: 'RG_ALICI_TASLAKLAR',
          jp: {
            baslangic: startGibSlash,
            bitis: endGibSlash,
            hangiTip: '5000/30000',
            table: [],
          },
        },
        {
          page: 'RG_ADIMA_KESILEN_BELGELER',
          jp: {
            baslangic: startGibSlash,
            bitis: endGibSlash,
          },
        },
        {
          page: 'RG_ALICI_TASLAKLAR',
          jp: {
            baslangic: startGibDot,
            bitis: endGibDot,
            hangiTip: '5000/30000',
            table: [],
          },
        },
      ];

      let rawRows: any[] | null = null;
      let lastResp: any = null;

      for (const attempt of attempts) {
        try {
          const resp = await gibDispatch(
            session.gibToken,
            'EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR',
            attempt.page,
            attempt.jp
          );
          lastResp = resp;
          if (Array.isArray(resp?.data)) {
            rawRows = resp.data;
            break;
          }
        } catch {
          // Try next format/pageName
        }
      }

      if (!rawRows) {
        return res.status(400).json({
          ok: false,
          error: getGibErrorMessage(
            lastResp,
            'GİB üzerinden adınıza kesilen e-Arşiv fatura listesi alınamadı.'
          ),
        });
      }

      const items = rawRows
        .map((row: any) => {
          const ettn = String(row?.ettn || row?.faturaUuid || '').trim();
          if (!ettn) return null;
          const invoiceNo =
            String(row?.belgeNumarasi || row?.faturaNo || '').trim() ||
            ettn.slice(0, 16).toUpperCase();
          const invoiceDate = parseGibDateToIso(row?.belgeTarihi || row?.faturaTarihi);
          const sellerName =
            String(
              row?.saticiUnvan ||
                row?.saticiAdiSoyadi ||
                row?.aliciUnvan ||
                row?.aliciAdiSoyadi ||
                'Satıcı Mükellef'
            ).trim() || 'Satıcı Mükellef';
          const sellerTaxId = String(
            row?.saticiVknTckn || row?.vknTckn || row?.aliciVknTckn || ''
          )
            .replace(/\D/g, '')
            .slice(0, 11);

          const rawCurr = String(row?.paraBirimi || 'TRY').toUpperCase();
          const currency = ['TRY', 'USD', 'EUR', 'GBP'].includes(rawCurr) ? rawCurr : 'TRY';
          const exchangeRate =
            currency === 'TRY' ? 1 : Math.max(0.0001, parseGibTrNumber(row?.dovizKuru || 1));

          const grandTotal = parseGibTrNumber(
            row?.vergilerDahilToplamTutar ??
              row?.odenecekTutar ??
              row?.toplamTutar ??
              row?.malHizmetToplamTutari
          );
          const vatTotal = parseGibTrNumber(row?.hesaplananKdv ?? row?.kdvTutari ?? 0);
          let subtotal = parseGibTrNumber(row?.malHizmetToplamTutari ?? row?.matrah ?? 0);
          if (subtotal <= 0 && grandTotal > 0) {
            subtotal = Math.max(0, Math.round((grandTotal - vatTotal) * 100) / 100);
          }

          return {
            ettn,
            invoiceNo,
            invoiceDate,
            invoiceType: String(row?.belgeTuru || row?.faturaTipi || 'SATIS').trim() || 'SATIS',
            sellerName,
            sellerTaxId,
            currency,
            exchangeRate,
            subtotal,
            vatTotal,
            grandTotal,
            approvalStatus: String(row?.onayDurumu || 'Onaylandı').trim() || 'Onaylandı',
          };
        })
        .filter(Boolean);

      return res.json({ ok: true, items });
    } catch (err: any) {
      return res.status(502).json({
        ok: false,
        error: `Alınan e-Arşiv faturalar alınamadı: ${err?.message || 'Bağlantı hatası.'}`,
      });
    }
  });

  // 6b. Alınan e-Arşiv Fatura Resmi HTML Görünümü
  app.post('/api/gib/received-invoice-html', async (req, res) => {
    try {
      const { sessionId, ettn, onayDurumu } = req.body || {};
      const session = gibSessions.get(String(sessionId || ''));
      if (!session) {
        return res.status(401).json({ ok: false, error: 'Aktif GİB oturumu bulunamadı.' });
      }
      session.lastActivity = Date.now();
      const cleanEttn = String(ettn || '').trim();
      if (!cleanEttn) {
        return res.status(400).json({ ok: false, error: 'Fatura ETTN bilgisi zorunludur.' });
      }

      const targetStatus = String(onayDurumu || 'Onaylandı').trim() || 'Onaylandı';
      let resp = await gibDispatch(
        session.gibToken,
        'EARSIV_PORTAL_FATURA_GOSTER',
        'RG_ALICI_TASLAKLAR',
        { ettn: cleanEttn, onayDurumu: targetStatus }
      );

      if (resp?.error || typeof resp?.data !== 'string' || !resp.data.trim()) {
        resp = await gibDispatch(
          session.gibToken,
          'EARSIV_PORTAL_FATURA_GOSTER',
          'RG_TASLAKLAR',
          { ettn: cleanEttn, onayDurumu: targetStatus }
        );
      }

      if (resp?.error || typeof resp?.data !== 'string' || !resp.data.trim()) {
        return res.status(400).json({
          ok: false,
          error: getGibErrorMessage(resp, 'GİB Portal üzerinden alınan fatura görünümü getirilemedi.'),
        });
      }

      let html = resp.data;
      if (/<head[^>]*>/i.test(html) && !/<base\b/i.test(html)) {
        html = html.replace(
          /<head([^>]*)>/i,
          '<head$1><base href="https://earsivportal.efatura.gov.tr/">'
        );
      }

      return res.json({ ok: true, html });
    } catch (err: any) {
      return res.status(502).json({
        ok: false,
        error: `Alınan fatura görünümü alınamadı: ${err?.message || 'Sunucu yanıt vermedi.'}`,
      });
    }
  });

  // 7. Dijital Vergi Dairesi (dijital.gib.gov.tr) e-Tebligat Giriş Başlatma
  app.post('/api/dv/start-login', async (req, res) => {
    try {
      const { userCode, encryptedSecret, password } = req.body || {};
      const cleanCode = String(userCode || '').trim();
      let plainPass = String(password || '').trim();

      if (!plainPass && encryptedSecret) {
        try {
          plainPass = decryptGibPassword(String(encryptedSecret));
        } catch {
          return res.status(400).json({
            ok: false,
            requiresCredentials: true,
            error: 'Kayıtlı GİB şifresi çözülemedi. Lütfen şifrenizi manuel girin.',
          });
        }
      }

      if (!cleanCode || !plainPass) {
        return res.status(200).json({
          ok: false,
          requiresCredentials: true,
          error: 'Dijital Vergi Dairesi bağlantısı için kullanıcı kodu ve şifrenizi girin.',
        });
      }

      const captchaResult = await fetchDvCaptcha([]);
      if (captchaResult.ok && captchaResult.captchaId && captchaResult.captchaImage) {
        const dvSessionId = crypto.randomUUID();
        dvSessions.set(dvSessionId, {
          id: dvSessionId,
          userCode: cleanCode,
          cookies: captchaResult.cookies,
          captchaId: captchaResult.captchaId,
          createdAt: Date.now(),
          lastActivity: Date.now(),
        });

        return res.json({
          ok: false,
          requiresCaptcha: true,
          dvSessionId,
          captchaImage: captchaResult.captchaImage,
        });
      }

      return res.json({
        ok: false,
        portalUnavailable: true,
        error:
          captchaResult.error ||
          'Dijital Vergi Dairesi (dijital.gib.gov.tr) bot/CAPTCHA doğrulaması uzaktan bağlantıya yanıt vermedi.',
      });
    } catch (err: any) {
      return res.status(200).json({
        ok: false,
        portalUnavailable: true,
        error: `Dijital Vergi Dairesi erişim hatası: ${err?.message || 'Sunucuya ulaşılamadı.'}`,
      });
    }
  });

  // 7b. Dijital Vergi Dairesi CAPTCHA & Şifre ile Oturum Tamamlama
  app.post('/api/dv/complete-login', async (req, res) => {
    try {
      const { dvSessionId, userCode, encryptedSecret, password, captchaCode } = req.body || {};
      const dvSession = dvSessions.get(String(dvSessionId || ''));
      if (!dvSession) {
        return res.status(200).json({
          ok: false,
          sessionExpired: true,
          error: 'Dijital Vergi Dairesi doğrulama oturumu zaman aşımına uğradı. Lütfen tekrar deneyin.',
        });
      }
      dvSession.lastActivity = Date.now();

      const cleanCode = String(userCode || dvSession.userCode || '').trim();
      let plainPass = String(password || '').trim();
      if (!plainPass && encryptedSecret) {
        try {
          plainPass = decryptGibPassword(String(encryptedSecret));
        } catch {
          return res.status(200).json({
            ok: false,
            requiresCredentials: true,
            error: 'Kayıtlı şifre çözülemedi. Lütfen şifrenizi girin.',
          });
        }
      }

      const cleanCaptcha = String(captchaCode || '').trim();
      if (!cleanCode || !plainPass) {
        return res.status(200).json({
          ok: false,
          requiresCredentials: true,
          error: 'Kullanıcı kodu ve şifre zorunludur.',
        });
      }
      if (!cleanCaptcha) {
        return res.status(200).json({
          ok: false,
          requiresCaptcha: true,
          dvSessionId: dvSession.id,
          error: 'Lütfen görseldeki güvenlik kodunu (CAPTCHA) girin.',
        });
      }

      dvSession.userCode = cleanCode;
      const loginResp = await requestDijitalVd('/apigateway/auth/tdvd/login', {
        method: 'POST',
        cookies: dvSession.cookies,
        extraHeaders: {
          'page-name': 'Login',
        },
        body: {
          userid: cleanCode,
          sifre: plainPass,
          dk: cleanCaptcha,
          imageId: dvSession.captchaId || '',
        },
      });

      dvSession.cookies = loginResp.cookies;
      const dvToken = String(
        loginResp.json?.token ||
          loginResp.json?.accessToken ||
          loginResp.json?.data?.token ||
          ''
      ).trim();

      if (!dvToken) {
        const remoteErr = extractDvErrorMessage(
          loginResp.json,
          `Dijital Vergi Dairesi girişi doğrulanamadı (HTTP ${loginResp.status}).`
        );
        const lowerErr = remoteErr.toLowerCase();
        const isCredError =
          lowerErr.includes('şifre') ||
          lowerErr.includes('parola') ||
          lowerErr.includes('kullanıcı') ||
          lowerErr.includes('hatalı');

        const nextCaptcha = await fetchDvCaptcha(dvSession.cookies);
        if (nextCaptcha.ok && nextCaptcha.captchaId && nextCaptcha.captchaImage) {
          dvSession.captchaId = nextCaptcha.captchaId;
          dvSession.cookies = nextCaptcha.cookies;
          return res.json({
            ok: false,
            requiresCredentials: isCredError,
            requiresCaptcha: true,
            dvSessionId: dvSession.id,
            captchaImage: nextCaptcha.captchaImage,
            error: remoteErr,
          });
        }

        return res.json({
          ok: false,
          requiresCredentials: isCredError,
          portalUnavailable: !isCredError,
          error: remoteErr,
        });
      }

      dvSession.dvToken = dvToken;
      return res.json({
        ok: true,
        dvSessionId: dvSession.id,
        userCode: dvSession.userCode,
      });
    } catch (err: any) {
      return res.status(200).json({
        ok: false,
        portalUnavailable: true,
        error: `Dijital Vergi Dairesi giriş hatası: ${err?.message || 'Bağlantı kurulamadı.'}`,
      });
    }
  });

  // 7c. Dijital Vergi Dairesi e-Tebligat Listesi Çekme
  app.post('/api/dv/etebligat', async (req, res) => {
    try {
      const { dvSessionId } = req.body || {};
      const dvSession = dvSessions.get(String(dvSessionId || ''));
      if (!dvSession || !dvSession.dvToken) {
        return res.status(200).json({
          ok: false,
          sessionExpired: true,
          error: 'Aktif Dijital Vergi Dairesi oturumu bulunamadı. Lütfen yeniden doğrulama yapın.',
        });
      }
      dvSession.lastActivity = Date.now();

      const tryFetch = async (filters: Array<Record<string, unknown>>) => {
        return requestDijitalVd('/apigateway/etebligat/etebligat/tebligat-listele', {
          method: 'POST',
          cookies: dvSession.cookies,
          token: dvSession.dvToken,
          extraHeaders: {
            'page-name': 'Tebligatlar',
          },
          body: {
            meta: {
              pagination: { pageNo: 1, pageSize: 50 },
              filters,
            },
          },
        });
      };

      let resp = await tryFetch([{ fieldName: 'arsivDurum', values: ['0'] }]);
      dvSession.cookies = resp.cookies;

      if (resp.status === 401) {
        dvSessions.delete(dvSession.id);
        return res.json({
          ok: false,
          sessionExpired: true,
          error: extractDvErrorMessage(
            resp.json,
            'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.'
          ),
        });
      }

      let rawList: any[] | null =
        (Array.isArray(resp.json?.data?.tebligatDtoList) && resp.json.data.tebligatDtoList) ||
        (Array.isArray(resp.json?.tebligatDtoList) && resp.json.tebligatDtoList) ||
        (Array.isArray(resp.json?.data?.content) && resp.json.data.content) ||
        (Array.isArray(resp.json?.data) && resp.json.data) ||
        null;

      if (!rawList) {
        const hasExplicitError =
          Array.isArray(resp.json?.messages) &&
          resp.json.messages.some((m: any) => m?.type === 'ERROR');
        if (!hasExplicitError) {
          resp = await tryFetch([]);
          dvSession.cookies = resp.cookies;
          rawList =
            (Array.isArray(resp.json?.data?.tebligatDtoList) && resp.json.data.tebligatDtoList) ||
            (Array.isArray(resp.json?.tebligatDtoList) && resp.json.tebligatDtoList) ||
            (Array.isArray(resp.json?.data?.content) && resp.json.data.content) ||
            (Array.isArray(resp.json?.data) && resp.json.data) ||
            null;
        }
      }

      if (!rawList) {
        const remoteErr = extractDvErrorMessage(
          resp.json,
          `Dijital Vergi Dairesi e-Tebligat servisinden liste alınamadı (HTTP ${resp.status}).`
        );
        // Many taxpayers have no activation or empty data null without error
        if (resp.status >= 200 && resp.status < 300 && resp.json?.data && resp.json.data.count === 0) {
          rawList = [];
        } else {
          return res.json({
            ok: false,
            portalUnavailable: resp.status >= 500,
            error: remoteErr,
          });
        }
      }

      if (!dvSession.etebligatRows) {
        dvSession.etebligatRows = new Map();
      }

      const items = rawList
        .map((row: any) => {
          const tarafId = String(row?.tarafId || '').trim();
          const tarafSecureId = String(row?.tarafSecureId || '').trim();
          const tebligId = String(row?.tebligId || '').trim();
          const tebligSecureId = String(row?.tebligSecureId || '').trim();
          const tebligatId = String(
            tarafId ||
              tebligId ||
              tarafSecureId ||
              tebligSecureId ||
              row?.tebligatId ||
              row?.belgeNo ||
              row?.id ||
              ''
          ).trim();
          if (!tebligatId) return null;

          const docNo = String(row?.belgeNo || row?.evrakNo || '').trim();
          if (tarafId && tarafSecureId && tebligId && tebligSecureId) {
            const lookup: DvETebligatLookup = {
              tarafId,
              tarafSecureId,
              tebligId,
              tebligSecureId,
              documentNo: docNo,
            };
            dvSession.etebligatRows!.set(tebligatId, lookup);
            if (docNo) dvSession.etebligatRows!.set(`doc:${docNo}`, lookup);
          }

          const sentDate = parseGibDateToIso(
            row?.gonderimZamani || row?.gonderimTarihi || row?.olusturmaTarihi || row?.tebligZamani
          );
          const legalServedDate = row?.tebligZamani
            ? parseGibDateToIso(row.tebligZamani)
            : row?.yasalTebligTarihi
            ? parseGibDateToIso(row.yasalTebligTarihi)
            : addDaysToIso(sentDate, 5);

          const senderParts = [
            row?.kurumAciklama || row?.birimAdi || row?.gonderenBirim || row?.vergiDairesi,
            row?.altKurum,
          ]
            .map((v) => String(v || '').trim())
            .filter(Boolean);

          const readTimeRaw = row?.mukellefOkumaZamani || row?.okunmaTarihi || '';
          const isRead = Boolean(readTimeRaw || row?.okundu || row?.okunduMu);

          return {
            tebligatId,
            tarafId: tarafId || undefined,
            tarafSecureId: tarafSecureId || undefined,
            tebligId: tebligId || undefined,
            tebligSecureId: tebligSecureId || undefined,
            subject:
              String(
                row?.belgeTuruAciklama || row?.konu || row?.tebligatKonusu || row?.belgeTuru || ''
              ).trim() || 'e-Tebligat',
            senderUnit: senderParts.join(' · ') || 'Gelir İdaresi Başkanlığı',
            documentNo: docNo,
            sentDate,
            legalServedDate,
            isRead,
            readAt: readTimeRaw ? String(readTimeRaw).trim() : '',
            portalUrl: 'https://dijital.gib.gov.tr',
          };
        })
        .filter(Boolean);

      return res.json({ ok: true, items });
    } catch (err: any) {
      return res.status(200).json({
        ok: false,
        portalUnavailable: true,
        error: `e-Tebligat sorgulama hatası: ${err?.message || 'Sunucuya ulaşılamadı.'}`,
      });
    }
  });

  // 7c-2. Dijital Vergi Dairesi e-Tebligat PDF İçeriğini ve Eklerini Getir
  app.post('/api/dv/etebligat-content', async (req, res) => {
    try {
      const {
        dvSessionId,
        tebligatId,
        documentNo,
        tarafId: reqTarafId,
        tarafSecureId: reqTarafSecureId,
        tebligId: reqTebligId,
        tebligSecureId: reqTebligSecureId,
      } = req.body || {};

      const dvSession = dvSessions.get(String(dvSessionId || ''));
      if (!dvSession || !dvSession.dvToken) {
        return res.status(200).json({
          ok: false,
          sessionExpired: true,
          error: 'Aktif Dijital Vergi Dairesi oturumu bulunamadı. Lütfen doğrulama yapın.',
        });
      }
      dvSession.lastActivity = Date.now();

      let tarafId = String(reqTarafId || '').trim();
      let tarafSecureId = String(reqTarafSecureId || '').trim();
      let tebligId = String(reqTebligId || '').trim();
      let tebligSecureId = String(reqTebligSecureId || '').trim();

      if (!tarafId || !tarafSecureId || !tebligId || !tebligSecureId) {
        const cached =
          dvSession.etebligatRows?.get(String(tebligatId || '').trim()) ||
          (documentNo ? dvSession.etebligatRows?.get(`doc:${String(documentNo).trim()}`) : undefined);
        if (cached) {
          tarafId = tarafId || cached.tarafId;
          tarafSecureId = tarafSecureId || cached.tarafSecureId;
          tebligId = tebligId || cached.tebligId;
          tebligSecureId = tebligSecureId || cached.tebligSecureId;
        }
      }

      // Fallback: re-fetch list from Dijital VD to resolve IDs for previously saved records
      if (!tarafId || !tarafSecureId || !tebligId || !tebligSecureId) {
        for (const filters of [[{ fieldName: 'arsivDurum', values: ['0'] }], []]) {
          const listResp = await requestDijitalVd('/apigateway/etebligat/etebligat/tebligat-listele', {
            method: 'POST',
            cookies: dvSession.cookies,
            token: dvSession.dvToken,
            extraHeaders: { 'page-name': 'Tebligatlar' },
            body: {
              meta: {
                pagination: { pageNo: 1, pageSize: 100 },
                filters,
              },
            },
          });
          dvSession.cookies = listResp.cookies;
          if (listResp.status === 401) {
            dvSessions.delete(dvSession.id);
            return res.json({
              ok: false,
              sessionExpired: true,
              error: 'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.',
            });
          }
          const rows: any[] =
            (Array.isArray(listResp.json?.data?.tebligatDtoList) && listResp.json.data.tebligatDtoList) ||
            (Array.isArray(listResp.json?.tebligatDtoList) && listResp.json.tebligatDtoList) ||
            (Array.isArray(listResp.json?.data?.content) && listResp.json.data.content) ||
            (Array.isArray(listResp.json?.data) && listResp.json.data) ||
            [];
          if (!dvSession.etebligatRows) dvSession.etebligatRows = new Map();
          for (const row of rows) {
            const rTarafId = String(row?.tarafId || '').trim();
            const rTarafSec = String(row?.tarafSecureId || '').trim();
            const rTebligId = String(row?.tebligId || '').trim();
            const rTebligSec = String(row?.tebligSecureId || '').trim();
            const rDocNo = String(row?.belgeNo || row?.evrakNo || '').trim();
            const key = String(rTarafId || rTebligId || rTarafSec || rTebligSec || rDocNo).trim();
            if (rTarafId && rTarafSec && rTebligId && rTebligSec) {
              const lookup: DvETebligatLookup = {
                tarafId: rTarafId,
                tarafSecureId: rTarafSec,
                tebligId: rTebligId,
                tebligSecureId: rTebligSec,
                documentNo: rDocNo,
              };
              dvSession.etebligatRows.set(key, lookup);
              if (rDocNo) dvSession.etebligatRows.set(`doc:${rDocNo}`, lookup);
            }
          }
          const matched =
            dvSession.etebligatRows.get(String(tebligatId || '').trim()) ||
            (documentNo ? dvSession.etebligatRows.get(`doc:${String(documentNo).trim()}`) : undefined);
          if (matched) {
            tarafId = matched.tarafId;
            tarafSecureId = matched.tarafSecureId;
            tebligId = matched.tebligId;
            tebligSecureId = matched.tebligSecureId;
            break;
          }
          if (rows.length > 0) break;
        }
      }

      if (!tarafId || !tarafSecureId || !tebligId || !tebligSecureId) {
        return res.json({
          ok: false,
          error:
            'Bu tebligatın Dijital Vergi Dairesi anahtar bilgileri (taraf/tebliğ ID) bulunamadı. Önce “Tebligatları Sorgula” ile listeyi güncelleyin.',
        });
      }

      // Step 1: Zarf detayını aç (okunmamışsa GİB tarafında okundu olarak işler)
      const detayResp = await requestDijitalVd('/apigateway/etebligat/etebligat/zarf-detay-sorgula', {
        method: 'POST',
        cookies: dvSession.cookies,
        token: dvSession.dvToken,
        extraHeaders: { 'page-name': 'TebligatDetay' },
        body: {
          tarafId,
          tarafSecureId,
        },
      });
      dvSession.cookies = detayResp.cookies;
      if (detayResp.status === 401) {
        dvSessions.delete(dvSession.id);
        return res.json({
          ok: false,
          sessionExpired: true,
          error: 'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.',
        });
      }

      const zarfData = detayResp.json?.data || detayResp.json || {};
      const effTebligId = String(zarfData?.tebligId || tebligId).trim();
      const effTebligSecureId = String(zarfData?.tebligSecureId || tebligSecureId).trim();

      // Step 2: Ana belge ve ek listesini getir
      const belgeEkResp = await requestDijitalVd('/apigateway/etebligat/etebligat/belge-ek-listele', {
        method: 'POST',
        cookies: dvSession.cookies,
        token: dvSession.dvToken,
        extraHeaders: { 'page-name': 'TebligatDetay' },
        body: {
          tebligId: effTebligId,
          tebligSecureId: effTebligSecureId,
        },
      });
      dvSession.cookies = belgeEkResp.cookies;
      if (belgeEkResp.status === 401) {
        dvSessions.delete(dvSession.id);
        return res.json({
          ok: false,
          sessionExpired: true,
          error: 'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.',
        });
      }

      const tebligBelge =
        belgeEkResp.json?.tebligBelge || belgeEkResp.json?.data?.tebligBelge || null;
      const eklerRaw: any[] =
        (Array.isArray(belgeEkResp.json?.ekler) && belgeEkResp.json.ekler) ||
        (Array.isArray(belgeEkResp.json?.data?.ekler) && belgeEkResp.json.data.ekler) ||
        [];

      if (!tebligBelge || !tebligBelge.id) {
        return res.json({
          ok: false,
          error: extractDvErrorMessage(
            belgeEkResp.json,
            'e-Tebligat ana PDF belgesi Dijital Vergi Dairesinden alınamadı.'
          ),
        });
      }

      // Step 3: Ana tebligat PDF'ini getir
      const belgeGetirResp = await requestDijitalVdRaw('/apigateway/etebligat/etebligat/belge-getir', {
        method: 'POST',
        cookies: dvSession.cookies,
        token: dvSession.dvToken,
        extraHeaders: { 'page-name': 'TebligatDetay' },
        body: {
          data: {
            id: tebligBelge.id,
            secureId: tebligBelge.secureId,
            belgeTip: tebligBelge.belgeTip,
            tarafId,
            tarafSecureId,
            uzanti: tebligBelge.uzanti || 'pdf',
            belgeAdi: tebligBelge.adi || 'tebligat',
          },
        },
      });
      dvSession.cookies = belgeGetirResp.cookies;
      if (belgeGetirResp.status === 401) {
        dvSessions.delete(dvSession.id);
        return res.json({
          ok: false,
          sessionExpired: true,
          error: 'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.',
        });
      }

      let pdfBuffer: Buffer | null = null;
      let mimeType = guessMimeFromExtension(tebligBelge.uzanti || 'pdf');

      const directUnwrapped =
        belgeGetirResp.buffer.length >= 16 && !belgeGetirResp.json
          ? unwrapPdfBufferIfWrapped(belgeGetirResp.buffer)
          : null;

      if (directUnwrapped?.isPdf) {
        pdfBuffer = directUnwrapped.buffer;
        mimeType = 'application/pdf';
      } else if (
        belgeGetirResp.buffer.length >= 16 &&
        !belgeGetirResp.json &&
        !belgeGetirResp.contentType.includes('json') &&
        !belgeGetirResp.contentType.includes('html')
      ) {
        pdfBuffer = belgeGetirResp.buffer;
      } else {
        const reportLink = String(
          belgeGetirResp.json?.reportLink ||
            belgeGetirResp.json?.data?.reportLink ||
            belgeGetirResp.json?.pdf ||
            belgeGetirResp.json?.data?.pdf ||
            belgeGetirResp.json?.file ||
            ''
        ).trim();

        if (!reportLink) {
          return res.json({
            ok: false,
            error: extractDvErrorMessage(
              belgeGetirResp.json,
              'e-Tebligat PDF içeriği Dijital Vergi Dairesinden getirilemedi.'
            ),
          });
        }

        const resolved = await resolveDvReportLinkToBuffer(
          reportLink,
          dvSession,
          tebligBelge.uzanti || 'pdf'
        );
        if (!resolved.ok || !resolved.buffer) {
          if (resolved.error === 'SESSION_EXPIRED') {
            dvSessions.delete(dvSession.id);
            return res.json({
              ok: false,
              sessionExpired: true,
              error: 'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.',
            });
          }
          return res.json({
            ok: false,
            error: resolved.error || 'PDF içeriği çözümlenemedi.',
          });
        }
        const unwrapped = unwrapPdfBufferIfWrapped(resolved.buffer);
        pdfBuffer = unwrapped.buffer;
        mimeType = unwrapped.isPdf ? 'application/pdf' : resolved.mimeType || mimeType;
      }

      const rawBaseName = String(
        tebligBelge.adi || zarfData?.belgeNo || documentNo || tebligatId || 'etebligat'
      )
        .trim()
        .replace(/\.(imz|p7s|p7m)$/i, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext =
        mimeType === 'application/pdf'
          ? 'pdf'
          : String(tebligBelge.uzanti || 'pdf').trim().toLowerCase() || 'pdf';
      const fileName = rawBaseName.toLowerCase().endsWith(`.${ext}`)
        ? rawBaseName
        : `${rawBaseName}.${ext}`;

      const ekler = eklerRaw
        .filter((ek) => ek && ek.id)
        .map((ek) => ({
          id: String(ek.id),
          secureId: String(ek.secureId || ''),
          belgeTip: String(ek.belgeTip || ''),
          uzanti: String(ek.uzanti || 'pdf'),
          adi: String(ek.adi || `ek-${ek.id}`),
        }));

      return res.json({
        ok: true,
        pdfBase64: pdfBuffer.toString('base64'),
        mimeType,
        fileName,
        tarafId,
        tarafSecureId,
        tebligId: effTebligId,
        tebligSecureId: effTebligSecureId,
        markedReadAt: String(zarfData?.mukellefOkumaZamani || new Date().toISOString()),
        zarfDetay: {
          subject: String(zarfData?.belgeTuruAciklama || '').trim(),
          senderUnit: [zarfData?.kurumAciklama, zarfData?.altKurum]
            .map((v) => String(v || '').trim())
            .filter(Boolean)
            .join(' · '),
          documentNo: String(zarfData?.belgeNo || documentNo || '').trim(),
          sentDate: zarfData?.gonderimZamani ? parseGibDateToIso(zarfData.gonderimZamani) : '',
          legalServedDate: zarfData?.tebligZamani ? parseGibDateToIso(zarfData.tebligZamani) : '',
        },
        ekler,
      });
    } catch (err: any) {
      return res.status(200).json({
        ok: false,
        portalUnavailable: true,
        error: `e-Tebligat PDF indirme hatası: ${err?.message || 'Sunucuya ulaşılamadı.'}`,
      });
    }
  });

  // 7c-3. Dijital Vergi Dairesi e-Tebligat Ek Dosya İndirme
  app.post('/api/dv/etebligat-file', async (req, res) => {
    try {
      const { dvSessionId, tarafId, tarafSecureId, id, secureId, belgeTip, uzanti, adi } =
        req.body || {};
      const dvSession = dvSessions.get(String(dvSessionId || ''));
      if (!dvSession || !dvSession.dvToken) {
        return res.status(200).json({
          ok: false,
          sessionExpired: true,
          error: 'Aktif Dijital Vergi Dairesi oturumu bulunamadı.',
        });
      }
      dvSession.lastActivity = Date.now();

      if (!id || !tarafId || !tarafSecureId) {
        return res.json({ ok: false, error: 'Ek dosya parametreleri eksik.' });
      }

      const fileResp = await requestDijitalVdRaw('/apigateway/etebligat/etebligat/belge-getir', {
        method: 'POST',
        cookies: dvSession.cookies,
        token: dvSession.dvToken,
        extraHeaders: { 'page-name': 'TebligatDetay' },
        body: {
          data: {
            id,
            secureId: secureId || '',
            belgeTip: belgeTip || '',
            tarafId,
            tarafSecureId,
            uzanti: uzanti || 'pdf',
            belgeAdi: adi || `ek-${id}`,
          },
        },
      });
      dvSession.cookies = fileResp.cookies;
      if (fileResp.status === 401) {
        dvSessions.delete(dvSession.id);
        return res.json({
          ok: false,
          sessionExpired: true,
          error: 'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.',
        });
      }

      let outBuf: Buffer | null = null;
      let mimeType = guessMimeFromExtension(uzanti || 'pdf');
      const isDirectBinary =
        fileResp.buffer.length > 0 &&
        !fileResp.json &&
        !fileResp.contentType.includes('json');

      if (isDirectBinary) {
        outBuf = fileResp.buffer;
        if (fileResp.contentType && !fileResp.contentType.includes('octet-stream')) {
          mimeType = fileResp.contentType.split(';')[0].trim();
        }
      } else {
        const reportLink = String(
          fileResp.json?.reportLink ||
            fileResp.json?.data?.reportLink ||
            fileResp.json?.file ||
            ''
        ).trim();
        if (!reportLink) {
          return res.json({
            ok: false,
            error: extractDvErrorMessage(fileResp.json, 'Tebligat eki alınamadı.'),
          });
        }
        const resolved = await resolveDvReportLinkToBuffer(reportLink, dvSession, uzanti || 'pdf');
        if (!resolved.ok || !resolved.buffer) {
          return res.json({ ok: false, error: resolved.error || 'Ek dosya çözümlenemedi.' });
        }
        outBuf = resolved.buffer;
        mimeType = resolved.mimeType || mimeType;
      }

      const cleanBase = String(adi || `ek-${id}`)
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = String(uzanti || 'pdf').trim().toLowerCase() || 'pdf';
      const fileName = cleanBase.toLowerCase().endsWith(`.${ext}`)
        ? cleanBase
        : `${cleanBase}.${ext}`;

      return res.json({
        ok: true,
        base64: outBuf.toString('base64'),
        mimeType,
        fileName,
      });
    } catch (err: any) {
      return res.status(200).json({
        ok: false,
        error: `Ek dosya indirme hatası: ${err?.message || 'Sunucuya ulaşılamadı.'}`,
      });
    }
  });

  // 7d. Dijital Vergi Dairesi Alınan e-Arşiv Faturalar (/eislemler/earsiv/alici-list)
  app.post('/api/dv/received-invoices', async (req, res) => {
    try {
      const { dvSessionId, startDate, endDate } = req.body || {};
      const dvSession = dvSessions.get(String(dvSessionId || ''));
      if (!dvSession || !dvSession.dvToken) {
        return res.status(200).json({
          ok: false,
          sessionExpired: true,
          error: 'Aktif Dijital Vergi Dairesi oturumu bulunamadı. Lütfen doğrulama yapın.',
        });
      }
      dvSession.lastActivity = Date.now();

      // Check mucbir-sebep status (determines 7-day vs 15-day window & 2-month limit)
      let mucbirSebep = false;
      try {
        const msResp = await requestDijitalVd('/apigateway/eislemler/earsiv/mucbir-sebep', {
          method: 'POST',
          cookies: dvSession.cookies,
          token: dvSession.dvToken,
          extraHeaders: { 'page-name': 'eArsivFaturalarim' },
          body: {},
        });
        dvSession.cookies = msResp.cookies;
        if (msResp.status === 401) {
          dvSessions.delete(dvSession.id);
          return res.json({
            ok: false,
            sessionExpired: true,
            error: extractDvErrorMessage(
              msResp.json,
              'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.'
            ),
          });
        }
        mucbirSebep = Boolean(msResp.json?.yetki || msResp.json?.data?.yetki);
      } catch {
        mucbirSebep = false;
      }

      const todayIso = getTodayIstanbulIso();
      let effectiveEnd = endDate ? parseGibDateToIso(endDate) : todayIso;
      if (effectiveEnd > todayIso) effectiveEnd = todayIso;

      let effectiveStart = startDate ? parseGibDateToIso(startDate) : addDaysToIso(effectiveEnd, -6);
      if (effectiveStart > effectiveEnd) effectiveStart = effectiveEnd;

      let clampedToTwoMonths = false;
      if (!mucbirSebep) {
        const todayParts = todayIso.split('-').map(Number);
        const minDateObj = new Date(Date.UTC(todayParts[0], todayParts[1] - 1 - 2, 1));
        const minStartIso = minDateObj.toISOString().slice(0, 10);
        if (effectiveStart < minStartIso) {
          effectiveStart = minStartIso;
          clampedToTwoMonths = true;
          if (effectiveEnd < effectiveStart) effectiveEnd = effectiveStart;
        }
      }

      // Split into <= 7-day (6-day span) or <= 15-day (14-day span) chunks required by Dijital VD
      const maxSpanDays = mucbirSebep ? 14 : 6;
      const chunks: Array<{ startIso: string; endIso: string }> = [];
      let cursor = effectiveStart;
      let guard = 0;
      while (cursor <= effectiveEnd && guard < 20) {
        guard++;
        const candidateEnd = addDaysToIso(cursor, maxSpanDays);
        const chunkEnd = candidateEnd > effectiveEnd ? effectiveEnd : candidateEnd;
        chunks.push({ startIso: cursor, endIso: chunkEnd });
        cursor = addDaysToIso(chunkEnd, 1);
      }

      const deduped = new Map<string, any>();
      let chunkError = '';

      for (const chunk of chunks) {
        const resp = await requestDijitalVd('/apigateway/eislemler/earsiv/alici-list', {
          method: 'POST',
          cookies: dvSession.cookies,
          token: dvSession.dvToken,
          extraHeaders: {
            'page-name': 'eArsivFaturalarim',
          },
          body: {
            meta: {
              pagination: { pageNo: 1, pageSize: 100 },
              sortFieldName: 'faturaNo',
              sortType: 'DESC',
              filters: [],
            },
            data: {
              duzenlenmeTarihiBas: formatGibDateFromISO(chunk.startIso),
              duzenlenmeTarihiSon: formatGibDateFromISO(chunk.endIso),
            },
          },
        });
        dvSession.cookies = resp.cookies;

        if (resp.status === 401) {
          dvSessions.delete(dvSession.id);
          return res.json({
            ok: false,
            sessionExpired: true,
            error: extractDvErrorMessage(
              resp.json,
              'Dijital Vergi Dairesi oturumunun süresi doldu. Lütfen yeniden doğrulama yapın.'
            ),
          });
        }

        const rows =
          (Array.isArray(resp.json?.resultListDenormalized) && resp.json.resultListDenormalized) ||
          (Array.isArray(resp.json?.data?.resultListDenormalized) &&
            resp.json.data.resultListDenormalized) ||
          (Array.isArray(resp.json?.data?.content) && resp.json.data.content) ||
          (Array.isArray(resp.json?.data) && resp.json.data) ||
          null;

        if (!rows) {
          const hasExplicitErr =
            resp.status >= 400 ||
            (Array.isArray(resp.json?.messages) &&
              resp.json.messages.some((m: any) => m?.type === 'ERROR'));
          if (hasExplicitErr) {
            chunkError = extractDvErrorMessage(
              resp.json,
              `Alınan e-Arşiv fatura listesi alınamadı (HTTP ${resp.status}).`
            );
          }
          continue;
        }

        for (const row of rows) {
          const sellerTaxId = String(row?.tcknVkn || row?.saticiVknTckn || '')
            .replace(/\D/g, '')
            .slice(0, 11);
          const invoiceNo = String(row?.faturaNo || row?.belgeNumarasi || '').trim();
          const ettn =
            String(row?.ettn || row?.faturaUuid || '').trim() ||
            `${sellerTaxId || 'GIB'}-${invoiceNo || crypto.randomUUID().slice(0, 8)}`;
          if (!invoiceNo && !row?.ettn) continue;

          const dedupeKey = `${sellerTaxId}:${invoiceNo || ettn}`;
          const invoiceDate = parseGibDateToIso(
            row?.duzenlenmeTarihi || row?.belgeTarihi || row?.faturaTarihi
          );
          const sellerName =
            String(row?.unvan || row?.saticiUnvan || row?.saticiAdiSoyadi || 'Satıcı Mükellef').trim() ||
            'Satıcı Mükellef';

          const rawCurr = String(row?.paraBirimi || 'TRY').toUpperCase();
          const currency = ['TRY', 'USD', 'EUR', 'GBP'].includes(rawCurr) ? rawCurr : 'TRY';
          const exchangeRate =
            currency === 'TRY' ? 1 : Math.max(0.0001, parseGibTrNumber(row?.dovizKuru || 1));

          const grandTotal = parseGibTrNumber(
            row?.odenecekTutar ?? row?.vergilerDahilToplamTutar ?? row?.toplamTutar ?? 0
          );
          const vatTotal = parseGibTrNumber(row?.vergilerTutari ?? row?.hesaplananKdv ?? 0);
          let subtotal = parseGibTrNumber(row?.toplamTutar ?? row?.malHizmetToplamTutari ?? 0);
          if (subtotal <= 0 || (grandTotal > 0 && subtotal >= grandTotal && vatTotal > 0)) {
            subtotal = Math.max(0, Math.round((grandTotal - vatTotal) * 100) / 100);
          }

          const cancelStatus = String(row?.iptalItirazDurum || '').trim();
          const approvalStatus =
            cancelStatus && cancelStatus !== '------'
              ? cancelStatus
              : String(row?.onayDurumu || 'Onaylandı').trim() || 'Onaylandı';

          deduped.set(dedupeKey, {
            ettn,
            invoiceNo: invoiceNo || ettn.slice(0, 16).toUpperCase(),
            invoiceDate,
            invoiceType: String(row?.gonderimSekli || row?.belgeTuru || 'E-ARSIV').trim() || 'E-ARSIV',
            sellerName,
            sellerTaxId,
            currency,
            exchangeRate,
            subtotal,
            vatTotal,
            grandTotal,
            approvalStatus,
          });
        }
      }

      if (deduped.size === 0 && chunkError) {
        return res.json({
          ok: false,
          error: chunkError,
        });
      }

      return res.json({
        ok: true,
        items: Array.from(deduped.values()),
        clampedToTwoMonths,
        effectiveStart,
        effectiveEnd,
      });
    } catch (err: any) {
      return res.status(200).json({
        ok: false,
        portalUnavailable: true,
        error: `Alınan e-Arşiv faturalar alınamadı: ${err?.message || 'Bağlantı hatası.'}`,
      });
    }
  });

  // 7e. Dijital Vergi Dairesi Oturum Kapatma
  app.post('/api/dv/logout', (req, res) => {
    const { dvSessionId } = req.body || {};
    if (dvSessionId) {
      dvSessions.delete(String(dvSessionId));
    }
    return res.json({ ok: true });
  });

  // Guarantee /api/* never returns HTML error pages
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ ok: false, error: 'İstenen API uç noktası bulunamadı.' });
  });

  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || 'Sunucu API hatası oluştu.',
    });
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
