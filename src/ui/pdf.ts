/**
 * Vector PDF built directly from invoice state (not a screenshot): selectable,
 * searchable text, automatic multi-page tables with repeated headers, page
 * numbers, and an embedded Inter subset so ₹, €, £, ¥ etc. render correctly.
 * This module is lazy-loaded on first export.
 */
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import interRegularUrl from '../assets/fonts/Inter-400Regular.ttf?url';
import interBoldUrl from '../assets/fonts/Inter-700Bold.ttf?url';
import type { Totals } from '../core/calc';
import { formatMoney, formatNumber } from '../core/money';
import { companyLine, legalMentionTexts } from '../core/legal';
import { paymentQr } from '../core/payment';
import { DOC_TITLES, VAT_CATEGORIES, effectiveStatus, supplyDate, type InvoiceState } from '../core/state';
import { makeQr } from './qr';
import { parseISODate } from '../core/dates';
import { totalRows } from './sheet';

const PAGE = { w: 595.28, h: 841.89, m: 48 };
const INK = '#0f172a';
const MUTED = '#64748b';
const FAINT = '#94a3b8';
const LINE = '#e2e8f0';

let fontCache: Promise<[string, string]> | null = null;

async function toBase64(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function loadFonts(): Promise<[string, string]> {
  fontCache ??= Promise.all([toBase64(interRegularUrl), toBase64(interBoldUrl)]);
  return fontCache;
}

/** Normalise characters the embedded font subset does not carry (NBSP, narrow NBSP, fullwidth yen). */
function pdfText(s: string): string {
  return s.replace(/[\u00A0\u202F]/g, ' ').replace(/\uFFE5/g, '\u00A5');
}

/** PDF dates stay numeric for CJK locales, since the font subset has no CJK glyphs. */
function pdfDate(iso: string, locale: string): string {
  const d = parseISODate(iso);
  if (!d) return '–';
  const opts: Intl.DateTimeFormatOptions = locale.startsWith('ja')
    ? { year: 'numeric', month: '2-digit', day: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return pdfText(new Intl.DateTimeFormat(locale, opts).format(d));
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = src;
  });
}

