/**
 * `sage-orbiting-grain` regression — magic-byte image MIME sniff.
 *
 * Pre-fix call sites derived `media_type` purely from `path.extname`. When
 * a screenshot tool wrote JPEG bytes into a `.png`-named file (common
 * scenario), the Anthropic API rejected the message with
 *
 *   400 invalid_request_error
 *   "The image was specified using the image/png media type, but the
 *    image appears to be a image/jpeg image"
 *
 * `detectImageMimeFromBuffer` returns the format derived from the bytes
 * themselves so callers can declare a `media_type` that round-trips
 * through Anthropic's content verifier.
 */

import { describe, it, expect } from 'vitest';
import { detectImageMimeFromBuffer } from '../../src/core/utils/imageMime';

// Minimal magic-byte fixtures — only the signature itself; the payload
// after it is irrelevant for detection.
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  // arbitrary payload after signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG_JFIF_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const JPEG_EXIF_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66,
]);
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46,                          // "RIFF"
  0x24, 0x00, 0x00, 0x00,                          // size placeholder
  0x57, 0x45, 0x42, 0x50,                          // "WEBP"
  0x56, 0x50, 0x38, 0x20,                          // "VP8 " chunk
]);
const GIF87A_HEADER = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00,
]);
const GIF89A_HEADER = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
]);

describe('detectImageMimeFromBuffer — magic-byte MIME sniff', () => {
  it('recognises PNG signature', () => {
    expect(detectImageMimeFromBuffer(PNG_HEADER)).toBe('image/png');
  });

  it('recognises JPEG (JFIF) signature', () => {
    expect(detectImageMimeFromBuffer(JPEG_JFIF_HEADER)).toBe('image/jpeg');
  });

  it('recognises JPEG (Exif) signature', () => {
    expect(detectImageMimeFromBuffer(JPEG_EXIF_HEADER)).toBe('image/jpeg');
  });

  it('recognises WEBP signature (RIFF...WEBP)', () => {
    expect(detectImageMimeFromBuffer(WEBP_HEADER)).toBe('image/webp');
  });

  it('recognises GIF87a signature', () => {
    expect(detectImageMimeFromBuffer(GIF87A_HEADER)).toBe('image/gif');
  });

  it('recognises GIF89a signature', () => {
    expect(detectImageMimeFromBuffer(GIF89A_HEADER)).toBe('image/gif');
  });

  it('returns null for unknown bytes (Anthropic rejection of svg+xml is caller-handled)', () => {
    const unknown = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(detectImageMimeFromBuffer(unknown)).toBeNull();
  });

  it('returns null for short buffers (< 4 bytes)', () => {
    expect(detectImageMimeFromBuffer(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(detectImageMimeFromBuffer(Buffer.from([]))).toBeNull();
  });

  it('returns null when only the JPEG SOI prefix is present (need full 3-byte FF D8 FF)', () => {
    // FF D8 alone (without trailing FF) is incomplete — must be a full
    // 3-byte signature to avoid false positives on arbitrary binary blobs.
    expect(detectImageMimeFromBuffer(Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
  });

  // === Regression: the sage-orbiting-grain failure mode ============
  // The user's handoff folder contained 4 .png-named files whose actual
  // bytes were JPEG. `file(1)` confirmed:
  //   c1-pick-action.png:    JPEG image data, JFIF standard 1.01
  //   c1-pick-action-v2.png: JPEG ...
  //   c1-pick-action-v3.png: JPEG ...
  //   quickstart-light.png:  JPEG ...
  // The sniff MUST return 'image/jpeg' so the caller declares the right
  // media_type and Anthropic accepts the message.
  it('regression: JPEG bytes in a .png-named file are detected as image/jpeg', () => {
    // Mimics what fs.readFileSync would return for the misnamed handoff
    // file (any JPEG header is sufficient).
    expect(detectImageMimeFromBuffer(JPEG_JFIF_HEADER)).toBe('image/jpeg');
    expect(detectImageMimeFromBuffer(JPEG_EXIF_HEADER)).toBe('image/jpeg');
  });
});
