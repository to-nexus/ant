/**
 * Pipeline canvas geometry — pure, no React / reactflow runtime (the vitest
 * environment is `node`). Dagre LR gives ranks; when the rank strip is wider
 * than the measured pane the ranks wrap into serpentine rows (row 0 → , row 1
 * ← , …). Odd rows are RIGHT-aligned so every row turn is a vertical drop in
 * the same column. Dagre's own y offsets survive inside a row, which is what
 * keeps fan-out branches centred and skipped-over nodes off the edge line.
 */

import dagre from 'dagre';
import { verdictEdgeOutcomes, type StepEdgeCondition } from '@ant/shared';

/** Card width — nodes render it, dagre spaces with it. */
export const NODE_WIDTH = 230;
export const NODESEP = 44;
export const RANKSEP = 70;
/** Horizontal pitch between rank origins (uniform widths → exact multiples). */
export const RANK_PITCH = NODE_WIDTH + RANKSEP;
/** Flow-unit padding kept on each side when deciding how many ranks fit at zoom 1. */
export const FIT_PADDING_PX = 32;
/** Never degrade to a vertical column — two ranks per row is the floor. */
export const MIN_RANKS_PER_ROW = 2;
/** Vertical gap between wrapped rows: smoothstep stubs (2×20) + a label pill. */
export const ROW_GAP = 64;

export type FlowDir = 'ltr' | 'rtl';
/** `flow` = within a row (bezier), `turn` = row transition (bottom → top smoothstep). */
export type EdgeKind = 'flow' | 'turn';

/** The four invisible handle ids every step/gate node renders. */
export const HANDLE = { in: 'in', out: 'out', inTop: 'in-top', outBottom: 'out-bottom' } as const;
export type HandleId = (typeof HANDLE)[keyof typeof HANDLE];

export interface LayoutNodeInput {
  id: string;
  height: number;
}
export interface LayoutEdgeInput {
  id: string;
  source: string;
  target: string;
}
export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  rank: number;
  row: number;
  col: number;
  flowDir: FlowDir;
}
export interface PlacedEdge {
  id: string;
  kind: EdgeKind;
  sourceHandle: HandleId;
  targetHandle: HandleId;
}
export interface PipelineLayout {
  nodes: Map<string, PlacedNode>;
  edges: Map<string, PlacedEdge>;
  wrapped: boolean;
  rows: number;
  ranksPerRow: number | null;
  /** Bounding box of the placed cards — the structural re-fit key. */
  width: number;
  height: number;
}

