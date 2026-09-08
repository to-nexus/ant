/**
 * Pipeline canvas geometry — the serpentine wrap is a pure function of
 * (graph, ranks-per-row), so the truth table lives here and the canvas only
 * paints it. Ranks are recovered from dagre's x (uniform card widths).
 */
import { describe, expect, it } from 'vitest';
import {
  HANDLE,
  NODESEP,
  RANK_PITCH,
  ROW_GAP,
  edgeStyleFor,
  layoutPipeline,
  ranksPerRowFor,
  type LayoutEdgeInput,
  type LayoutNodeInput,
} from '../../src/presentation/components/Pipelines/canvas/layout';

const H = 80;
function chain(n: number): { nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[] } {
  const ids = ['trigger', ...Array.from({ length: n }, (_, i) => `s${i + 1}`)];
  return {
    nodes: ids.map((id) => ({ id, height: H })),
    edges: ids.slice(1).map((id, i) => ({ id: `${ids[i]}->${id}`, source: ids[i], target: id })),
  };
}
function graph(edgePairs: Array<[string, string]>): { nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[] } {
  const ids = [...new Set(edgePairs.flat())];
  return {
    nodes: ids.map((id) => ({ id, height: H })),
    edges: edgePairs.map(([s, t]) => ({ id: `${s}->${t}`, source: s, target: t })),
  };
}
const lay = (g: { nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[] }, width: number | undefined) =>
  layoutPipeline(g.nodes, g.edges, ranksPerRowFor(width));

describe('ranksPerRowFor', () => {
  it.each<[number | undefined, number | null]>([
    [undefined, null],
    [0, null],
    [Number.NaN, null],
    [-5, null],
    [500, 2],
    [600, 2],
    [900, 3],
    [1100, 3],
    [1200, 4],
    [1400, 4],
    [1536, 5],
  ])('%s px → %s ranks per row', (width, expected) => {
    expect(ranksPerRowFor(width)).toBe(expected);
  });
});

