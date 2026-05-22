/**
 * Detect an image's MIME type from its raw bytes (magic-byte sniff) so
 * call sites that attach base64 images to LLM messages do NOT trust the
 * file extension. The Anthropic API verifies declared `media_type` against
 * the actual base64 content and rejects mismatches with
 * `invalid_request_error` (e.g. a `.png`-named file that is actually JPEG
 * — see the `sage-orbiting-grain` RCA).
 *
 * Only the four binary signatures Anthropic accepts (`image/png`,
 * `image/jpeg`, `image/webp`, `image/gif`) are returned. Text-format
 * containers (SVG) have no binary signature; callers must fall back to
 * the file extension when this helper returns `null` AND they explicitly
 * want to attach SVG.
 */

export type AnthropicImageMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif';

export function detectImageMimeFromBuffer(buf: Buffer): AnthropicImageMime | null {
  if (!buf || buf.length < 4) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A (8 bytes)
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF (3 bytes — JFIF / Exif both start the same way)
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }

  // WEBP: "RIFF" (4) + size (4) + "WEBP" (4) = 12 bytes total
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }

  // GIF: "GIF87a" or "GIF89a" (6 bytes)
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return 'image/gif';
  }

  return null;
}
