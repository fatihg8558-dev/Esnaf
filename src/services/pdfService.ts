import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import type { Account, CurrencyCode, Invoice } from '../types';
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

export function buildDeterministicQrSvg(seedText: string, size = 84): string {
  const grid = 25;
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
      else if (r >= grid - 9 && r <= grid - 5 && c >= grid - 9 && c <= grid - 5) {
        const ar = r - (grid - 9);
        const ac = c - (grid - 9);
        dark = ar === 0 || ar === 4 || ac === 0 || ac === 4 || (ar === 2 && ac === 2);
      } else {
        h ^= (r * 37 + c * 19 + 11) & 0xff;
        h = Math.imul(h, 16777619);
        dark = ((h >>> 24) & 1) === 1;
      }
      if (dark) {
        rects.push(
          `<rect x="${(c * cell).toFixed(2)}" y="${(r * cell).toFixed(2)}" width="${(
            cell + 0.2
          ).toFixed(2)}" height="${(cell + 0.2).toFixed(2)}" fill="#000000"/>`
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;background:#ffffff;padding:2px;">${rects.join(
    ''
  )}</svg>`;
}

/**
 * Official-style circular GİB / T.C. Hazine ve Maliye Bakanlığı e-Arşiv Emblem
 */
export function buildGibEmblemSvg(size = 76): string {
  const starPoints = Array.from({ length: 16 })
    .map((_, i) => {
      const angle = (i * 22.5 - 90) * (Math.PI / 180);
      const cx = 50 + 40 * Math.cos(angle);
      const cy = 50 + 40 * Math.sin(angle);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1.45" fill="#ffffff"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" style="display:block;">
    <circle cx="50" cy="50" r="47" fill="#c8102e" stroke="#8b0015" stroke-width="1.5"/>
    <circle cx="50" cy="50" r="44.5" fill="none" stroke="#ffffff" stroke-width="0.9"/>
    ${starPoints}
    <circle cx="50" cy="50" r="34" fill="#ffffff" stroke="#c8102e" stroke-width="1.4"/>
    <circle cx="50" cy="50" r="31.5" fill="none" stroke="#111111" stroke-width="0.7"/>
    <!-- Stylized crescent + star at top inside crest -->
    <circle cx="48.5" cy="28" r="5.5" fill="#c8102e"/>
    <circle cx="50.4" cy="28" r="4.3" fill="#ffffff"/>
    <polygon points="56,28 53.7,29.1 54.3,26.6 52.5,24.9 55,24.6 56,22.3 57,24.6 59.5,24.9 57.7,26.6 58.3,29.1" fill="#c8102e"/>
    <!-- Official GİB Typography -->
    <text x="50" y="51" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="900" letter-spacing="1" fill="#111111">GİB</text>
    <line x1="25" y1="56" x2="75" y2="56" stroke="#c8102e" stroke-width="1.2"/>
    <text x="50" y="65" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="6.4" font-weight="700" fill="#111111">GELİR İDARESİ</text>
    <text x="50" y="73" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="6.4" font-weight="700" fill="#111111">BAŞKANLIĞI</text>
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

function formatGibAmount(value: number, currency: CurrencyCode): string {
  const formatted = formatNumberTR(value, 2);
  if (currency === 'TRY') return `${formatted} TL`;
  if (currency === 'USD') return `${formatted} USD`;
  if (currency === 'EUR') return `${formatted} EUR`;
  return `${formatted} GBP`;
}

async function renderHtmlContainerToPdf(html: string, filename: string): Promise<void> {
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

    pdf.save(filename);
  } finally {
    document.body.removeChild(wrapper);
  }
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
  const sellerTaxId = invoice.sellerTaxId || sellerFallback?.taxId || '-';
  const sellerTaxOffice = invoice.sellerTaxOffice || sellerFallback?.taxOffice || '-';
  const sellerAddress = invoice.sellerAddress || sellerFallback?.address || '-';
  const sellerLoc = [sellerFallback?.district, sellerFallback?.city].filter(Boolean).join(' / ');

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
    82
  );
  const emblemSvg = buildGibEmblemSvg(76);
  const tlEquivalent =
    currency !== 'TRY' && exchangeRate > 0
      ? Math.round(invoice.grandTotal * exchangeRate * 100) / 100
      : null;

  const gibDate = formatGibDashDate(invoice.invoiceDate);
  const gibTime = escapeHtml(invoice.invoiceTime || '00:00:00');
  const invoiceTypeCode = invoice.invoiceType === 'IADE' ? 'IADE' : 'SATIS';

  const itemRows = invoice.items
    .map(
      (item, idx) => `
      <tr>
        <td style="border:1px solid #000000;padding:4px 5px;text-align:center;">${idx + 1}</td>
        <td style="border:1px solid #000000;padding:4px 6px;text-align:left;color:#000000;">${escapeHtml(
          item.name
        )}</td>
        <td style="border:1px solid #000000;padding:4px 5px;text-align:right;white-space:nowrap;">${formatNumberTR(
          item.quantity,
          2
        )} ${escapeHtml(item.unit)}</td>
        <td style="border:1px solid #000000;padding:4px 5px;text-align:right;white-space:nowrap;">${formatGibAmount(
          item.unitPrice,
          currency
        )}</td>
        <td style="border:1px solid #000000;padding:4px 5px;text-align:right;white-space:nowrap;">%0,00</td>
        <td style="border:1px solid #000000;padding:4px 5px;text-align:right;white-space:nowrap;">${formatGibAmount(
          0,
          currency
        )}</td>
        <td style="border:1px solid #000000;padding:4px 5px;text-align:right;white-space:nowrap;">%${
          item.vatRate
        }</td>
        <td style="border:1px solid #000000;padding:4px 5px;text-align:right;white-space:nowrap;">${formatGibAmount(
          item.lineVat,
          currency
        )}</td>
        <td style="border:1px solid #000000;padding:4px 5px;text-align:right;white-space:nowrap;">${formatGibAmount(
          0,
          currency
        )}</td>
        <td style="border:1px solid #000000;padding:4px 6px;text-align:right;font-weight:700;white-space:nowrap;">${formatGibAmount(
          item.lineSubtotal,
          currency
        )}</td>
      </tr>
    `
    )
    .join('');

  const vatRows = Object.entries(vatBreakdown)
    .map(
      ([rate, vals]) => `
      <tr>
        <td style="border:1px solid #000000;padding:4px 7px;text-align:left;font-weight:700;">Hesaplanan KDV(%${escapeHtml(
          rate
        )})</td>
        <td style="border:1px solid #000000;padding:4px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
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
    <div style="padding:26px 30px;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.38;">
      <!-- Top 3-Column Official GİB e-Arşiv XSLT Header -->
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <tr>
          <!-- Left Column: Seller + SAYIN (Recipient) -->
          <td style="width:42%;vertical-align:top;padding-right:10px;">
            <div style="border-top:2px solid #000000;border-bottom:2px solid #000000;padding:7px 2px;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#000000;margin-bottom:3px;">${escapeHtml(
                sellerTitle
              )}</div>
              <div style="color:#000000;">${escapeHtml(sellerAddress)}</div>
              ${sellerLoc ? `<div style="color:#000000;">${escapeHtml(sellerLoc)}</div>` : ''}
              <div style="color:#000000;margin-top:2px;">Vergi Dairesi: ${escapeHtml(
                sellerTaxOffice
              )}</div>
              <div style="color:#000000;margin-top:1px;">VKN/TCKN: ${escapeHtml(
                sellerTaxId
              )}</div>
            </div>

            <div style="height:24px;"></div>

            <div style="border-top:2px solid #000000;border-bottom:2px solid #000000;padding:7px 2px;">
              <div style="font-size:10.5px;font-weight:700;color:#000000;margin-bottom:3px;">SAYIN</div>
              <div style="font-size:10.5px;font-weight:700;color:#000000;margin-bottom:2px;">${escapeHtml(
                invoice.recipientName
              )}</div>
              ${
                invoice.recipientAddress
                  ? `<div style="color:#000000;">${escapeHtml(invoice.recipientAddress)}</div>`
                  : ''
              }
              ${
                invoice.recipientDistrict || invoice.recipientCity
                  ? `<div style="color:#000000;">${escapeHtml(
                      [invoice.recipientDistrict, invoice.recipientCity].filter(Boolean).join(' / ')
                    )}</div>`
                  : ''
              }
              <div style="color:#000000;margin-top:2px;">Vergi Dairesi: ${escapeHtml(
                invoice.recipientTaxOffice || '-'
              )}</div>
              <div style="color:#000000;margin-top:1px;">VKN/TCKN: ${escapeHtml(
                invoice.recipientTaxId
              )}</div>
            </div>
          </td>

          <!-- Center Column: GİB Emblem + e-ARŞİV FATURA + QR Code -->
          <td style="width:23%;vertical-align:top;text-align:center;padding:2px 6px;">
            <div style="display:inline-block;margin-top:2px;">${emblemSvg}</div>
            <div style="font-size:11.5px;font-weight:700;color:#000000;margin-top:8px;letter-spacing:0.3px;">
              e-ARŞİV FATURA
            </div>
            <div style="margin-top:18px;display:inline-block;">${qrSvg}</div>
            <div style="font-size:8.5px;font-weight:700;color:#000000;margin-top:4px;">
              ${
                isApproved
                  ? 'e-Arşiv İmzalı'
                  : isCancelled
                  ? 'İPTAL EDİLMİŞTİR'
                  : 'TASLAK / ÖN İZLEME'
              }
            </div>
          </td>

          <!-- Right Column: Metadata Grid -->
          <td style="width:35%;vertical-align:top;padding-left:8px;">
            <table style="width:100%;border-collapse:collapse;font-size:9.5px;">
              <tr>
                <td style="border:1px solid #000000;padding:4px 6px;font-weight:700;width:48%;background:#ffffff;">Özelleştirme No:</td>
                <td style="border:1px solid #000000;padding:4px 6px;">TR1.2</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:4px 6px;font-weight:700;background:#ffffff;">Senaryo:</td>
                <td style="border:1px solid #000000;padding:4px 6px;">EARSIVFATURA</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:4px 6px;font-weight:700;background:#ffffff;">Fatura Tipi:</td>
                <td style="border:1px solid #000000;padding:4px 6px;">${invoiceTypeCode}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:4px 6px;font-weight:700;background:#ffffff;">Fatura No:</td>
                <td style="border:1px solid #000000;padding:4px 6px;font-weight:700;">${escapeHtml(
                  invoice.invoiceNo
                )}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:4px 6px;font-weight:700;background:#ffffff;">Fatura Tarihi:</td>
                <td style="border:1px solid #000000;padding:4px 6px;">${gibDate}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:4px 6px;font-weight:700;background:#ffffff;">Düzenleme Tarihi:</td>
                <td style="border:1px solid #000000;padding:4px 6px;">${gibDate}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:4px 6px;font-weight:700;background:#ffffff;">Düzenleme Zamanı:</td>
                <td style="border:1px solid #000000;padding:4px 6px;">${gibTime}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- ETTN Line -->
      <table style="width:100%;border-collapse:collapse;margin-top:12px;margin-bottom:6px;font-size:9.5px;">
        <tr>
          <td style="text-align:left;padding:2px 0;color:#000000;">
            <strong>ETTN:</strong> ${escapeHtml(invoice.ettn)}
          </td>
          <td style="text-align:right;padding:2px 0;color:#000000;">
            <strong>Para Birimi:</strong> ${currency}${
              currency !== 'TRY' ? ` &nbsp;|&nbsp; <strong>Kur:</strong> ${formatNumberTR(exchangeRate, 4)} TL` : ''
            }
          </td>
        </tr>
      </table>

      <!-- Official 10-Column Line Items Table -->
      <table style="width:100%;border-collapse:collapse;font-size:9px;">
        <thead>
          <tr style="background:#ededed;color:#000000;">
            <th style="border:1px solid #000000;padding:5px 4px;text-align:center;font-weight:700;">Sıra No</th>
            <th style="border:1px solid #000000;padding:5px 6px;text-align:left;font-weight:700;">Mal Hizmet</th>
            <th style="border:1px solid #000000;padding:5px 4px;text-align:right;font-weight:700;">Miktar</th>
            <th style="border:1px solid #000000;padding:5px 4px;text-align:right;font-weight:700;">Birim Fiyat</th>
            <th style="border:1px solid #000000;padding:5px 4px;text-align:right;font-weight:700;">İskonto Oranı</th>
            <th style="border:1px solid #000000;padding:5px 4px;text-align:right;font-weight:700;">İskonto Tutarı</th>
            <th style="border:1px solid #000000;padding:5px 4px;text-align:right;font-weight:700;">KDV Oranı</th>
            <th style="border:1px solid #000000;padding:5px 4px;text-align:right;font-weight:700;">KDV Tutarı</th>
            <th style="border:1px solid #000000;padding:5px 4px;text-align:right;font-weight:700;">Diğer Vergiler</th>
            <th style="border:1px solid #000000;padding:5px 6px;text-align:right;font-weight:700;">Mal Hizmet Tutarı</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <!-- Right-Aligned Totals Table (Official White/Monochrome Grid) -->
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <tr>
          <td style="width:54%;"></td>
          <td style="width:46%;vertical-align:top;">
            <table style="width:100%;border-collapse:collapse;font-size:9.5px;">
              <tr>
                <td style="border:1px solid #000000;padding:4px 7px;text-align:left;font-weight:700;">Mal Hizmet Toplam Tutarı</td>
                <td style="border:1px solid #000000;padding:4px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
                  invoice.subtotal,
                  currency
                )}</td>
              </tr>
              <tr>
                <td style="border:1px solid #000000;padding:4px 7px;text-align:left;font-weight:700;">Toplam İskonto</td>
                <td style="border:1px solid #000000;padding:4px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
                  0,
                  currency
                )}</td>
              </tr>
              ${vatRows}
              <tr>
                <td style="border:1px solid #000000;padding:4px 7px;text-align:left;font-weight:700;">Vergiler Dahil Toplam Tutar</td>
                <td style="border:1px solid #000000;padding:4px 7px;text-align:right;white-space:nowrap;">${formatGibAmount(
                  invoice.grandTotal,
                  currency
                )}</td>
              </tr>
              <tr style="background:#f5f5f5;">
                <td style="border:1px solid #000000;padding:5px 7px;text-align:left;font-weight:700;">Ödenecek Tutar</td>
                <td style="border:1px solid #000000;padding:5px 7px;text-align:right;font-weight:700;white-space:nowrap;">${formatGibAmount(
                  invoice.grandTotal,
                  currency
                )}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Bottom Notes Box (Full Width, Crisp Black Border) -->
      <div style="margin-top:14px;border:1px solid #000000;padding:8px 10px;font-size:9.5px;color:#000000;line-height:1.5;">
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