describe('layoutPipeline', () => {
  it('a chain that fits stays one dagre row, all ltr, horizontal handles', () => {
    const l = lay(chain(3), 1400);
    expect(l.wrapped).toBe(false);
    expect(l.rows).toBe(1);
    const ys = new Set<number>();
    for (const n of l.nodes.values()) {
      expect(n.flowDir).toBe('ltr');
      expect(n.x).toBe(n.rank * RANK_PITCH);
      ys.add(n.y);
    }
    expect(ys.size).toBe(1);
    for (const e of l.edges.values()) expect(e).toMatchObject({ kind: 'flow', sourceHandle: HANDLE.out, targetHandle: HANDLE.in });
  });

  it('one rank over the row capacity wraps', () => {
    const l = lay(chain(3), 1100); // 4 ranks, k = 3
    expect(l.wrapped).toBe(true);
    expect(l.rows).toBe(2);
  });

  it('8 linear steps at 900px → 3 serpentine rows', () => {
    const l = lay(chain(8), 900); // 9 ranks, k = 3
    expect(l.rows).toBe(3);
    const expectedDir = ['ltr', 'rtl', 'ltr'];
    const expectedCols = [
      [0, 1, 2],
      [2, 1, 0],
      [0, 1, 2],
    ];
    for (const n of l.nodes.values()) {
      const row = Math.floor(n.rank / 3);
      expect(n.row).toBe(row);
      expect(n.flowDir).toBe(expectedDir[row]);
      expect(n.col).toBe(expectedCols[row][n.rank % 3]);
      expect(n.x).toBe(n.col * RANK_PITCH);
      expect(n.y).toBe(row * (H + ROW_GAP));
    }
    const turns = [...l.edges.values()].filter((e) => e.kind === 'turn').map((e) => e.id);
    expect(turns.sort()).toEqual(['s2->s3', 's5->s6']);
    for (const id of turns) expect(l.edges.get(id)).toMatchObject({ sourceHandle: HANDLE.outBottom, targetHandle: HANDLE.inTop });
    expect([...l.edges.values()].filter((e) => e.kind === 'flow')).toHaveLength(6);
    // A turn is a vertical drop in the same column.
    expect(l.nodes.get('s3')!.x).toBe(l.nodes.get('s2')!.x);
    expect(l.nodes.get('s6')!.x).toBe(l.nodes.get('s5')!.x);
    expect(l.width).toBe(3 * RANK_PITCH - 70);
    expect(l.height).toBe(3 * H + 2 * ROW_GAP);
  });

  it('a partial rtl row is right-aligned', () => {
    const l = lay(chain(4), 900); // ranks 0..4, k = 3
    expect(l.nodes.get('s3')).toMatchObject({ row: 1, col: 2, x: 2 * RANK_PITCH });
    expect(l.nodes.get('s4')).toMatchObject({ row: 1, col: 1 });
  });

  it('a partial ltr row starts at column 0', () => {
    const l = lay(chain(7), 900); // ranks 0..7
    expect(l.nodes.get('s6')).toMatchObject({ row: 2, col: 0 });
    expect(l.nodes.get('s7')).toMatchObject({ row: 2, col: 1 });
  });

  it('a DAG fan-out stays inside its row with dagre vertical spacing', () => {
    const l = lay(graph([['t', 'a'], ['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]), 900);
    const b = l.nodes.get('b')!;
    const c = l.nodes.get('c')!;
    expect(b.row).toBe(0);
    expect(c.row).toBe(0);
    expect(b.col).toBe(2);
    expect(c.col).toBe(2);
    expect(b.x).toBe(c.x);
    expect(Math.abs(b.y - c.y)).toBe(H + NODESEP);
    expect(l.nodes.get('d')).toMatchObject({ row: 1, col: 2 });
    expect(l.edges.get('a->b')!.kind).toBe('flow');
    expect(l.edges.get('b->d')!.kind).toBe('turn');
    expect(l.edges.get('c->d')!.kind).toBe('turn');
  });

  it('a skip edge is a flow edge within a row and a turn across rows', () => {
    const g = graph([['t', 'a'], ['a', 'b'], ['b', 'c'], ['a', 'c']]);
    expect(lay(g, 1400).edges.get('a->c')!.kind).toBe('flow');
    expect(lay(g, 600).edges.get('a->c')).toMatchObject({ kind: 'turn', sourceHandle: HANDLE.outBottom, targetHandle: HANDLE.inTop });
  });

  it.each<[string, number | undefined]>([
    ['zero width', 0],
    ['undefined width', undefined],
  ])('%s falls back to plain LR', (_label, width) => {
    const l = lay(chain(8), width);
    expect(l.wrapped).toBe(false);
    expect(l.rows).toBe(1);
    for (const n of l.nodes.values()) {
      expect(n.flowDir).toBe('ltr');
      expect(n.x).toBe(n.rank * RANK_PITCH);
    }
    expect([...l.edges.values()].some((e) => e.kind === 'turn')).toBe(false);
  });

  it('a lone trigger sits at the origin', () => {
    const l = layoutPipeline([{ id: 'trigger', height: H }], [], 3);
    expect(l.nodes.get('trigger')).toMatchObject({ x: 0, y: 0, row: 0, col: 0 });
    expect(l.rows).toBe(1);
    expect(l.edges.size).toBe(0);
  });

  it('is deterministic', () => {
    const g = chain(8);
    expect(lay(g, 900)).toEqual(lay(g, 900));
  });
});

describe('edgeStyleFor', () => {
  it.each<[string, { stroke: string; dasharray?: string; label?: string }]>([
    ['success', { stroke: 'var(--text-3)' }],
    ['failure', { stroke: 'var(--red-500)', label: 'failure' }],
    ['always', { stroke: 'var(--text-3)', dasharray: '6 4', label: 'always' }],
    ['verdict:ok', { stroke: 'var(--violet-500)', label: 'ok' }],
    ['verdict:a|b', { stroke: 'var(--violet-500)', label: 'a | b' }],
  ])('%s', (condition, expected) => {
    expect(edgeStyleFor(condition as never)).toEqual(expected);
  });
});
