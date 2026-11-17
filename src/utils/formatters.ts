import type { CurrencyCode } from '../types';

export function formatTRY(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatCurrency(amount: number, currency: CurrencyCode = 'TRY'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function daysUntilDue(dueDateISO: string): number {
  if (!dueDateISO) return 9999;
  const parts = dueDateISO.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 9999;
  const dueUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const todayParts = todayISO().split('-').map(Number);
  const todayUtc = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
  return Math.round((dueUtc - todayUtc) / (1000 * 60 * 60 * 24));
}

export function addDaysISO(baseISO: string, days: number): string {
  const parts = baseISO.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return todayISO();
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return d.toISOString().slice(0, 10);
}

export function formatNumberTR(amount: number, decimals = 2): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
}

export function formatDateTR(isoDate: string): string {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

export function toGibDate(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentTimeHMS(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function sanitizeString(value: string | undefined | null, maxLen: number): string {
  if (!value) return '';
  return String(value).trim().slice(0, maxLen);
}

export function isValidTaxId(vkn: string): boolean {
  const clean = vkn.replace(/\D/g, '');
  return clean.length === 10 || clean.length === 11;
}

export function numberToTurkishWords(amount: number, currency: CurrencyCode = 'TRY'): string {
  const safe = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const rounded = Math.round(safe * 100);
  const major = Math.floor(rounded / 100);
  const minor = rounded % 100;

  const ones = ['', 'BİR', 'İKİ', 'ÜÇ', 'DÖRT', 'BEŞ', 'ALTI', 'YEDİ', 'SEKİZ', 'DOKUZ'];
  const tens = ['', 'ON', 'YİRMİ', 'OTUZ', 'KIRK', 'ELLİ', 'ALTMIŞ', 'YETMİŞ', 'SEKSEN', 'DOKSAN'];
  const scales = ['', 'BİN', 'MİLYON', 'MİLYAR', 'TRİLYON'];

  function threeDigitsToWords(n: number): string {
    if (n === 0) return '';
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const o = n % 10;
    let res = '';
    if (h === 1) res += 'YÜZ';
    else if (h > 1) res += ones[h] + 'YÜZ';
    res += tens[t];
    res += ones[o];
    return res;
  }

  function intToWords(n: number): string {
    if (n === 0) return 'SIFIR';
    let remaining = n;
    let scaleIdx = 0;
    const parts: string[] = [];

    while (remaining > 0) {
      const chunk = remaining % 1000;
      if (chunk > 0) {
        if (scaleIdx === 1 && chunk === 1) {
          parts.unshift('BİN');
        } else {
          parts.unshift(threeDigitsToWords(chunk) + scales[scaleIdx]);
        }
      }
      remaining = Math.floor(remaining / 1000);
      scaleIdx++;
    }
    return parts.join('');
  }

  const unitLabels: Record<
    CurrencyCode,
    { majorOnly: string; majorWithMinor: string; minor: string }
  > = {
    TRY: { majorOnly: 'TÜRK LİRASIDIR.', majorWithMinor: 'TÜRK LİRASI', minor: 'KURUŞTUR.' },
    USD: { majorOnly: 'ABD DOLARIDIR.', majorWithMinor: 'ABD DOLARI', minor: 'SENTTİR.' },
    EUR: { majorOnly: 'EURODUR.', majorWithMinor: 'EURO', minor: 'SENTTİR.' },
    GBP: {
      majorOnly: 'İNGİLİZ STERLİNİDİR.',
      majorWithMinor: 'İNGİLİZ STERLİNİ',
      minor: 'PENİDİR.',
    },
  };

  const labels = unitLabels[currency] || unitLabels.TRY;
  const majorWords = intToWords(major);

  if (minor === 0) {
    return `YALNIZ ${majorWords} ${labels.majorOnly}`;
  }
  return `YALNIZ ${majorWords} ${labels.majorWithMinor} ${intToWords(minor)} ${labels.minor}`;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Nakit',
  bank: 'Banka Hesabı',
  pos: 'Kredi Kartı / POS',
  transfer: 'Havale / EFT',
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  customer: 'Müşteri',
  supplier: 'Tedarikçi',
  both: 'Müşteri & Tedarikçi',
};

export const INCOME_CATEGORIES = [
  'Mal / Hizmet Satışı',
  'e-Arşiv Fatura Tahsilatı',
  'Cari Tahsilat',
  'Danışmanlık / İşçilik',
  'Diğer Gelir',
];

export const EXPENSE_CATEGORIES = [
  'Mal Alımı / Hammadde',
  'Kira & Aidat',
  'Elektrik / Su / Doğalgaz',
  'İnternet & Telefon',
  'Vergi & SGK',
  'Muhasebe & Mali Müşavirlik',
  'Ulaşım & Yakıt',
  'Cari Ödeme',
  'Diğer Gider',
];

export const UNIT_OPTIONS = ['Adet', 'Hizmet', 'Saat', 'Gün', 'Ay', 'Kg', 'Paket', 'Kutu', 'Metre'];

export const CURRENCY_OPTIONS: CurrencyCode[] = ['TRY', 'USD', 'EUR', 'GBP'];

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  TRY: 'TRY (₺)',
  USD: 'USD ($)',
  EUR: 'EUR (€)',
  GBP: 'GBP (£)',
};
