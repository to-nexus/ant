/** Rows ⇄ record, the one conversion every name/value editor in the inspector shares. */

export type KeyValueRow = [name: string, value: string];

export function recordToRows(record: Record<string, string | number | boolean> | undefined): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([k, v]) => [k, String(v)]);
}

/** Blank names are dropped; a later duplicate name wins (the row the author edited last). Empty ⇒ undefined so the YAML key disappears. */
export function rowsToRecord(rows: readonly KeyValueRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [name, value] of rows) {
    const k = name.trim();
    if (k) out[k] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function setRow(rows: readonly KeyValueRow[], index: number, patch: Partial<{ name: string; value: string }>): KeyValueRow[] {
  return rows.map((row, i) => (i === index ? [patch.name ?? row[0], patch.value ?? row[1]] : row));
}