export async function buildPdf(state: InvoiceState, totals: Totals): Promise<Blob> {
  const [regular, bold] = await loadFonts();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.addFileToVFS('Inter-Regular.ttf', regular);
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', bold);
  doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
  doc.setFont('Inter', 'normal');

  const { business: b, client: c, meta, notes, style } = state;
  const { currency, locale } = meta;
  const accent = style.accent;
  const money = (minor: number) => pdfText(formatMoney(minor, currency, locale));
  const contentW = PAGE.w - PAGE.m * 2;
  const rightX = PAGE.w - PAGE.m;

  doc.setProperties({
    title: `Invoice ${meta.number}`,
    subject: `Invoice ${meta.number} for ${c.company || c.name}`,
    author: b.name,
    creator: 'SASU Invoice',
  });

  const text = (
    value: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center'; maxW?: number } = {},
  ): number => {
    doc.setFont('Inter', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(opts.color ?? INK);
    const lines: string[] = opts.maxW ? doc.splitTextToSize(pdfText(value), opts.maxW) : [pdfText(value)];
    const lh = (opts.size ?? 10) * 1.4;
    lines.forEach((ln, i) => doc.text(ln, x, y + i * lh, { align: opts.align ?? 'left' }));
    return y + lines.length * lh;
  };

  /** Join parts with bullets, wrapping only between parts. */
  const wrapParts = (parts: string[], size: number, maxW: number): string => {
    doc.setFont('Inter', 'normal');
    doc.setFontSize(size);
    const lines: string[] = [];
    let line = '';
    for (const part of parts.map((p) => pdfText(p.trim())).filter(Boolean)) {
      const next = line ? `${line}  •  ${part}` : part;
      if (line && doc.getTextWidth(next) > maxW) {
        lines.push(line);
        line = part;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  };

  // --- Header: business (left) -------------------------------------------
  let y = PAGE.m;
  if (style.logo) {
    const { w, h } = await imageSize(style.logo);
    const maxH = 48;
    const maxW = 140;
    const s = Math.min(maxW / w, maxH / h);
    let lw = w * s;
    let lh = h * s;
    if (style.logoShape === 'circle') lw = lh = Math.min(lw, lh, maxH);
    const fmt = style.logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
    doc.saveGraphicsState();
    if (style.logoShape === 'circle') {
      doc.circle(PAGE.m + lw / 2, y + lh / 2, lw / 2, null);
      doc.clip();
      doc.discardPath();
    } else if (style.logoShape === 'rounded') {
      doc.roundedRect(PAGE.m, y, lw, lh, 8, 8, null);
      doc.clip();
      doc.discardPath();
    }
    if (style.logoShape === 'circle') {
      // Cover-fit the image into the circle.
      const cover = Math.max(lw / w, lh / h);
      const cw = w * cover;
      const ch = h * cover;
      doc.addImage(style.logo, fmt, PAGE.m + (lw - cw) / 2, y + (lh - ch) / 2, cw, ch);
    } else {
      doc.addImage(style.logo, fmt, PAGE.m, y, lw, lh);
    }
    doc.restoreGraphicsState();
    y += lh + 12;
  }

  const leftW = contentW * 0.55;
  y = text(b.name || 'Your Company Name', PAGE.m, y + 12, { size: 15, bold: true, maxW: leftW });
  if (b.address) y = text(b.address, PAGE.m, y, { size: 9, color: MUTED, maxW: leftW });
  const contact = wrapParts([b.email, b.phone, b.website], 9, leftW);
  if (contact) y = text(contact, PAGE.m, y, { size: 9, color: MUTED, maxW: leftW });
  if (b.taxId) y = text(`Tax ID: ${b.taxId}`, PAGE.m, y, { size: 9, color: MUTED, maxW: leftW });
  const company = companyLine(state);
  if (company) y = text(company, PAGE.m, y, { size: 9, color: MUTED, maxW: leftW });
  const leftBottom = y;

  // --- Header: meta (right) ----------------------------------------------
  let ry = PAGE.m + 20;
  ry = text(DOC_TITLES[state.docType].toUpperCase(), rightX, ry, { size: 22, bold: true, color: accent, align: 'right' });
  ry = text(`#${meta.number}`, rightX, ry, { size: 11, bold: true, color: '#334155', align: 'right' });
  if (state.ref?.number) {
    const refText =
      state.docType === 'credit'
        ? `Credits invoice #${state.ref.number}${state.ref.date ? ` dated ${pdfDate(state.ref.date, locale)}` : ''}`
        : `Based on quote #${state.ref.number}`;
    ry = text(refText, rightX, ry, { size: 8.5, color: MUTED, align: 'right', maxW: 220 });
  }

  const status = effectiveStatus(state);
  const badgeColors: Record<string, [string, string]> = {
    Paid: ['#dcfce7', '#166534'],
    Overdue: ['#fee2e2', '#991b1b'],
    Unpaid: ['#f1f5f9', '#475569'],
    Draft: ['#f1f5f9', '#475569'],
    Cancelled: ['#fee2e2', '#991b1b'],
    Declined: ['#fee2e2', '#991b1b'],
    Expired: ['#fee2e2', '#991b1b'],
    Sent: ['#e0e7ff', '#3730a3'],
    Issued: ['#e0e7ff', '#3730a3'],
    Accepted: ['#dcfce7', '#166534'],
  };
  const [bg, fg] = badgeColors[status] ?? ['#f1f5f9', '#475569'];
  doc.setFont('Inter', 'bold');
  doc.setFontSize(8);
  const bw = doc.getTextWidth(status.toUpperCase()) + 14;
  doc.setFillColor(bg);
  doc.roundedRect(rightX - bw, ry - 4, bw, 16, 3, 3, 'F');
  text(status.toUpperCase(), rightX - 7, ry + 7, { size: 8, bold: true, color: fg, align: 'right' });
  ry += 26;

  const metaRows: [string, string][] = [['Issue date', pdfDate(meta.issueDate, locale)]];
  const supply = supplyDate(state);
  if (supply !== meta.issueDate) metaRows.push(['Supply date', pdfDate(supply, locale)]);
  if (state.docType === 'invoice' || state.docType === 'proforma') metaRows.push(['Due date', pdfDate(meta.dueDate, locale)]);
  if (state.docType === 'quote') metaRows.push(['Valid until', pdfDate(meta.validUntil, locale)]);
  if (meta.poNumber) metaRows.push(['PO number', meta.poNumber]);
  for (const [k, v] of metaRows) {
    text(k, rightX - 170, ry, { size: 9, color: MUTED });
    text(v, rightX, ry, { size: 9, bold: true, align: 'right' });
    ry += 15;
  }

  y = Math.max(leftBottom, ry) + 14;
  doc.setDrawColor(accent);
  doc.setLineWidth(2);
  doc.line(PAGE.m, y, rightX, y);
  y += 26;

  // --- Bill to -----------------------------------------------------------
  y = text('BILL TO', PAGE.m, y, { size: 8, bold: true, color: FAINT });
  y = text(c.name || 'Client Name', PAGE.m, y + 2, { size: 12, bold: true, maxW: leftW });
  for (const line of [
    c.company,
    c.address,
    wrapParts([c.email, c.phone], 9, leftW),
    c.taxId ? `Tax ID: ${c.taxId}` : '',
    c.regNumber ? `Company no.: ${c.regNumber}` : '',
  ]) {
    if (line) y = text(line, PAGE.m, y, { size: 9, color: MUTED, maxW: leftW });
  }
  if (c.deliveryAddress.trim()) {
    y = text('DELIVER TO', PAGE.m, y + 6, { size: 8, bold: true, color: FAINT });
    y = text(c.deliveryAddress, PAGE.m, y, { size: 9, color: MUTED, maxW: leftW });
  }
  y += 16;

  // --- Items table -------------------------------------------------------
  const showTax = state.items.some((i) => i.taxRate !== null);
  const head = ['#', 'Description', 'Qty', 'Rate', ...(showTax ? ['Tax'] : []), 'Amount'];
  const body = state.items.map((item, i) => {
    const line = totals.lines[i];
    const qty = `${formatNumber(line?.qty ?? 0, locale, 3)}${item.unit ? ` ${item.unit}` : ''}`;
    return [
      String(i + 1),
      pdfText(item.desc || 'Item'),
      pdfText(qty),
      money(line?.rateMinor ?? 0),
      ...(showTax ? [`${formatNumber(line?.taxRate ?? 0, locale, 3)}%`] : []),
      money(line?.amountMinor ?? 0),
    ];
  });
  const amountCols = showTax ? [2, 3, 4, 5] : [2, 3, 4];

  // Size numeric columns to their widest value so amounts never wrap.
  const colWidth = (col: number): number => {
    doc.setFont('Inter', 'bold');
    doc.setFontSize(9.5);
    const cells = [head[col] ?? '', ...body.map((r) => r[col] ?? '')];
    return Math.ceil(Math.max(...cells.map((t) => doc.getTextWidth(t)))) + 10;
  };

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    theme: 'plain',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    margin: { left: PAGE.m, right: PAGE.m, top: PAGE.m, bottom: PAGE.m + 20 },
    styles: { font: 'Inter', fontSize: 9.5, textColor: INK, cellPadding: { top: 8, bottom: 8, left: 4, right: 4 }, overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold', textColor: MUTED, fontSize: 8.5, lineWidth: { bottom: 1.5 }, lineColor: LINE },
    bodyStyles: { lineWidth: { bottom: 0.5 }, lineColor: '#f1f5f9' },
    columnStyles: {
      0: { cellWidth: 24, textColor: FAINT },
      1: { cellWidth: 'auto' },
      ...Object.fromEntries(amountCols.map((col) => [col, { halign: 'right' as const, cellWidth: colWidth(col) }])),
    },
    didParseCell: (data) => {
      if (data.section === 'head' && amountCols.includes(data.column.index)) data.cell.styles.halign = 'right';
    },
  });

  const docWithTable = doc as jsPDF & { lastAutoTable?: { finalY?: number } };
  y = (docWithTable.lastAutoTable?.finalY ?? y) + 24;

  // --- VAT breakdown (several rates, or exempt / reverse-charge lines) ----
  if (totals.taxes.length > 1 || totals.taxes.some((x) => x.category !== 'S')) {
    const taxName = state.totals.taxLabel.trim() || 'Tax';
    const catLabel = (code: string) => VAT_CATEGORIES.find((v) => v.code === code)?.label ?? code;
    autoTable(doc, {
      startY: y - 8,
      head: [['Category', 'Rate', 'Taxable', taxName]],
      body: totals.taxes.map((x) => [
        catLabel(x.category),
        `${formatNumber(x.rate, locale, 3)}%`,
        money(x.baseMinor),
        money(x.amountMinor),
      ]),
      theme: 'plain',
      rowPageBreak: 'avoid',
      margin: { left: PAGE.w / 2 - 20, right: PAGE.m },
      styles: { font: 'Inter', fontSize: 8.5, textColor: '#475569', cellPadding: { top: 4, bottom: 4, left: 4, right: 4 } },
      headStyles: { fontStyle: 'bold', textColor: MUTED, lineWidth: { bottom: 0.75 }, lineColor: LINE },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      didParseCell: (data) => {
        if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right';
      },
    });
    y = (docWithTable.lastAutoTable?.finalY ?? y) + 22;
  }

  // --- Totals + notes ----------------------------------------------------
  const rows = totalRows(state, totals);
  const totalsW = 220;
  const totalsX = rightX - totalsW;
  const notesW = contentW - totalsW - 28;

  const measure = (value: string, size: number, w: number) =>
    (doc.setFontSize(size), doc.splitTextToSize(pdfText(value), w).length * size * 1.4);
  let notesH = 0;
  if (notes.paymentTerms) notesH += measure(notes.paymentTerms, 9, notesW) + 4;
  if (notes.notes) notesH += measure(notes.notes, 9, notesW) + 10;
  if (notes.bankDetails) notesH += measure(notes.bankDetails, 8.5, notesW - 20) + 30;
  const qr = paymentQr(state, totals);
  const qrOk = qr && !('error' in qr) ? qr : null;
  if (qrOk) notesH += 92;
  const totalsH = rows.length * 18 + 30;
  const footerH = notes.footer ? measure(notes.footer, 9, contentW) + 30 : 0;
  const needed = Math.max(notesH, totalsH) + footerH;
  if (y + needed > PAGE.h - PAGE.m - 20) {
    doc.addPage();
    y = PAGE.m;
  }

  // Totals box
  doc.setFillColor('#f8fafc');
  doc.roundedRect(totalsX, y, totalsW, totalsH, 6, 6, 'F');
  let ty = y + 20;
  for (const r of rows) {
    const strong = r.kind === 'grand' || r.kind === 'balance';
    if (strong) {
      doc.setDrawColor(LINE);
      doc.setLineWidth(1);
      doc.line(totalsX + 14, ty - 12, rightX - 14, ty - 12);
      ty += 4;
    }
    const color = strong ? accent : r.kind === 'discount' ? '#059669' : MUTED;
    text(r.label, totalsX + 14, ty, { size: strong ? 10.5 : 9, bold: strong, color });
    text(r.value, rightX - 14, ty, { size: strong ? 11 : 9, bold: strong, color: strong ? accent : INK, align: 'right' });
    ty += 18;
  }

  // Notes column
  let ny = y + 8;
  if (notes.paymentTerms) ny = text(notes.paymentTerms, PAGE.m, ny, { size: 9, bold: true, maxW: notesW }) + 4;
  if (notes.notes) ny = text(notes.notes, PAGE.m, ny, { size: 9, color: MUTED, maxW: notesW }) + 10;
  if (notes.bankDetails) {
    const bh = measure(notes.bankDetails, 8.5, notesW - 20) + 16;
    doc.setFillColor('#f8fafc');
    doc.setDrawColor(LINE);
    doc.setLineWidth(0.75);
    doc.roundedRect(PAGE.m, ny, notesW, bh, 4, 4, 'FD');
    ny = text(notes.bankDetails, PAGE.m + 10, ny + 16, { size: 8.5, color: '#475569', maxW: notesW - 20 });
  }

  // Payment QR, drawn as vector modules
  if (qrOk) {
    const m = makeQr(qrOk.payload);
    const box = 76;
    const cell = box / m.size;
    const qy = ny + 6;
    doc.setFillColor('#0f172a');
    for (let r = 0; r < m.size; r++) {
      for (let c2 = 0; c2 < m.size; c2++) {
        if (m.isDark(r, c2)) doc.rect(PAGE.m + c2 * cell, qy + r * cell, cell + 0.05, cell + 0.05, 'F');
      }
    }
    text(qrOk.caption, PAGE.m + box + 12, qy + 26, { size: 9, bold: true, maxW: notesW - box - 12 });
    text(qrOk.detail, PAGE.m + box + 12, qy + 40, { size: 8, color: MUTED, maxW: notesW - box - 12 });
    ny = qy + box + 8;
  }

  let endY = Math.max(ny, y + totalsH);
  const legal = legalMentionTexts(state);
  if (legal.length) {
    const lh = legal.reduce((h, t) => h + measure(t, 8, contentW) + 4, 0) + 20;
    if (endY + lh > PAGE.h - PAGE.m - 20) {
      doc.addPage();
      endY = PAGE.m;
    }
    let ly = endY + 24;
    doc.setDrawColor(LINE);
    doc.setLineWidth(0.5);
    doc.line(PAGE.m, ly - 12, rightX, ly - 12);
    for (const t of legal) ly = text(t, PAGE.m, ly, { size: 8, color: MUTED, maxW: contentW }) + 4;
    endY = ly;
  }

  if (notes.footer) {
    text(notes.footer, PAGE.w / 2, endY + 30, { size: 9, bold: true, color: FAINT, align: 'center', maxW: contentW });
  }

  // --- Page numbers ------------------------------------------------------
  const pages = doc.getNumberOfPages();
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      text(`${meta.number} · Page ${p} of ${pages}`, PAGE.w / 2, PAGE.h - PAGE.m / 2, {
        size: 8,
        color: FAINT,
        align: 'center',
      });
    }
  }

  return doc.output('blob');
}
