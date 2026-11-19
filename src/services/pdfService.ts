import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import type {
  Account,
  BusinessProfile,
  CurrencyCode,
  ETebligatItem,
  Invoice,
  ReceivedInvoice,
} from '../types';
import {
  ACCOUNT_TYPE_LABELS,
  formatCurrency,
  formatDateTR,
  formatNumberTR,
  numberToTurkishWords,
  todayISO,
} from '../utils/formatters';

function escapeHtml(text: string | undefined | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildDeterministicQrSvg(seedText: string, size = 148): string {
  const grid = 33;
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const isFinder = (r: number, c: number, fr: number, fc: number) => {
    const dr = r - fr;
    const dc = c - fc;
    if (dr < 0 || dr > 6 || dc < 0 || dc > 6) return false;
    if (dr === 0 || dr === 6 || dc === 0 || dc === 6) return true;
    if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) return true;
    return false;
  };

  const isAlign = (r: number, c: number, ar0: number, ac0: number) => {
    const dr = r - ar0;
    const dc = c - ac0;
    if (dr < -2 || dr > 2 || dc < -2 || dc > 2) return false;
    return Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
  };

  const rects: string[] = [];
  const cell = size / grid;
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      let dark = false;
      if (r < 7 && c < 7) dark = isFinder(r, c, 0, 0);
      else if (r < 7 && c >= grid - 7) dark = isFinder(r, c, 0, grid - 7);
      else if (r >= grid - 7 && c < 7) dark = isFinder(r, c, grid - 7, 0);
      else if ((r === 7 && c < 8) || (c === 7 && r < 8)) dark = false;
      else if ((r === 7 && c >= grid - 8) || (c === grid - 8 && r < 8)) dark = false;
      else if ((r >= grid - 8 && c < 8) || (c === 7 && r >= grid - 8)) dark = false;
      else if (r === 6 && c >= 8 && c <= grid - 9) dark = c % 2 === 0;
      else if (c === 6 && r >= 8 && r <= grid - 9) dark = r % 2 === 0;
      else if (Math.abs(r - (grid - 7)) <= 2 && Math.abs(c - (grid - 7)) <= 2) {
        dark = isAlign(r, c, grid - 7, grid - 7);
      } else {
        h ^= (r * 41 + c * 23 + 17) & 0xff;
        h = Math.imul(h, 16777619);
        dark = ((h >>> 24) & 1) === 1;
      }
      if (dark) {
        rects.push(
          `<rect x="${(c * cell).toFixed(2)}" y="${(r * cell).toFixed(2)}" width="${(
            cell + 0.18
          ).toFixed(2)}" height="${(cell + 0.18).toFixed(2)}" fill="#000000"/>`
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;background:#ffffff;">${rects.join(
    ''
  )}</svg>`;
}

/**
 * Official circular GİB / T.C. Hazine ve Maliye Bakanlığı e-Arşiv Emblem
 * Blue outer ring with curved ministry & GİB titles + red stylized "Gi" monogram
 */
export function buildGibEmblemSvg(size = 86): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 120 120" style="display:block;">
    <defs>
      <path id="gibTopArc" d="M 15,60 A 45,45 0 1,1 105,60" />
      <path id="gibBotArc" d="M 11,60 A 49,49 0 1,0 109,60" />
    </defs>
    <!-- White base + crisp blue outer ring -->
    <circle cx="60" cy="60" r="57" fill="#ffffff" stroke="#0d4c9c" stroke-width="1.2"/>
    <circle cx="60" cy="60" r="47.5" fill="none" stroke="#0d4c9c" stroke-width="14.5"/>
    <circle cx="60" cy="60" r="39.5" fill="#ffffff" stroke="#0d4c9c" stroke-width="1"/>
    <!-- Curved white ministry & GİB titles -->
    <text font-family="Arial, Helvetica, sans-serif" font-size="7.4" font-weight="700" fill="#ffffff" letter-spacing="0.2">
      <textPath href="#gibTopArc" xlink:href="#gibTopArc" startOffset="50%" text-anchor="middle">T.C. Hazine ve Maliye Bakanlığı</textPath>
    </text>
    <text font-family="Arial, Helvetica, sans-serif" font-size="7.6" font-weight="700" fill="#ffffff" letter-spacing="0.25">
      <textPath href="#gibBotArc" xlink:href="#gibBotArc" startOffset="50%" text-anchor="middle">Gelir İdaresi Başkanlığı</textPath>
    </text>
    <!-- Red stylized Gi monogram -->
    <g fill="#e30a17">
      <!-- Red dot of 'i' -->
      <circle cx="77.5" cy="40" r="4.8"/>
      <!-- Slanted 'i' stem -->
      <path d="M 72.2 48.5 L 81.8 48.5 L 75.2 79.5 L 65.6 79.5 Z"/>
      <!-- Stylized rounded italic 'G' -->
      <path d="M 67.8 49.2 C 65.2 40.2 57.6 35.8 48.8 36.2 C 35.4 36.8 27.6 46.8 26.2 59.5 C 24.8 72.6 32.8 81.2 46.5 81.2 C 53.8 81.2 60.2 78.2 64.2 73.2 L 67.2 58.2 L 49.5 58.2 L 48.0 65.5 L 56.2 65.5 L 55.2 70.2 C 52.8 72.0 50.0 72.8 47.0 72.8 C 39.2 72.8 35.4 67.4 36.4 58.8 C 37.4 50.2 42.4 44.6 50.2 44.6 C 54.8 44.6 57.6 46.6 59.2 49.8 Z"/>
    </g>
  </svg>`;
}

