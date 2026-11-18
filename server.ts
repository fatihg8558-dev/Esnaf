import express from 'express';
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
