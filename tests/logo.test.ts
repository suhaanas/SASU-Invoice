import { describe, expect, it } from 'vitest';
import { sniffImage } from '../src/ui/logo';

const blob = (bytes: number[] | string) =>
  new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)]);

describe('logo sniffing', () => {
  it('recognises PNG, JPEG and WebP by magic bytes', async () => {
    expect(await sniffImage(blob([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(await sniffImage(blob([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(await sniffImage(blob('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('webp');
  });

  it('rejects SVG and other files regardless of name or MIME type', async () => {
    expect(await sniffImage(blob('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
    expect(await sniffImage(blob('GIF89a'))).toBeNull();
    expect(await sniffImage(blob([]))).toBeNull();
  });
});