function currencyWordsLabel(amount: number, currency: CurrencyCode): string {
  return numberToTurkishWords(amount, currency);
}

function buildExtraNoteLinesHtml(rawNote?: string): string {
  if (!rawNote) return '';
  const lines = String(rawNote)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.toUpperCase().startsWith('YALNIZ '));
  if (lines.length === 0) return '';
  return lines
    .map((line) => {
      if (/^iban\s*:/i.test(line)) {
        const rest = line.replace(/^iban\s*:\s*/i, '');
        return `<div style="margin-top:2px;"><strong>IBAN:</strong> ${escapeHtml(rest)}</div>`;
      }
      return `<div style="margin-top:2px;">${escapeHtml(line)}</div>`;
    })
    .join('');
}

/**
 * Formats date in standard GİB e-Arşiv XSLT DD-MM-YYYY format
 */
function formatGibDashDate(isoDate?: string): string {
  if (!isoDate) return '-';
  const parts = String(isoDate).split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return formatDateTR(isoDate).replace(/\./g, '-');
}

function formatGibShortTime(rawTime?: string): string {
  const clean = String(rawTime || '').trim();
  const match = clean.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : '00:00';
}

function formatGibQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : formatNumberTR(qty, 2);
}

function formatGibAmount(value: number, currency: CurrencyCode): string {
  const formatted = formatNumberTR(value, 2);
  if (currency === 'TRY') return `${formatted} TL`;
  if (currency === 'USD') return `${formatted} USD`;
  if (currency === 'EUR') return `${formatted} EUR`;
  return `${formatted} GBP`;
}

async function renderHtmlContainerToPdfInstance(html: string): Promise<jsPDF> {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-10000px';
  wrapper.style.top = '0';
  wrapper.style.width = '794px';
  wrapper.style.background = '#ffffff';
  wrapper.style.color = '#000000';
  wrapper.style.fontFamily = 'Arial, Helvetica, sans-serif';
  wrapper.style.zIndex = '-1';
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  try {
    const canvas = await html2canvas(wrapper, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: 794,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight;

    while (heightLeft > 1) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;
    }

    return pdf;
  } finally {
    document.body.removeChild(wrapper);
  }
}

async function renderHtmlContainerToPdf(html: string, filename: string): Promise<void> {
  const pdf = await renderHtmlContainerToPdfInstance(html);
  pdf.save(filename);
}

/**
 * Attempts to convert official HTML retrieved from GİB's EARSIV_PORTAL_FATURA_GOSTER
 * into a clean A4 PDF. Returns true on success, false if official HTML is incomplete
 * or cannot be rendered safely so the caller can fall back to the authentic local XSLT template.
 */
async function tryRenderOfficialGibHtmlToPdf(
  officialHtml: string,
  filename: string
): Promise<boolean> {
  if (!officialHtml || officialHtml.trim().length < 100) return false;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(officialHtml, 'text/html');
    // Remove potentially unsafe tags
    doc.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove());

    // Check if there are relative non-data images that won't load locally
    const imgs = Array.from(doc.querySelectorAll('img'));
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (src && !src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://')) {
        // Broken relative GİB path would render missing image icon; fall back to local XSLT
        return false;
      }
    }

    const bodyText = (doc.body?.textContent || '').trim();
    if (bodyText.length < 40) return false;

    const styles = Array.from(doc.querySelectorAll('style'))
      .map((s) =>
        (s.textContent || '')
          .replace(/\bhtml\b/gi, '.gib-official-root')
          .replace(/\bbody\b/gi, '.gib-official-root')
      )
      .join('\n');

    const wrappedHtml = `
      <style>${styles}</style>
      <div class="gib-official-root" style="width:794px;padding:24px 28px;background:#ffffff;color:#000000;box-sizing:border-box;">
        ${doc.body.innerHTML}
      </div>
    `;

    await renderHtmlContainerToPdf(wrappedHtml, filename);
    return true;
  } catch {
    return false;
  }
}

