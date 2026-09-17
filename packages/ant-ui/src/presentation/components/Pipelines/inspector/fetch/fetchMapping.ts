/**
 * Pure helpers behind the fetch trigger's mapping UI — how a click in the
 * response sample becomes an item-path, and how the current paths are read
 * back against the sample. Grammar and formatting are `@ant/shared`'s
 * (`parseItemPath` / `formatItemPath`); this file only relates paths to a
 * sample tree and never touches the definition.
 */

import { MCP_ENV_VAR_NAME_PATTERN, PIPELINE_FETCH_FIELD_NAME_PATTERN, formatItemPath, parseItemPath, type ItemPathSegment, type PipelineFetchSampleNode } from '@ant/shared';

export type PickMode = 'items' | 'key' | 'field';

/** Parse or null — the editor shows the error text through the input, never through a throw. */
export function segmentsOf(path: string | undefined): ItemPathSegment[] | null {
  if (!path) return null;
  const parsed = parseItemPath(path, 'path');
  return typeof parsed === 'string' ? null : parsed;
}

export function pathError(path: string): string | null {
  const parsed = parseItemPath(path, 'path');
  return typeof parsed === 'string' ? parsed.replace(/^path[: ]*/, '') : null;
}

/** Walk the sample by segments; undefined when the sample does not carry that node (cut or absent). */
export function sampleAt(root: PipelineFetchSampleNode | undefined, segments: readonly ItemPathSegment[]): PipelineFetchSampleNode | undefined {
  let node = root;
  for (const seg of segments) {
    if (!node) return undefined;
    if (seg.kind === 'key') {
      if (node.t !== 'obj') return undefined;
      node = node.entries.find(([k]) => k === seg.name)?.[1];
    } else {
      if (node.t !== 'arr') return undefined;
      node = node.items[seg.index];
    }
  }
  return node;
}

/** The first element of the array `items` selects — the node key/field paths are relative to. */
export function firstItemSegments(itemsPath: string): ItemPathSegment[] | null {
  const items = segmentsOf(itemsPath);
  return items ? [...items, { kind: 'index', index: 0 }] : null;
}

/**
 * An absolute click inside `items[n]` → the path relative to the element
 * (`$.fields.summary`), or null when the click is outside any element.
 */
export function relativeToItem(itemsPath: string, absolute: readonly ItemPathSegment[]): ItemPathSegment[] | null {
  const items = segmentsOf(itemsPath);
  if (!items || absolute.length <= items.length) return null;
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    const b = absolute[i];
    if (a.kind !== b.kind) return null;
    if (a.kind === 'key' && b.kind === 'key' && a.name !== b.name) return null;
    if (a.kind === 'index' && b.kind === 'index' && a.index !== b.index) return null;
  }
  if (absolute[items.length].kind !== 'index') return null;
  return absolute.slice(items.length + 1);
}

/** Absolute segments of a path declared relative to the item element (for highlighting in the sample). */
export function absoluteFromItem(itemsPath: string, relative: string): ItemPathSegment[] | null {
  const first = firstItemSegments(itemsPath);
  const rel = segmentsOf(relative);
  return first && rel ? [...first, ...rel] : null;
}

export function pathKey(segments: readonly ItemPathSegment[]): string {
  return formatItemPath(segments);
}

/** `$.fields.customfield_10021` → `customfield10021`; `$['Sales Channel']` → `salesChannel`; nothing usable → `field`. */
export function suggestFieldName(segments: readonly ItemPathSegment[], taken: readonly string[] = []): string {
  const last = [...segments].reverse().find((s) => s.kind === 'key');
  const words = (last?.kind === 'key' ? last.name : '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  let name = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  if (/^[0-9]/.test(name)) name = `f${name}`;
  if (!PIPELINE_FETCH_FIELD_NAME_PATTERN.test(name) || name === 'key') name = 'field';
  let candidate = name;
  for (let n = 2; taken.includes(candidate); n += 1) candidate = `${name}${n}`;
  return candidate;
}

/** A credential key name from the pipeline id and the header it authorises: `voc-inbox` × `Authorization` → `VOC_INBOX_AUTHORIZATION`. */
export function suggestSecretKey(parts: readonly string[]): string {
  const raw = parts
    .map((p) => p.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase())
    .filter(Boolean)
    .join('_');
  const key = /^[0-9]/.test(raw) ? `K_${raw}` : raw;
  return MCP_ENV_VAR_NAME_PATTERN.test(key) ? key : 'API_TOKEN';
}

/** One-line rendering of a sample node for chips and row previews. */
export function sampleText(node: PipelineFetchSampleNode | undefined): string {
  if (!node) return '';
  switch (node.t) {
    case 'str':
      return node.cut ? `${node.v}…` : node.v;
    case 'num':
    case 'bool':
      return String(node.v);
    case 'null':
      return 'null';
    case 'arr':
      return `[${node.total}]`;
    case 'obj':
      return `{${node.entries.length + node.more}}`;
  }
}
