/**
 * Shared binary/text classifier.
 *
 * Policy: "can this file be safely read as utf-8 text?"
 *
 * Two tiers:
 *   - `isBinaryPath` — zero-I/O fast-path over a KNOWN-binary extension set.
 *     The set is a hint, never an authority: absence of an extension here
 *     means "unknown", not "text".
 *   - `isBinaryFileSync` / `isBinaryBuffer` — content sniff (git heuristic:
 *     NUL byte in the head window, plus utf-8 validity). This is the SSOT
 *     verdict for paths the extension set doesn't recognize, so novel asset
 *     formats (.glb, .fbx, .ogg, …) classify correctly without anyone
 *     remembering to grow a whitelist.
 *
 * Current consumers:
 *   - `agents/common/tool/handlers/readFile.ts` — short-circuits the
 *     read_file tool with a "binary file, reference by path" message.
 *   - `agents/common/graph/loadDocumentsForRAC.ts` — classifies stub-loaded
 *     entries (handoff bundles + asset pools) for stub rendering
 *     (read-on-demand vs path-only reference).
 *
 * Intentional divergence: `combineCodeContext.ts` uses a BROADER exclusion
 * set (adds `.svg`, `.br`, `.zst`) for the verification fast-path — that set
 * answers a different question ("what non-code assets should the verifier
 * ignore when listing codebase paths?") and is deliberately not unified here.
 */

import * as fs from 'fs';

export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.tif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flv',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.sqlite', '.db', '.wasm',
]);

export function isBinaryPath(filePath: string): boolean {
  const i = filePath.lastIndexOf('.');
  if (i < 0) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(i).toLowerCase());
}

/** Head window for content sniffing (git uses the same 8000-byte heuristic). */
const SNIFF_BYTES = 8000;

/**
 * Content-based binary verdict over a head window.
 *
 * @param head head bytes of the file (up to SNIFF_BYTES)
 * @param truncatedTail true when `head` is a prefix of a larger file — the
 *   sniff window may then cut a multi-byte utf-8 sequence, so a truncated
 *   tail sequence is trimmed before validity checking instead of counting
 *   as invalid.
 */
export function isBinaryBuffer(head: Buffer, truncatedTail = false): boolean {
  if (head.length === 0) return false;
  for (const b of head) {
    if (b === 0) return true;
  }
  let end = head.length;
  if (truncatedTail) {
    // Drop up to 3 trailing continuation bytes (0b10xxxxxx), then a dangling
    // lead byte — a sequence cut by the window must not fake invalidity.
    let cont = 0;
    while (end > 0 && cont < 3 && (head[end - 1]! & 0xc0) === 0x80) {
      end--;
      cont++;
    }
    if (end > 0 && (head[end - 1]! & 0xc0) === 0xc0) end--;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, end));
    return false;
  } catch {
    return true;
  }
}

/**
 * SSOT binary verdict for an on-disk file: extension fast-path, then content
 * sniff. Unreadable paths return false so callers fall through to their
 * canonical not-found / permission error handling instead of a misleading
 * "binary file" message.
 */
export function isBinaryFileSync(absPath: string): boolean {
  if (isBinaryPath(absPath)) return true;
  let fd: number;
  try {
    fd = fs.openSync(absPath, 'r');
  } catch {
    return false;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return false;
    const len = Math.min(Number(stat.size), SNIFF_BYTES);
    const buf = Buffer.alloc(len);
    const read = fs.readSync(fd, buf, 0, len, 0);
    return isBinaryBuffer(buf.subarray(0, read), Number(stat.size) > read);
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}