export async function downloadGibInvoicePdf(
  invoice: Invoice,
  sellerFallback?: {
    title?: string;
    taxId?: string;
    taxOffice?: string;
    address?: string;
    city?: string;
    district?: string;
    phone?: string;
    email?: string;
  },
  options?: {
    officialHtml?: string;
  }
): Promise<void> {
  const cleanNo = (invoice.invoiceNo || invoice.ettn).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `e-arsiv-${cleanNo}.pdf`;

  if (options?.officialHtml) {
    const rendered = await tryRenderOfficialGibHtmlToPdf(options.officialHtml, filename);
    if (rendered) return;
  }

  const currency: CurrencyCode = invoice.currency || 'TRY';
  const exchangeRate = Number(invoice.exchangeRate) || 1;
  const sellerTitle = invoice.sellerTitle || sellerFallback?.title || 'İşletme Unvanı';
  const sellerTaxId = String(invoice.sellerTaxId || sellerFallback?.taxId || '-').trim();
  const sellerTaxLabel = sellerTaxId.replace(/\D/g, '').length === 11 ? 'TCKN' : 'VKN';
  const sellerTaxOffice = invoice.sellerTaxOffice || sellerFallback?.taxOffice || '-';
  const sellerAddress = invoice.sellerAddress || sellerFallback?.address || '-';
  const sellerLoc = [sellerFallback?.district, sellerFallback?.city, 'Türkiye']
    .filter(Boolean)
    .join('/ ');

  const cleanRecipientTax = String(invoice.recipientTaxId || '').trim();
  const recipientTaxLabel = cleanRecipientTax.replace(/\D/g, '').length === 11 ? 'TCKN' : 'VKN';
  const recipientLoc = [invoice.recipientDistrict, invoice.recipientCity]
    .filter(Boolean)
    .join('/ ');

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

  const qrSvg = buildDeterministicQrSvg(
    `${invoice.ettn}|${invoice.invoiceNo}|${invoice.grandTotal}|${currency}`,
    144
  );
  const emblemSvg = buildGibEmblemSvg(86);
  const tlEquivalent =
    currency !== 'TRY' && exchangeRate > 0
      ? Math.round(invoice.grandTotal * exchangeRate * 100) / 100
      : null;

  const gibDate = formatGibDashDate(invoice.invoiceDate);
  const gibShortTime = formatGibShortTime(invoice.invoiceTime);
  const invoiceTypeCode = invoice.invoiceType === 'IADE' ? 'IADE' : 'SATIS';

  const itemRows = invoice.items
    .map(
      (item, idx) => `
      <tr>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:left;">${idx + 1}</td>
        <td style="border:1px solid #000000;padding:3px 5px;text-align:left;color:#000000;">${escapeHtml(
          item.name
        )}</td>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:right;white-space:nowrap;">${formatGibQty(
          item.quantity
        )} ${escapeHtml(item.unit)}</td>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:right;white-space:nowrap;">${formatGibAmount(
          item.unitPrice,
          currency
        )}</td>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:right;white-space:nowrap;">%0,00</td>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:right;white-space:nowrap;">${formatGibAmount(
          0,
          currency
        )}</td>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:center;white-space:nowrap;">İskonto -</td>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:right;white-space:nowrap;">%${formatNumberTR(
          item.vatRate,
          2
        )}</td>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:right;white-space:nowrap;">${formatGibAmount(
          item.lineVat,
          currency
        )}</td>
        <td style="border:1px solid #000000;padding:3px 4px;text-align:right;"></td>
        <td style="border:1px solid #000000;padding:3px 5px;text-align:right;white-space:nowrap;">${formatGibAmount(
          item.lineSubtotal,
          currency
        )}</td>
      </tr>
    `
    )
    .join('');

  const fillerCount = Math.max(0, 15 - invoice.items.length);
  const fillerRows = Array.from({ length: fillerCount })
    .map(
      () => `
      <tr>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
        <td style="border:1px solid #000000;height:14px;padding:1px 4px;">&nbsp;</td>
      </tr>
    `
    )
    .join('');

  const vatRows = Object.entries(vatBreakdown)
    .map(
      ([rate, vals]) => `
      <tr>
        <td style="border:1px solid #000000;padding:3px 7px;text-align:right;font-weight:700;">Hesaplanan KDV(%${escapeHtml(
          rate
        )})</td>
        <td style="border:1px solid #000000;padding:3px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
          vals.vat,
          currency
        )}</td>
      </tr>
    `
    )
    .join('');

  const isApproved = invoice.status === 'approved';
  const isCancelled = invoice.status === 'cancelled';

  const html = `
    <div style="padding:22px 26px;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.35;">
      <!-- Top 3-Column Official GİB e-Arşiv XSLT Header -->
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <tr>
          <!-- Left Column: Seller + SAYIN + ETTN -->
          <td style="width:42%;vertical-align:top;padding-right:10px;">
            <div style="border-top:2.5px solid #000000;border-bottom:2.5px solid #000000;padding:6px 2px;font-size:9.5px;color:#222222;">
              <div style="font-size:10px;text-transform:uppercase;color:#111111;margin-bottom:2px;">${escapeHtml(
                sellerTitle
              )}</div>
              <div>${escapeHtml(sellerAddress)}</div>
              ${sellerLoc ? `<div>${escapeHtml(sellerLoc)}</div>` : ''}
              <div>Tel: ${escapeHtml(sellerFallback?.phone || '')} Fax:</div>
              <div>Web Sitesi:</div>
              <div>E-Posta: ${escapeHtml(sellerFallback?.email || '')}</div>
              <div>Vergi Dairesi: ${escapeHtml(sellerTaxOffice)}</div>
              <div>${sellerTaxLabel}: ${escapeHtml(sellerTaxId)}</div>
            </div>

            <div style="height:24px;"></div>

            <div style="border-top:2.5px solid #000000;border-bottom:2.5px solid #000000;padding:6px 2px;font-size:9.5px;color:#222222;">
              <div style="font-size:10px;font-weight:700;color:#000000;margin-bottom:2px;">SAYIN</div>
              <div style="color:#111111;">${escapeHtml(invoice.recipientName)}</div>
              ${
                invoice.recipientAddress
                  ? `<div>${escapeHtml(invoice.recipientAddress)}</div>`
                  : ''
              }
              ${
                recipientLoc
                  ? `<div>${escapeHtml(recipientLoc)} Türkiye</div>`
                  : ''
              }
              <div>Web Sitesi:</div>
              <div>E-Posta:</div>
              <div>Tel: Fax:</div>
              <div>${recipientTaxLabel}: ${escapeHtml(cleanRecipientTax)}</div>
            </div>

            <div style="margin-top:5px;font-size:9.5px;color:#222222;">
              <strong>ETTN:</strong> ${escapeHtml(invoice.ettn)}
            </div>
            ${
              currency !== 'TRY'
                ? `<div style="margin-top:2px;font-size:9px;color:#222222;"><strong>Para Birimi:</strong> ${currency} | <strong>Kur:</strong> ${formatNumberTR(
                    exchangeRate,
                    4
                  )} TL</div>`
                : ''
            }
          </td>

          <!-- Center Column: Official GİB Crest + e-Arşiv Fatura -->
          <td style="width:23%;vertical-align:top;text-align:center;padding:24px 6px 0;">
            <div style="display:inline-block;">${emblemSvg}</div>
            <div style="font-size:13px;font-weight:700;color:#222222;margin-top:5px;">
              e-Arşiv Fatura
            </div>
            ${
              !isApproved
                ? `<div style="font-size:8.5px;font-weight:700;color:#b91c1c;margin-top:6px;">${
                    isCancelled ? 'İPTAL EDİLMİŞTİR' : 'TASLAK / ÖN İZLEME'
                  }</div>`
                : ''
            }
          </td>

          <!-- Right Column: Top-Right Large QR Code + Bottom-Right 5-Row Metadata Grid -->
          <td style="width:35%;vertical-align:top;padding-left:8px;">
            <div style="text-align:right;">
              <div style="display:inline-block;">${qrSvg}</div>
            </div>
            <div style="height:30px;"></div>
            <table style="width:100%;border-collapse:collapse;font-size:9.5px;">
              <tr>
                <td style="border:1px solid #000000;padding:3px 6px;font-weight:700;width:48%;background:#ffffff;">Özelleştirme No:</td>
                <td style="border:1px solid #000000;padding:3px 6px;">TR1.2</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:3px 6px;font-weight:700;background:#ffffff;">Senaryo:</td>
                <td style="border:1px solid #000000;padding:3px 6px;">EARSIVFATURA</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:3px 6px;font-weight:700;background:#ffffff;">Fatura Tipi:</td>
                <td style="border:1px solid #000000;padding:3px 6px;">${invoiceTypeCode}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:3px 6px;font-weight:700;background:#ffffff;">Fatura No:</td>
                <td style="border:1px solid #000000;padding:3px 6px;">${escapeHtml(
                  invoice.invoiceNo
                )}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:3px 6px;font-weight:700;background:#ffffff;">Fatura Tarihi:</td>
                <td style="border:1px solid #000000;padding:3px 6px;">${gibDate} ${gibShortTime}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Official 11-Column Line Items Table (Pure White Headers + Empty Ruled Filler Rows) -->
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:8.6px;">
        <thead>
          <tr style="background:#ffffff;color:#000000;">
            <th style="border:1px solid #000000;padding:4px 3px;text-align:center;font-weight:700;">Sıra<br/>No</th>
            <th style="border:1px solid #000000;padding:4px 5px;text-align:center;font-weight:700;">Mal Hizmet</th>
            <th style="border:1px solid #000000;padding:4px 4px;text-align:center;font-weight:700;">Miktar</th>
            <th style="border:1px solid #000000;padding:4px 4px;text-align:center;font-weight:700;">Birim Fiyat</th>
            <th style="border:1px solid #000000;padding:4px 3px;text-align:center;font-weight:700;">İskonto/<br/>Arttırım<br/>Oranı</th>
            <th style="border:1px solid #000000;padding:4px 3px;text-align:center;font-weight:700;">İskonto/<br/>Arttırım<br/>Tutarı</th>
            <th style="border:1px solid #000000;padding:4px 3px;text-align:center;font-weight:700;">İskonto/<br/>Arttırım<br/>Nedeni</th>
            <th style="border:1px solid #000000;padding:4px 3px;text-align:center;font-weight:700;">KDV<br/>Oranı</th>
            <th style="border:1px solid #000000;padding:4px 4px;text-align:center;font-weight:700;">KDV Tutarı</th>
            <th style="border:1px solid #000000;padding:4px 4px;text-align:center;font-weight:700;">Diğer Vergiler</th>
            <th style="border:1px solid #000000;padding:4px 4px;text-align:center;font-weight:700;">Mal<br/>Hizmet<br/>Tutarı</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          ${fillerRows}
        </tbody>
      </table>

      <!-- Right-Aligned Totals Table (Pure White, Right-Aligned Labels) -->
      <table style="width:100%;border-collapse:collapse;margin-top:2px;">
        <tr>
          <td style="width:57%;"></td>
          <td style="width:43%;vertical-align:top;">
            <table style="width:100%;border-collapse:collapse;font-size:9px;">
              <tr>
                <td style="border:1px solid #000000;padding:3px 7px;text-align:right;font-weight:700;">Mal Hizmet Toplam Tutarı</td>
                <td style="border:1px solid #000000;padding:3px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
                  invoice.subtotal,
                  currency
                )}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:3px 7px;text-align:right;font-weight:700;">Toplam İskonto</td>
                <td style="border:1px solid #000000;padding:3px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
                  0,
                  currency
                )}</td>
              </tr>
              ${vatRows}
              <tr>
                <td style="border:1px solid #000000;padding:3px 7px;text-align:right;font-weight:700;">Vergiler Dahil Toplam Tutar</td>
                <td style="border:1px solid #000000;padding:3px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
                  invoice.grandTotal,
                  currency
                )}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:3px 7px;text-align:right;font-weight:700;">Ödenecek Tutar</td>
                <td style="border:1px solid #000000;padding:3px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
                  invoice.grandTotal,
                  currency
                )}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Bottom Notes Box (Full Width, Crisp Black Border, Tall Box) -->
      <div style="margin-top:12px;border:1px solid #000000;padding:8px 10px;min-height:76px;font-size:9.2px;color:#000000;line-height:1.45;box-sizing:border-box;">
        <div><strong>Not:</strong> ${escapeHtml(currencyWordsLabel(invoice.grandTotal, currency))}</div>
        ${
          tlEquivalent !== null
            ? `<div style="margin-top:2px;"><strong>TL Karşılığı:</strong> ${formatGibAmount(
                tlEquivalent,
                'TRY'
              )} (1 ${currency} = ${formatNumberTR(exchangeRate, 4)} TL)</div>`
            : ''
        }
        ${buildExtraNoteLinesHtml(invoice.note)}
        <div style="margin-top:4px;font-size:8.5px;color:#222222;">
          Bu belge 509 Sıra No'lu VUK Genel Tebliği uyarınca elektronik ortamda e-Arşiv Fatura olarak düzenlenmiştir.
        </div>
      </div>
    </div>
  `;

  await renderHtmlContainerToPdf(html, filename);
}

