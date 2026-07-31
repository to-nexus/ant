/**
 * Known-binary extension set — shared by BE gates (HTTP file API, agent
 * string-write tools) and FE routing (editor vs binary info panel).
 *
 * The set is a hint, never an authority: absence here means "unknown", not
 * "text". Content sniffing (ant-cli `binaryExtensions.ts` — NUL byte +
 * utf-8 validity) remains the SSOT verdict for unknown extensions.
 *
 * Deliberately EXCLUDED text formats (do not add):
 *   - `.svg`  — text-editable XML; the FE editor legitimately opens it.
 *   - `.gltf` — JSON glTF variant; agents may legitimately read/author it.
 *   - `.obj`  — Wavefront text format.
 * Real binary content behind those extensions is still caught by the
 * content sniff at the BE gates.
 */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.tif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flv',
  '.ogg', '.aac', '.flac', '.m4a',
  '.glb', '.fbx', '.blend',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.sqlite', '.db', '.wasm',
]);

export function isBinaryPath(filePath: string): boolean {
  const i = filePath.lastIndexOf('.');
  if (i < 0) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(i).toLowerCase());
}
