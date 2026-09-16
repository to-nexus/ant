/**
 * Fetch-trigger item extraction — pure over `(json, trigger)`. The poller and
 * the editor's preview share this ONE reader so what the preview shows is what
 * a poll would claim.
 *
 * Bounds: at most PIPELINE_FETCH_ITEMS_SCAN_MAX items inspected, keys outside
 * PIPELINE_ITEM_KEY_PATTERN skipped (Redis key + path-segment hygiene), fields
 * cut at PIPELINE_ITEM_FIELD_MAX_CHARS, duplicate keys first-wins.
 */

import {
  parseItemPath,
  PIPELINE_FETCH_ITEMS_SCAN_MAX,
  PIPELINE_ITEM_FIELD_MAX_CHARS,
  PIPELINE_ITEM_KEY_PATTERN,
  type ItemPathSegment,
  type PipelineFetchTrigger,
  type PipelineRunItem,
} from '@ant/shared';

/** Walk an item-path; `undefined` when any segment is missing or the shape disagrees. */
export function selectItemPath(root: unknown, segments: readonly ItemPathSegment[]): unknown {
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (seg.kind === 'index') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg.index];
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg.name];
    }
  }
  return cur;
}

export interface ExtractedFetchItems {
  items: PipelineRunItem[];
  /** Items the selector returned (before key filtering, after the scan cap). */
  seen: number;
  /** Items dropped: unusable key (missing, non-scalar, out of pattern) or duplicate key. */
  skipped: number;
}

function scalarText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * Select the items and project each to `{ key, fields }`. A string return is
 * the reason the response is unusable (items path did not select an array).
 */
export function extractFetchItems(json: unknown, trigger: PipelineFetchTrigger): ExtractedFetchItems | string {
  const itemsPath = parseItemPath(trigger.items, 'items');
  const keyPath = parseItemPath(trigger.key, 'key');
  if (typeof itemsPath === 'string') return itemsPath;
  if (typeof keyPath === 'string') return keyPath;
  const fieldPaths: Array<[string, ItemPathSegment[]]> = [];
  for (const [name, raw] of Object.entries(trigger.fields ?? {})) {
    const parsed = parseItemPath(raw, `fields.${name}`);
    if (typeof parsed === 'string') return parsed;
    fieldPaths.push([name, parsed]);
  }

  const selected = selectItemPath(json, itemsPath);
  if (!Array.isArray(selected)) {
    return `items path "${trigger.items}" did not select an array (got: ${selected === undefined ? 'nothing' : Array.isArray(selected) ? 'array' : typeof selected})`;
  }
  const scanned = selected.slice(0, PIPELINE_FETCH_ITEMS_SCAN_MAX);
  const out: PipelineRunItem[] = [];
  const keys = new Set<string>();
  let skipped = 0;
  for (const raw of scanned) {
    const keyValue = selectItemPath(raw, keyPath);
    const key = typeof keyValue === 'string' || typeof keyValue === 'number' ? String(keyValue) : undefined;
    if (key === undefined || !PIPELINE_ITEM_KEY_PATTERN.test(key) || keys.has(key)) {
      skipped += 1;
      continue;
    }
    keys.add(key);
    const fields: Record<string, string> = {};
    for (const [name, segments] of fieldPaths) {
      const text = scalarText(selectItemPath(raw, segments));
      if (text === undefined) continue;
      fields[name] = text.length > PIPELINE_ITEM_FIELD_MAX_CHARS ? text.slice(0, PIPELINE_ITEM_FIELD_MAX_CHARS) : text;
    }
    out.push(Object.keys(fields).length > 0 ? { key, fields } : { key });
  }
  return { items: out, seen: scanned.length, skipped };
}
