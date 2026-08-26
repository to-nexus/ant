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
 *
 * `toNfc` also serves the CONTENT axis: read-only text channels entering
 * prompts (user-doc funnel `normalizeTemplateDoc`, plan context docs, the
 * directive intake) normalize to NFC so the model never sees mixed-
 * normalization Korean (sure-judging-bluff thinking loops). Codebase
 * read/edit tool paths stay byte-faithful by design.
 */

export function toNfc(s: string): string {
  return s.normalize('NFC');
}

export function nfcEquals(a: string, b: string): boolean {
  return a.normalize('NFC') === b.normalize('NFC');
}

/**
 * Rewrite a ripgrep regex so each literal non-ASCII codepoint matches BOTH its
 * NFC and NFD byte forms: every codepoint `c` of the run's NFC form becomes
 * `(?:c|c-in-NFD)`. A following quantifier binds to the group, preserving the
 * original semantics ("one-or-more 한, either form").
 *
 * Returns `null` (caller must skip the tolerant retry) when substitution
 * cannot be proven safe — fail-closed:
 *  - the pattern contains `[`: decomposing inside a character class turns a
 *    syllable into individual-jamo alternatives (`[한]` would match the lead
 *    jamo of every ᄒ-syllable in NFD text — a false positive);
 *  - a run whose bytes are NOT already NFC (an NFD-typed pattern) is followed
 *    by a quantifier (`? * + {`): regrouping would rebind the quantifier from
 *    a single jamo onto the whole syllable group;
 *  - nothing in the pattern is normalization-sensitive.
 */
export function buildNfcTolerantRegex(pattern: string): string | null {
  if (pattern.includes('[')) return null;
  if (pattern.normalize('NFC') === pattern.normalize('NFD')) return null;

  let out = '';
  let changed = false;
  const chars = Array.from(pattern);
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === '\\' && i + 1 < chars.length) {
      out += ch + chars[i + 1];
      i += 2;
      continue;
    }
    if (ch.codePointAt(0)! < 0x80) {
      out += ch;
      i++;
      continue;
    }
    // Maximal run of literal non-ASCII codepoints.
    let j = i;
    while (j < chars.length && chars[j].codePointAt(0)! >= 0x80) j++;
    const run = chars.slice(i, j).join('');
    const nfcRun = run.normalize('NFC');
    if (run !== nfcRun && j < chars.length && /[?*+{]/.test(chars[j])) return null;
    for (const cp of nfcRun) {
      const nfd = cp.normalize('NFD');
      if (nfd !== cp) {
        out += `(?:${cp}|${nfd})`;
        changed = true;
      } else {
        out += cp;
      }
    }
    i = j;
  }
  return changed ? out : null;
}

/**
 * Normalization variants of a glob that differ from the input, for use as
 * additional ripgrep `--glob` includes (multiple include globs are a union).
 * `[]` when the glob is normalization-insensitive or contains a `[` class
 * (same jamo-decomposition hazard as the regex case).
 */
export function globNormalizationVariants(glob: string): string[] {
  if (glob.includes('[')) return [];
  const variants = new Set([glob.normalize('NFC'), glob.normalize('NFD')]);
  variants.delete(glob);
  return Array.from(variants);
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
