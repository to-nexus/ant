import * as fs from 'fs';
import * as path from 'path';
import { unlinkContained, writeBufferContained } from '../config/containedIo';
import { isBinaryPath } from './binaryExtensions';

const CORRUPTION_SNIFF_BYTES = 8000;

/**
 * A supplied file is itself corrupt (not a transport/disk failure). Routes map
 * this to HTTP 422 — the caller must supply an intact file; retrying the same
 * bytes cannot succeed.
 */
export class CorruptedFileError extends Error {
  readonly code = 'CORRUPTED_FILE' as const;
  readonly filename: string;
  readonly reason: string;

  constructor(filename: string, reason: string) {
    super(`${filename} is corrupted and was not saved: ${reason}`);
    this.filename = filename;
    this.reason = reason;
  }
}

/**
 * Pre-write verdict on a supplied binary buffer — pure, so callers can
 * validate an ENTIRE batch before writing anything (partial writes would
 * leave a half-ingested upload behind). Returns a defect reason or null.
 *
 * Two signals, both keyed on a known-binary extension:
 *   - container header, where the format declares its own length (GLB);
 *   - U+FFFD saturation, the fingerprint of a utf-8 decode→re-encode round
 *     trip. Real binary payloads do not contain the 3-byte EF BF BD sequence
 *     8+ times in their head window; a mojibake'd one is riddled with it.
 *     This generalizes the protection to every binary format, not just GLB.
 */
export function verifyBufferIntegrity(filePathOrName: string, content: Buffer): string | null {
  if (!isBinaryPath(filePathOrName)) return null;
  const headerDefect = findGlbHeaderDefect(filePathOrName, content);
  if (headerDefect) return headerDefect;
  if (looksUtf8Corrupted(content.subarray(0, CORRUPTION_SNIFF_BYTES))) {
    return 'utf-8 round-trip corruption (U+FFFD saturation) — the bytes were decoded as text and re-encoded, which is irreversible';
  }
  return null;
}

/**
 * Byte-safe write core for binary ingest (upload route, download_asset).
 * Verifies the supplied bytes (see `verifyBufferIntegrity`) and the written
 * byte count — a poisoned asset pool fails loudly here instead of at app
 * runtime. Callers handling batches should pre-validate with
 * `verifyBufferIntegrity` so a late defect does not leave earlier files written.
 *
 * `root` is the containment boundary and is REQUIRED: the write descends from it
 * one component at a time (see `core/config/containedIo`), so neither a symlink
 * planted on the leaf nor an intermediate directory swapped after the caller's
 * own check can redirect the bytes out of the boundary (H-007, M-NEW-003). A
 * boundary the caller must name is what stops the next call site from inheriting
 * an implicit one.
 */
export async function writeBufferVerified(
  root: string,
  relPath: string,
  content: Buffer,
): Promise<void> {
  const supplied = verifyBufferIntegrity(relPath, content);
  if (supplied) throw new CorruptedFileError(path.basename(relPath), supplied);

  const result = writeBufferContained(root, relPath, content);
  if (!result.ok) {
    throw new Error(
      `Cannot write ${path.basename(relPath)}: destination is outside the allowed boundary (${result.reason})`,
    );
  }

  if (result.written !== content.length) {
    unlinkContained(root, relPath);
    throw new Error(
      `File integrity check failed for ${path.basename(relPath)}: wrote ${result.written} bytes, expected ${content.length}`,
    );
  }
}

/**
 * Absolute-path form for callers that already hold `(root, absolutePath)` — it
 * only converts to the relative form the contained writer needs. Kept thin and
 * separate so the boundary argument is never optional.
 */
export async function writeBufferVerifiedAbs(
  root: string,
  absolutePath: string,
  content: Buffer,
): Promise<void> {
  return writeBufferVerified(root, path.relative(path.resolve(root), absolutePath), content);
}

/**
 * GLB container check (binary glTF): magic 'glTF' + declared total length
 * (uint32 LE at offset 8) must equal the byte size. Catches utf-8-mojibake
 * corruption (U+FFFD round-trip) that inflates the payload past the header.
 */
export function findGlbHeaderDefect(fullPath: string, content: Buffer): string | null {
  if (!fullPath.toLowerCase().endsWith('.glb')) return null;
  if (content.length < 12) return 'GLB shorter than 12-byte header';
  if (content.toString('latin1', 0, 4) !== 'glTF') return 'missing glTF magic';
  const declared = content.readUInt32LE(8);
  if (declared !== content.length) {
    return `GLB declared length ${declared} != actual size ${content.length} (corrupted binary)`;
  }
  return null;
}

/**
 * Detects a binary file destroyed by a utf-8 decode→re-encode round trip:
 * the result is VALID utf-8 (so the NUL/validity sniff calls it "text")
 * but is saturated with U+FFFD replacement characters (EF BF BD). Real
 * text files essentially never contain U+FFFD; a handful is enough signal.
 */
export function looksUtf8Corrupted(head: Buffer): boolean {
  let replacementCount = 0;
  for (let i = 0; i + 2 < head.length; i++) {
    if (head[i] === 0xef && head[i + 1] === 0xbf && head[i + 2] === 0xbd) {
      replacementCount++;
      if (replacementCount >= 8) return true;
      i += 2;
    }
  }
  return false;
}

/**
 * On-disk corruption verdict for a known-binary-extension file. Returns a
 * human-readable defect reason, or null when the file looks intact (or is
 * not a known binary extension / not readable).
 *
 * NOTE: a utf-8 round trip PRESERVES NUL bytes (0x00 is valid utf-8), so a
 * mojibake'd binary still sniffs as "binary" — the corruption signal is
 * U+FFFD saturation (and for GLB, the header length mismatch), never the
 * NUL/text sniff.
 */
export function sniffCorruptedBinary(absPath: string): string | null {
  if (!isBinaryPath(absPath)) return null;
  let fd: number;
  try {
    fd = fs.openSync(absPath, 'r');
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    const len = Math.min(Number(stat.size), CORRUPTION_SNIFF_BYTES);
    const buf = Buffer.alloc(len);
    const read = fs.readSync(fd, buf, 0, len, 0);
    const head = buf.subarray(0, read);
    if (looksUtf8Corrupted(head)) return 'utf-8 round-trip corruption (U+FFFD saturation)';
    if (absPath.toLowerCase().endsWith('.glb') && head.length >= 12) {
      if (head.toString('latin1', 0, 4) !== 'glTF') return 'missing glTF magic';
      const declared = head.readUInt32LE(8);
      if (declared !== Number(stat.size)) {
        return `GLB declared length ${declared} != file size ${stat.size}`;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}
