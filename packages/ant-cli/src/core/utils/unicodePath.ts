/**
 * Unicode-normalization tolerance for on-disk path resolution.
 *
 * macOS browsers submit upload filenames in NFD (decomposed Hangul/accents) and
 * the bytes land on disk verbatim; LLM tokenizer round-trips re-emit the same
 * glyphs in NFC. APFS lookups are normalization-insensitive so local mode never
 * notices, but Linux/EFS is byte-exact — an NFC `copy_file` of an NFD upload
 * ENOENTs on a file that visibly exists (zinc-bracing-gavel). The reconcile
 * walk below maps a requested path onto the on-disk byte form when a
 * normalization variant exists, probing ONLY through the FileSystemPort so the
 * contained (descriptor-descended) enumeration primitives stay in force.
 */

export function toNfc(s: string): string {
  return s.normalize('NFC');
}

export function nfcEquals(a: string, b: string): boolean {
  return a.normalize('NFC') === b.normalize('NFC');
}

/** Minimal port shape so agents/ and periphery/ callers share the walk. */
export interface ExistenceProbe {
  fileExists(path: string): Promise<boolean>;
  readDirectory(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
}

const ASCII_ONLY = /^[\x00-\x7F]*$/;

function joinRel(parent: string, seg: string): string {
  return parent === '' ? seg : `${parent}/${seg}`;
}

/**
 * Segment-walk reconcile: returns the on-disk byte form of `relPath` when a
 * Unicode-normalization variant of a segment exists; missing tail segments are
 * kept verbatim (create targets, files that genuinely do not exist).
 *
 * `.` / `..` / empty segments pass through unmatched — traversal protection
 * stays owned by the port's resolveAbsolute. Byte-exact entries win over
 * NFC-equal variants; among variants the lexicographically first is chosen for
 * determinism.
 */
export async function reconcileOnDiskPath(
  fsPort: ExistenceProbe,
  relPath: string,
): Promise<{ fsPath: string; reconciled: boolean }> {
  // ASCII fast path — normalization forms only differ for non-ASCII.
  if (ASCII_ONLY.test(relPath)) return { fsPath: relPath, reconciled: false };

  // Byte-exact fast path. On normalization-insensitive filesystems (APFS)
  // this always succeeds, making the walk a structural no-op on darwin.
  try {
    if (await fsPort.fileExists(relPath)) return { fsPath: relPath, reconciled: false };
  } catch {
    return { fsPath: relPath, reconciled: false };
  }

  const segments = relPath.split('/');
  let resolved = '';
  let reconciled = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '' || seg === '.' || seg === '..' || ASCII_ONLY.test(seg)) {
      resolved = joinRel(resolved, seg);
      continue;
    }

    const candidate = joinRel(resolved, seg);
    let exists = false;
    try {
      exists = await fsPort.fileExists(candidate);
    } catch {
      exists = false;
    }
    if (exists) {
      resolved = candidate;
      continue;
    }

    let entries: Array<{ name: string }>;
    try {
      entries = await fsPort.readDirectory(resolved === '' ? '.' : resolved);
    } catch {
      // Parent unreadable/missing → remaining segments cannot exist; keep verbatim.
      resolved = joinRel(resolved, segments.slice(i).join('/'));
      return { fsPath: resolved, reconciled };
    }

    const variants = entries
      .map((e) => e.name)
      .filter((name) => name !== seg && nfcEquals(name, seg))
      .sort();
    if (variants.length === 0) {
      // Genuinely missing segment → this and everything below is a create target.
      resolved = joinRel(resolved, segments.slice(i).join('/'));
      return { fsPath: resolved, reconciled };
    }

    resolved = joinRel(resolved, variants[0]);
    reconciled = true;
  }

  return { fsPath: resolved, reconciled };
}