export interface StatementPdfRow {
  date: string;
  docNo: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export async function downloadAccountStatementPdf(params: {
  businessTitle: string;
  businessTaxId: string;
  account: Account;
  startDate: string;
  endDate: string;
  currencyFilter: CurrencyCode;
  rows: StatementPdfRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}): Promise<void> {
  const {
    businessTitle,
    businessTaxId,
    account,
    startDate,
    endDate,
    currencyFilter,
    rows,
    totalDebit,
    totalCredit,
    closingBalance,
  } = params;

  const periodLabel = `${startDate ? formatDateTR(startDate) : 'Başlangıç'} - ${
    endDate ? formatDateTR(endDate) : 'Bugün'
  }`;

  const bodyRows = rows
    .map(
      (r) => `
      <tr>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;white-space:nowrap;">${
          r.date ? formatDateTR(r.date) : '-'
        }</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;white-space:nowrap;font-weight:600;">${escapeHtml(
          r.docNo
        )}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(r.description)}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;white-space:nowrap;color:#0f172a;">${
          r.debit > 0 ? formatCurrency(r.debit, currencyFilter) : '-'
        }</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;white-space:nowrap;color:#0f172a;">${
          r.credit > 0 ? formatCurrency(r.credit, currencyFilter) : '-'
        }</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;white-space:nowrap;font-weight:700;">${formatCurrency(
          Math.abs(r.balance),
          currencyFilter
        )} ${r.balance > 0 ? '(B)' : r.balance < 0 ? '(A)' : ''}</td>
      </tr>
    `
    )
    .join('');

  const balanceLabel =
    closingBalance > 0
      ? `Alacaklıyız (${formatCurrency(closingBalance, currencyFilter)})`
      : closingBalance < 0
      ? `Borçluyuz (${formatCurrency(Math.abs(closingBalance), currencyFilter)})`
      : 'Mutabık (0,00)';

  const html = `
    <div style="padding:28px 32px;background:#ffffff;color:#111827;font-size:11px;line-height:1.45;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:14px;">
        <div>
          <div style="font-size:15px;font-weight:800;color:#0f172a;">${escapeHtml(
            businessTitle || 'Esnaf İşletmem'
          )}</div>
          ${
            businessTaxId
              ? `<div style="color:#475569;margin-top:2px;">VKN / TCKN: ${escapeHtml(
                  businessTaxId
                )}</div>`
              : ''
          }
        </div>
        <div style="text-align:right;">
          <div style="font-size:15px;font-weight:800;color:#0f172a;">CARİ HESAP EKSTRESİ</div>
          <div style="color:#475569;margin-top:2px;">Düzenleme: ${formatDateTR(todayISO())}</div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;background:#f8fafc;border:1px solid #cbd5e1;">
        <tr>
          <td style="padding:8px 10px;width:55%;vertical-align:top;">
            <div style="font-size:10px;font-weight:700;color:#64748b;">CARİ HESAP</div>
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:2px;">${escapeHtml(
              account.name
            )}</div>
            <div style="color:#334155;margin-top:2px;">
              Tür: ${escapeHtml(ACCOUNT_TYPE_LABELS[account.accountType] || account.accountType)}
              ${account.taxId ? ` · VKN/TC: ${escapeHtml(account.taxId)}` : ''}
              ${account.taxOffice ? ` · VD: ${escapeHtml(account.taxOffice)}` : ''}
            </div>
            ${
              account.phone
                ? `<div style="color:#334155;">Tel: ${escapeHtml(account.phone)}</div>`
                : ''
            }
          </td>
          <td style="padding:8px 10px;width:45%;vertical-align:top;border-left:1px solid #cbd5e1;">
            <div style="font-size:10px;font-weight:700;color:#64748b;">EKSTRE FİLTRELERİ</div>
            <div style="margin-top:3px;color:#0f172a;"><strong>Tarih Aralığı:</strong> ${escapeHtml(
              periodLabel
            )}</div>
            <div style="margin-top:2px;color:#0f172a;"><strong>Para Birimi:</strong> ${currencyFilter}</div>
            ${
              account.nextDueDate
                ? `<div style="margin-top:2px;color:#0f172a;"><strong>Sonraki Vade:</strong> ${formatDateTR(
                    account.nextDueDate
                  )}</div>`
                : ''
            }
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <thead>
          <tr style="background:#0f172a;color:#ffffff;">
            <th style="border:1px solid #0f172a;padding:7px 8px;text-align:left;">Tarih</th>
            <th style="border:1px solid #0f172a;padding:7px 8px;text-align:left;">Belge No</th>
            <th style="border:1px solid #0f172a;padding:7px 8px;text-align:left;">Açıklama</th>
            <th style="border:1px solid #0f172a;padding:7px 8px;text-align:right;">Borç</th>
            <th style="border:1px solid #0f172a;padding:7px 8px;text-align:right;">Alacak</th>
            <th style="border:1px solid #0f172a;padding:7px 8px;text-align:right;">Bakiye</th>
          </tr>
        </thead>
        <tbody>
          ${
            bodyRows ||
            `<tr><td colspan="6" style="border:1px solid #cbd5e1;padding:16px;text-align:center;color:#64748b;">Seçili tarih aralığında hareket bulunmuyor.</td></tr>`
          }
        </tbody>
        <tfoot>
          <tr style="background:#f1f5f9;font-weight:700;color:#0f172a;">
            <td colspan="3" style="border:1px solid #94a3b8;padding:7px 8px;text-align:right;">DÖNEM TOPLAMI / KAPANIŞ BAKİYESİ</td>
            <td style="border:1px solid #94a3b8;padding:7px 8px;text-align:right;">${formatCurrency(
              totalDebit,
              currencyFilter
            )}</td>
            <td style="border:1px solid #94a3b8;padding:7px 8px;text-align:right;">${formatCurrency(
              totalCredit,
              currencyFilter
            )}</td>
            <td style="border:1px solid #94a3b8;padding:7px 8px;text-align:right;">${escapeHtml(
              balanceLabel
            )}</td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:16px;font-size:9.5px;color:#64748b;display:flex;justify-content:space-between;">
        <span>(B): Müşteri borçlu / Alacaklıyız · (A): Tedarikçiye borçluyuz veya tahsilat fazlası</span>
        <span>${rows.length} satır listelendi</span>
      </div>
    </div>
  `;

  const safeName = account.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  await renderHtmlContainerToPdf(html, `cari-ekstre-${safeName}-${currencyFilter}.pdf`);
}

export async function downloadReceivedInvoicePdf(
  recInv: ReceivedInvoice,
  buyerInfo?: { title?: string; taxId?: string },
  officialHtml?: string
): Promise<void> {
  const cleanNo = (recInv.invoiceNo || recInv.ettn).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `alinan-fatura-${cleanNo}.pdf`;

  if (officialHtml) {
    const rendered = await tryRenderOfficialGibHtmlToPdf(officialHtml, filename);
    if (rendered) return;
  }

  const currency: CurrencyCode = recInv.currency || 'TRY';
  const html = `
    <div style="padding:28px 32px;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.45;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000000;padding-bottom:12px;margin-bottom:16px;">
        <div>
          <div style="font-size:15px;font-weight:700;">ALINAN e-ARŞİV FATURA ÖZETİ</div>
          <div style="font-size:10px;color:#333333;margin-top:2px;">ETTN: ${escapeHtml(recInv.ettn)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${buildGibEmblemSvg(56)}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="border:1px solid #000000;padding:8px 10px;width:50%;vertical-align:top;">
            <div style="font-size:10px;font-weight:700;margin-bottom:4px;">SATICI BİLGİLERİ</div>
            <div style="font-weight:700;">${escapeHtml(recInv.sellerName)}</div>
            <div>VKN / TCKN: ${escapeHtml(recInv.sellerTaxId || '-')}</div>
          </td>
          <td style="border:1px solid #000000;padding:8px 10px;width:50%;vertical-align:top;">
            <div style="font-size:10px;font-weight:700;margin-bottom:4px;">ALICI &amp; BELGE BİLGİLERİ</div>
            <div><strong>Alıcı:</strong> ${escapeHtml(buyerInfo?.title || 'İşletme Hesabı')}</div>
            ${buyerInfo?.taxId ? `<div><strong>VKN/TCKN:</strong> ${escapeHtml(buyerInfo.taxId)}</div>` : ''}
            <div><strong>Fatura No:</strong> ${escapeHtml(recInv.invoiceNo)}</div>
            <div><strong>Tarih:</strong> ${formatDateTR(recInv.invoiceDate)} · <strong>Durum:</strong> ${escapeHtml(recInv.approvalStatus || 'Onaylandı')}</div>
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="border:1px solid #000000;padding:7px 10px;text-align:left;">Tutar Kalemi</th>
            <th style="border:1px solid #000000;padding:7px 10px;text-align:right;">Tutar (${currency})</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #000000;padding:7px 10px;">Mal / Hizmet Toplam Tutarı (Matrah)</td>
            <td style="border:1px solid #000000;padding:7px 10px;text-align:right;">${formatCurrency(recInv.subtotal, currency)}</td>
          </tr>
          <tr>
            <td style="border:1px solid #000000;padding:7px 10px;">Hesaplanan KDV Toplamı</td>
            <td style="border:1px solid #000000;padding:7px 10px;text-align:right;">${formatCurrency(recInv.vatTotal, currency)}</td>
          </tr>
          <tr style="font-weight:700;">
            <td style="border:1px solid #000000;padding:7px 10px;">Vergiler Dahil Ödenecek Tutar</td>
            <td style="border:1px solid #000000;padding:7px 10px;text-align:right;">${formatCurrency(recInv.grandTotal, currency)}</td>
          </tr>
        </tbody>
      </table>

      <div style="border:1px solid #000000;padding:8px 10px;font-size:10px;">
        <strong>Not:</strong> ${escapeHtml(currencyWordsLabel(recInv.grandTotal, currency))}
      </div>
    </div>
  `;

  await renderHtmlContainerToPdf(html, filename);
}

export async function createETebligatSummaryPdfBlob(
  item: ETebligatItem,
  profile?: BusinessProfile | null
): Promise<{ blob: Blob; fileName: string }> {
  const legalDate = item.legalServedDate || item.sentDate;
  const html = `
    <div style="padding:32px 36px;background:#ffffff;color:#0f172a;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.5;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2.5px solid #0f172a;padding-bottom:14px;margin-bottom:18px;">
        <div>
          <div style="font-size:17px;font-weight:800;color:#0f172a;">ELEKTRONİK TEBLİGAT (e-TEBLİGAT) ÖZET BELGESİ</div>
          <div style="font-size:10.5px;color:#475569;margin-top:3px;">
            213 Sayılı VUK 107/A Maddesi Kapsamında Tebligat Kaydı
          </div>
        </div>
        <div>${buildGibEmblemSvg(60)}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="border:1px solid #cbd5e1;padding:10px 12px;width:50%;vertical-align:top;background:#f8fafc;">
            <div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:4px;">MUHATAP / MÜKELLEF BİLGİLERİ</div>
            <div style="font-weight:700;font-size:12.5px;color:#0f172a;">${escapeHtml(
              profile?.title || 'İşletme Hesabı'
            )}</div>
            ${
              profile?.taxId
                ? `<div style="margin-top:2px;">VKN / TCKN: ${escapeHtml(profile.taxId)}</div>`
                : ''
            }
            ${
              profile?.taxOffice
                ? `<div>Vergi Dairesi: ${escapeHtml(profile.taxOffice)}</div>`
                : ''
            }
          </td>
          <td style="border:1px solid #cbd5e1;padding:10px 12px;width:50%;vertical-align:top;">
            <div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:4px;">GÖNDEREN MAKAM &amp; BELGE NO</div>
            <div style="font-weight:700;color:#0f172a;">${escapeHtml(item.senderUnit)}</div>
            <div style="margin-top:3px;"><strong>Belge / Evrak No:</strong> ${escapeHtml(
              item.documentNo || '-'
            )}</div>
            <div><strong>Kayıt Türü:</strong> ${
              item.source === 'live' ? 'Dijital Vergi Dairesi' : 'Manuel Tebligat Kaydı'
            }</div>
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tbody>
          <tr>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;width:32%;font-weight:700;background:#f8fafc;">Tebligat Konusu</td>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;font-weight:700;">${escapeHtml(
              item.subject
            )}</td>
          </tr>
          <tr>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;font-weight:700;background:#f8fafc;">Elektronik Ortama İletim Tarihi</td>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;">${formatDateTR(
              item.sentDate
            )}</td>
          </tr>
          <tr>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;font-weight:700;background:#f8fafc;">Yasal Tebliğ Tarihi (+5 Gün)</td>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;font-weight:700;">${formatDateTR(
              legalDate
            )}</td>
          </tr>
          <tr>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;font-weight:700;background:#f8fafc;">Okunma Durumu</td>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;">${
              item.isRead
                ? `Okundu${item.readAt ? ` (${escapeHtml(item.readAt)})` : ''}`
                : 'Okunmadı'
            }</td>
          </tr>
          <tr>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;font-weight:700;background:#f8fafc;">Notlar / Açıklama</td>
            <td style="border:1px solid #cbd5e1;padding:8px 12px;white-space:pre-wrap;">${escapeHtml(
              item.notes || 'Kayıtlı ek not bulunmamaktadır.'
            )}</td>
          </tr>
        </tbody>
      </table>

      <div style="border:1px solid #cbd5e1;background:#f8fafc;padding:10px 12px;font-size:10px;color:#334155;">
        <strong>Yasal Bilgilendirme:</strong> 213 sayılı Vergi Usul Kanunu'nun 107/A maddesi uyarınca elektronik ortamda tebligat, muhatabın elektronik adresine ulaştığı tarihi izleyen beşinci günün sonunda yapılmış sayılır.
      </div>
    </div>
  `;

  const pdf = await renderHtmlContainerToPdfInstance(html);
  const blob = pdf.output('blob');
  const cleanName = (item.documentNo || item.tebligatId || 'etebligat')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 48);
  return { blob, fileName: `etebligat-${cleanName}.pdf` };
}