/** Pane width → whole ranks that fit at zoom 1; `null` while unmeasured (first paint). */
export function ranksPerRowFor(viewportWidth: number | undefined): number | null {
  if (viewportWidth === undefined || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return null;
  const usable = viewportWidth - 2 * FIT_PADDING_PX;
  return Math.max(MIN_RANKS_PER_ROW, Math.floor((usable + RANKSEP) / RANK_PITCH));
}

export function layoutPipeline(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], ranksPerRow: number | null): PipelineLayout {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: NODESEP, ranksep: RANKSEP });
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const placed = new Map<string, PlacedNode>();
  const placedEdges = new Map<string, PlacedEdge>();
  if (nodes.length === 0) {
    return { nodes: placed, edges: placedEdges, wrapped: false, rows: 0, ranksPerRow, width: 0, height: 0 };
  }

  // dagre copies back x/y only — recover the rank from x (uniform widths).
  const minX = Math.min(...nodes.map((n) => g.node(n.id).x));
  const rankOf = new Map<string, number>();
  const topOf = new Map<string, number>();
  const bottomOf = new Map<string, number>();
  let maxRank = 0;
  for (const n of nodes) {
    const box = g.node(n.id);
    const rank = Math.round((box.x - minX) / RANK_PITCH);
    rankOf.set(n.id, rank);
    topOf.set(n.id, box.y - n.height / 2);
    bottomOf.set(n.id, box.y + n.height / 2);
    maxRank = Math.max(maxRank, rank);
  }
  const rankCount = maxRank + 1;
  const wrapped = ranksPerRow !== null && rankCount > ranksPerRow;

  if (!wrapped) {
    const minTop = Math.min(...nodes.map((n) => topOf.get(n.id)!));
    const maxBottom = Math.max(...nodes.map((n) => bottomOf.get(n.id)!));
    for (const n of nodes) {
      const rank = rankOf.get(n.id)!;
      placed.set(n.id, { id: n.id, x: g.node(n.id).x - NODE_WIDTH / 2, y: topOf.get(n.id)! - minTop, rank, row: 0, col: rank, flowDir: 'ltr' });
    }
    for (const e of edges) {
      placedEdges.set(e.id, { id: e.id, kind: 'flow', sourceHandle: HANDLE.out, targetHandle: HANDLE.in });
    }
    return {
      nodes: placed,
      edges: placedEdges,
      wrapped: false,
      rows: 1,
      ranksPerRow,
      width: rankCount * NODE_WIDTH + (rankCount - 1) * RANKSEP,
      height: maxBottom - minTop,
    };
  }

  const k = ranksPerRow!;
  const rowOf = (rank: number) => Math.floor(rank / k);
  const dirOf = (row: number): FlowDir => (row % 2 === 0 ? 'ltr' : 'rtl');
  const colOf = (rank: number) => {
    const offset = rank - rowOf(rank) * k;
    return dirOf(rowOf(rank)) === 'ltr' ? offset : k - 1 - offset;
  };
  const rows = Math.ceil(rankCount / k);

  const rowTop = new Array<number>(rows).fill(Number.POSITIVE_INFINITY);
  const rowBottom = new Array<number>(rows).fill(Number.NEGATIVE_INFINITY);
  for (const n of nodes) {
    const row = rowOf(rankOf.get(n.id)!);
    rowTop[row] = Math.min(rowTop[row], topOf.get(n.id)!);
    rowBottom[row] = Math.max(rowBottom[row], bottomOf.get(n.id)!);
  }
  const rowY = new Array<number>(rows).fill(0);
  for (let i = 1; i < rows; i += 1) rowY[i] = rowY[i - 1] + (rowBottom[i - 1] - rowTop[i - 1]) + ROW_GAP;

  for (const n of nodes) {
    const rank = rankOf.get(n.id)!;
    const row = rowOf(rank);
    placed.set(n.id, {
      id: n.id,
      x: colOf(rank) * RANK_PITCH,
      y: rowY[row] + (topOf.get(n.id)! - rowTop[row]),
      rank,
      row,
      col: colOf(rank),
      flowDir: dirOf(row),
    });
  }
  for (const e of edges) {
    const sameRow = placed.get(e.source)!.row === placed.get(e.target)!.row;
    placedEdges.set(
      e.id,
      sameRow
        ? { id: e.id, kind: 'flow', sourceHandle: HANDLE.out, targetHandle: HANDLE.in }
        : { id: e.id, kind: 'turn', sourceHandle: HANDLE.outBottom, targetHandle: HANDLE.inTop },
    );
  }
  return {
    nodes: placed,
    edges: placedEdges,
    wrapped: true,
    rows,
    ranksPerRow,
    width: k * NODE_WIDTH + (k - 1) * RANKSEP,
    height: rowY[rows - 1] + (rowBottom[rows - 1] - rowTop[rows - 1]),
  };
}

export interface EdgeStyleSpec {
  stroke: string;
  dasharray?: string;
  /** YAML vocabulary, never localized. */
  label?: string;
}

/** One table for stroke / dash / label per edge condition (canvas + legend). */
export function edgeStyleFor(condition: StepEdgeCondition): EdgeStyleSpec {
  if (condition === 'failure') return { stroke: 'var(--red-500)', label: 'failure' };
  if (condition === 'always') return { stroke: 'var(--text-3)', dasharray: '6 4', label: 'always' };
  if (condition.startsWith('verdict:')) return { stroke: 'var(--violet-500)', label: verdictEdgeOutcomes(condition).join(' | ') };
  return { stroke: 'var(--text-3)' };
}
