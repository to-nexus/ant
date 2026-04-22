/**
 * Shared extension-based binary/text classifier.
 *
 * Policy: "can this file be safely read as utf-8 text?"
 *   - `true`  = extension is known-binary, utf-8 read would produce garbage.
 *   - `false` = SVG / JSON / HTML / MD / TS / CSS / etc. (including structured text).
 *
 * Current consumers:
 *   - `agents/common/tool/handlers/readFile.ts` — short-circuits the
 *     read_file tool with a "binary file, reference by path" message.
 *   - `agents/common/graph/loadDocumentsForRAC.ts` — classifies handoff
 *     bundle entries for stub rendering (read vs path-only reference).
 *
 * Intentional divergence: `combineCodeContext.ts` uses a BROADER exclusion
 * set (adds `.svg`, `.br`, `.zst`) for the verification fast-path — that set
 * answers a different question ("what non-code assets should the verifier
 * ignore when listing codebase paths?") and is deliberately not unified here.
 */

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
