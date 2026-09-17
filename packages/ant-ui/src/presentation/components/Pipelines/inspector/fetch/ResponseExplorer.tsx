/**
 * The polled response, as a tree an author clicks instead of typing paths.
 * In `items` mode a click on an array declares the item array; in `key` /
 * `field` mode a click on a scalar INSIDE the first element declares that
 * item-path (relative to the element). The current selection is painted back
 * onto the tree in the token tones the directive preview already uses —
 * teal for the array, amber for the key, violet for fields — so what the
 * poller will read is visible at a glance.
 */

import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ItemPathSegment, PipelineFetchSampleNode } from '@ant/shared';
import { absoluteFromItem, pathKey, sampleText, segmentsOf, type PickMode } from './fetchMapping';

export interface ResponseExplorerProps {
  sample: PipelineFetchSampleNode;
  itemsPath: string;
  keyPath: string;
  fieldPaths: readonly string[];
  pickMode: PickMode | null;
  onPick: (absolute: ItemPathSegment[], node: PipelineFetchSampleNode) => void;
  labels: { root: string; more: (n: number) => string; total: (n: number) => string; pickHere: string };
}

const TONE = { items: 'var(--teal-500)', key: 'var(--amber-500)', field: 'var(--violet-500)' } as const;

function isContainer(node: PipelineFetchSampleNode): node is Extract<PipelineFetchSampleNode, { t: 'obj' | 'arr' }> {
  return node.t === 'obj' || node.t === 'arr';
}

export function ResponseExplorer({ sample, itemsPath, keyPath, fieldPaths, pickMode, onPick, labels }: ResponseExplorerProps) {
  const marks = useMemo(() => {
    const m = new Map<string, keyof typeof TONE>();
    const items = segmentsOf(itemsPath);
    if (items) m.set(pathKey(items), 'items');
    for (const f of fieldPaths) {
      const abs = absoluteFromItem(itemsPath, f);
      if (abs) m.set(pathKey(abs), 'field');
    }
    const key = absoluteFromItem(itemsPath, keyPath);
    if (key) m.set(pathKey(key), 'key');
    return m;
  }, [itemsPath, keyPath, fieldPaths]);

  // Open the root, the item array and its first element by default; the rest folds.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const items = segmentsOf(itemsPath);
  const autoOpen = new Set<string>(['$']);
  if (items) {
    for (let i = 1; i <= items.length; i += 1) autoOpen.add(pathKey(items.slice(0, i)));
    autoOpen.add(pathKey([...items, { kind: 'index', index: 0 }]));
  }

  const canPick = (node: PipelineFetchSampleNode): boolean => {
    if (!pickMode) return false;
    if (pickMode === 'items') return node.t === 'arr';
    return !isContainer(node);
  };

  const rows: ReactElement[] = [];
  const walk = (node: PipelineFetchSampleNode, segments: ItemPathSegment[], label: string, depth: number) => {
    const id = pathKey(segments);
    const mark = marks.get(id);
    const open = openOverride[id] ?? autoOpen.has(id);
    const pickable = canPick(node);
    const container = isContainer(node);
    const summary = container ? (node.t === 'arr' ? labels.total(node.total) : `${node.entries.length + node.more}`) : sampleText(node);
    rows.push(
      <div
        key={id}
        data-path={id}
        data-mark={mark}
        role={pickable ? 'button' : undefined}
        tabIndex={pickable ? 0 : undefined}
        title={pickable ? `${labels.pickHere} · ${id}` : id}
        onClick={() => {
          if (pickable) onPick(segments, node);
          else if (container) setOpenOverride((o) => ({ ...o, [id]: !open }));
        }}
        onKeyDown={(e) => {
          if (pickable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onPick(segments, node);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 24,
          padding: `0 8px 0 ${8 + depth * 14}px`,
          borderRadius: 6,
          cursor: pickable || container ? 'pointer' : 'default',
          background: mark ? `color-mix(in srgb, ${TONE[mark]} 14%, transparent)` : undefined,
          outline: pickable ? `1px dashed color-mix(in srgb, ${pickMode ? TONE[pickMode] : 'transparent'} 60%, transparent)` : undefined,
          outlineOffset: -1,
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          color: 'var(--text-2)',
        }}
      >
        <span aria-hidden style={{ width: 12, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-4)', flexShrink: 0 }}>
          {container ? open ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}
        </span>
        <span style={{ color: mark ? TONE[mark] : 'var(--text-1)', fontWeight: mark ? 700 : 500, whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: 'var(--text-4)', fontSize: 10.5, whiteSpace: 'nowrap' }}>{node.t === 'arr' ? 'array' : node.t === 'obj' ? 'object' : node.t}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{summary}</span>
      </div>,
    );
    if (container && open) {
      if (node.t === 'arr') {
        node.items.forEach((child, i) => walk(child, [...segments, { kind: 'index', index: i }], `[${i}]`, depth + 1));
        if (node.total > node.items.length) rows.push(<Ellipsis key={`${id}…`} depth={depth + 1} text={labels.more(node.total - node.items.length)} />);
      } else {
        for (const [k, child] of node.entries) walk(child, [...segments, { kind: 'key', name: k }], k, depth + 1);
        if (node.more > 0) rows.push(<Ellipsis key={`${id}…`} depth={depth + 1} text={labels.more(node.more)} />);
      }
    }
  };
  walk(sample, [], labels.root, 0);

  return (
    <div
      data-explorer
      style={{
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-surface-2)',
        padding: 6,
        maxHeight: 280,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {rows}
    </div>
  );
}

function Ellipsis({ depth, text }: { depth: number; text: string }) {
  return (
    <div style={{ padding: `0 8px 0 ${8 + depth * 14 + 18}px`, fontSize: 10.5, color: 'var(--text-4)', minHeight: 20, display: 'flex', alignItems: 'center' }}>{text}</div>
  );
}
