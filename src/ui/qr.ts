/**
 * QR code rendering. The matrix comes from qrcode-generator (ECC level M);
 * we draw it ourselves as an SVG path for the sheet and as vector rectangles
 * for the PDF, so no markup strings or bitmaps are involved.
 */
import qrcode from 'qrcode-generator';

export interface QrMatrix {
  size: number;
  isDark(row: number, col: number): boolean;
}

export function makeQr(payload: string): QrMatrix {
  // qrcode-generator's byte mode keeps only the low 8 bits of each char, so
  // pre-encode as UTF-8 and pass one char per byte.
  const binary = String.fromCharCode(...new TextEncoder().encode(payload));
  const qr = qrcode(0, 'M');
  qr.addData(binary, 'Byte');
  qr.make();
  return { size: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An SVG element (built with createElementNS) with a 4-module quiet zone. */
export function qrSvg(payload: string, px: number, label: string): SVGSVGElement {
  const m = makeQr(payload);
  const quiet = 4;
  const dim = m.size + quiet * 2;
  let d = '';
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(dim));
  bg.setAttribute('height', String(dim));
  bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#0f172a');
  svg.append(bg, path);
  return svg;
}
