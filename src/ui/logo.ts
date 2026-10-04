/**
 * Logo upload hardening: accept only PNG/JPEG/WebP (checked by magic bytes, not
 * just the browser-reported MIME type), cap the size, and re-encode through a
 * canvas. Re-encoding strips EXIF/metadata and any polyglot payload, and
 * bounds the stored size.
 */
import { MAX_LOGO_CHARS } from '../core/validate';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 600;

type Kind = 'png' | 'jpeg' | 'webp';

export async function sniffImage(file: Blob): Promise<Kind | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

export class LogoError extends Error {}

export async function processLogo(file: File): Promise<string> {
  if (file.size > MAX_LOGO_BYTES) throw new LogoError('Logo must be 2 MB or smaller.');
  const kind = await sniffImage(file);
  if (!kind) throw new LogoError('Logo must be a PNG, JPEG or WebP image.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new LogoError('That image could not be read.');
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new LogoError('Your browser could not process the image.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // JPEGs have no transparency, so keep them as JPEG (smaller); others → PNG.
  const out =
    kind === 'jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  if (out.length > MAX_LOGO_CHARS) throw new LogoError('Logo is too detailed; try a smaller image.');
  return out;
}
