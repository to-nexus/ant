/**
 * True iff two batches share any modify/create/delete target.
 *
 * Accepts string / `{target}` / `{file}` entry shapes; reading only `.file`
 * collapses every `{target}` entry to the same `undefined` sentinel and
 * forces `exclusive: true` on independent slices.
 *
 * Module-private to `tasks/_shared/batchSplit/`.
 */
export function computeBatchFileOverlap(batches: any[]): boolean {
  const pathOf = (entry: any): string | undefined => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') return entry.target ?? entry.file;
    return undefined;
  };
  const extractFiles = (b: any): Set<string> => {
    const files = new Set<string>();
    for (const m of (b.modify || [])) {
      const p = pathOf(m);
      if (p) files.add(p);
    }
    for (const c of (b.create || [])) {
      const p = pathOf(c);
      if (p) files.add(p);
    }
    for (const d of (b.delete || [])) {
      const p = pathOf(d);
      if (p) files.add(p);
    }
    return files;
  };
  const allFiles = batches.map(extractFiles);
  for (let i = 0; i < allFiles.length; i++) {
    for (let j = i + 1; j < allFiles.length; j++) {
      for (const file of allFiles[i]) {
        if (allFiles[j].has(file)) return true;
      }
    }
  }
  return false;
}
