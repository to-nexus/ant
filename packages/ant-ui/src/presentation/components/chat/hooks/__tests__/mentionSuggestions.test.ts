/**
 * Mention typeahead = directory navigation over ONE picker tree. Pins the
 * pure row builder: one level at a time, directories before files, a
 * directory shown only when something under it is offered, display-name AND
 * path-segment matching, the per-level cap, and the selectable/enterable
 * rules that keep a `@target:` from attaching a folder and the definition
 * group roots from being attached at all.
 */
import { describe, it, expect } from 'vitest';
import { UNIVERSAL_AGENTS_DIRNAME, UNIVERSAL_PIPELINES_DIRNAME, type FileNode } from '@ant/shared';
import {
  buildNavSuggestions,
  findDirNode,
  navBreadcrumb,
  popNavLevel,
  splitNavQuery,
  type MentionSuggestion,
  type NavSuggestionOptions,
} from '../mentionSuggestions';
import { isUniversalCtxSuggestible } from '../universalMentionSurface';

const dir = (name: string, path: string, children: FileNode[] = []): FileNode => ({ name, path, type: 'directory', children });
const file = (name: string, path: string): FileNode => ({ name, path, type: 'file' });

const AGENTS = UNIVERSAL_AGENTS_DIRNAME;
const PIPES = UNIVERSAL_PIPELINES_DIRNAME;

const tree: FileNode[] = [
  dir('plan', 'plan', [file('prd.md', 'plan/prd.md'), file('notes.md', 'plan/notes.md')]),
  dir('briefs', 'briefs', [file('a.md', 'briefs/a.md')]),
  dir('sessions', 'sessions', [file('chat.jsonl', 'sessions/chat.jsonl')]),
  dir('architecture', 'architecture', [file('overview.md', 'architecture/overview.md')]),
  dir('visual', 'visual', [dir('ui', 'visual/ui', [dir('handoff', 'visual/ui/handoff', [file('index.html', 'visual/ui/handoff/index.html')])])]),
  dir('meta', 'meta', [
    dir('evals', 'meta/evals', [file('e.md', 'meta/evals/e.md')]),
    dir('other', 'meta/other', [file('x.md', 'meta/other/x.md')]),
  ]),
  file('README.md', 'README.md'),
  // Definition grafts label rows with DISPLAY names, not path segments.
  dir('Agent Definitions', AGENTS, [
    dir('Payments Ops · org', `${AGENTS}/payments-ops`, [
      file('agent.yaml', `${AGENTS}/payments-ops/agent.yaml`),
      dir('jobs', `${AGENTS}/payments-ops/jobs`, [
        dir('settle', `${AGENTS}/payments-ops/jobs/settle`, [file('job.yaml', `${AGENTS}/payments-ops/jobs/settle/job.yaml`)]),
      ]),
    ]),
    // Tree not loaded yet — must stay visible so entering it can trigger the fetch.
    dir('Ledger', `${AGENTS}/ledger`, []),
  ]),
  dir('Pipeline Definitions', PIPES, [
    dir('Nightly', `${PIPES}/nightly`, [file('pipeline.yaml', `${PIPES}/nightly/pipeline.yaml`)]),
  ]),
];

const labels: NavSuggestionOptions['labels'] = {
  browse: 'Browse',
  browseDescription: 'Pick from tree',
  more: (n) => `${n} more`,
};

const universalCtx: NavSuggestionOptions = {
  field: 'context',
  selectableTypes: ['file', 'directory'],
  isOffered: (n) => isUniversalCtxSuggestible(n.path),
  labels,
};

const isWritable = (p: string) => p.startsWith('architecture/') || p.startsWith('visual/') || p.startsWith('meta/evals/');
const target: NavSuggestionOptions = {
  field: 'target',
  selectableTypes: ['file'],
  isOffered: (n) => n.type === 'file' && isWritable(n.path),
  labels,
};

const ids = (rows: MentionSuggestion[]) => rows.filter((r) => r.type !== 'browse').map((r) => r.id);
const browseRows = (rows: MentionSuggestion[]) => rows.filter((r) => r.type === 'browse');

describe('splitNavQuery / popNavLevel', () => {
  it.each([
    ['', '', ''],
    ['pl', '', 'pl'],
    ['plan/', 'plan/', ''],
    ['plan/pr', 'plan/', 'pr'],
    [`${AGENTS}/payments-ops/jobs/`, `${AGENTS}/payments-ops/jobs/`, ''],
  ])('splitNavQuery(%j) → dirPrefix %j, remainder %j', (q, dirPrefix, remainder) => {
    expect(splitNavQuery(q)).toEqual({ dirPrefix, remainder });
  });

  it.each([
    [`${AGENTS}/payments-ops/`, `${AGENTS}/`],
    [`${AGENTS}/payments-ops/jo`, `${AGENTS}/`],
    [`${AGENTS}/`, ''],
    ['plan', ''],
    ['', ''],
  ])('popNavLevel(%j) → %j', (q, expected) => {
    expect(popNavLevel(q)).toBe(expected);
  });
});

describe('findDirNode / navBreadcrumb — keyed on path, labeled by name', () => {
  it('walks by node.path even when the display name differs', () => {
    expect(findDirNode(tree, `${AGENTS}/payments-ops/`)?.map((n) => n.path)).toEqual([
      `${AGENTS}/payments-ops/agent.yaml`,
      `${AGENTS}/payments-ops/jobs`,
    ]);
    expect(findDirNode(tree, '')).toBe(tree);
    expect(findDirNode(tree, 'nope/')).toBeNull();
  });

  it('breadcrumb shows display names, falling back to the segment', () => {
    expect(navBreadcrumb(tree, `${AGENTS}/payments-ops/jobs/`)).toEqual(['Agent Definitions', 'Payments Ops · org', 'jobs']);
    expect(navBreadcrumb(tree, 'ghost/x/')).toEqual(['ghost', 'x']);
    expect(navBreadcrumb(tree, '')).toEqual([]);
  });
});

describe('buildNavSuggestions — universal @ctx:', () => {
  it('root: directories first, sessions hidden, files after, Browse last', () => {
    const rows = buildNavSuggestions(tree, '', universalCtx);
    const nonBrowse = rows.filter((r) => r.type !== 'browse');
    const firstFile = nonBrowse.findIndex((r) => r.nodeType === 'file');
    expect(firstFile).toBeGreaterThan(0);
    expect(nonBrowse.slice(0, firstFile).every((r) => r.nodeType === 'directory')).toBe(true);
    expect(nonBrowse.slice(firstFile).every((r) => r.nodeType === 'file')).toBe(true);
    expect(ids(rows)).not.toContain('sessions');
    expect(ids(rows)).toContain('README.md');
    expect(rows[rows.length - 1]).toMatchObject({ type: 'browse', id: 'context', label: 'Browse' });
    expect(browseRows(rows)).toHaveLength(1);
  });

  it('the remainder filters the CURRENT level only — nothing from deeper levels leaks up', () => {
    const rows = buildNavSuggestions(tree, 'pl', universalCtx);
    expect(ids(rows)).toEqual(['plan']);
    // `plan/prd.md` matches "pl" by path but lives one level down.
    expect(ids(buildNavSuggestions(tree, 'prd', universalCtx))).toEqual([]);
    expect(ids(buildNavSuggestions(tree, 'plan/prd', universalCtx))).toEqual(['plan/prd.md']);
  });

  it('matches the display name AND the path segment, case-insensitively', () => {
    expect(ids(buildNavSuggestions(tree, `${AGENTS}/payments`, universalCtx))).toEqual([`${AGENTS}/payments-ops`]);
    expect(ids(buildNavSuggestions(tree, `${AGENTS}/PAYMENTS-OPS`, universalCtx))).toEqual([`${AGENTS}/payments-ops`]);
    expect(ids(buildNavSuggestions(tree, `${AGENTS}/ops`, universalCtx))).toEqual([`${AGENTS}/payments-ops`]);
  });

  it('the group roots are enterable but never selectable; the definitions under them are both', () => {
    const rows = buildNavSuggestions(tree, '', universalCtx);
    const agentsRoot = rows.find((r) => r.id === AGENTS);
    const pipesRoot = rows.find((r) => r.id === PIPES);
    expect(agentsRoot).toMatchObject({ nodeType: 'directory', enterable: true, selectable: false });
    expect(pipesRoot).toMatchObject({ nodeType: 'directory', enterable: true, selectable: false });

    const agentRow = buildNavSuggestions(tree, `${AGENTS}/`, universalCtx).find((r) => r.id === `${AGENTS}/payments-ops`);
    expect(agentRow).toMatchObject({ enterable: true, selectable: true, label: 'Payments Ops · org' });
    const yaml = buildNavSuggestions(tree, `${PIPES}/nightly/`, universalCtx).find((r) => r.id === `${PIPES}/nightly/pipeline.yaml`);
    expect(yaml).toMatchObject({ nodeType: 'file', enterable: false, selectable: true });
  });

  it('an offered directory with no loaded children stays visible (click-to-fetch)', () => {
    expect(ids(buildNavSuggestions(tree, `${AGENTS}/`, universalCtx))).toContain(`${AGENTS}/ledger`);
  });

  it('rowFor overrides ride on top of the base row', () => {
    const rows = buildNavSuggestions(tree, `${AGENTS}/payments-ops/`, {
      ...universalCtx,
      rowFor: (n) => (n.path.startsWith(`${AGENTS}/`) ? { type: 'agentCtx', description: 'payments-ops' } : {}),
    });
    expect(rows.find((r) => r.id === `${AGENTS}/payments-ops/agent.yaml`)).toMatchObject({
      type: 'agentCtx',
      description: 'payments-ops',
      selectable: true,
    });
  });

  it('an unknown directory yields only the Browse row', () => {
    expect(buildNavSuggestions(tree, 'ghost/', universalCtx)).toEqual([
      expect.objectContaining({ type: 'browse', id: 'context' }),
    ]);
  });
});

describe('buildNavSuggestions — canonical @target:', () => {
  it('root shows only directories that hold a writable file, none selectable', () => {
    const rows = buildNavSuggestions(tree, '', target);
    expect(ids(rows).sort()).toEqual(['architecture', 'meta', 'visual']);
    expect(rows.filter((r) => r.type !== 'browse').every((r) => r.selectable === false && r.enterable)).toBe(true);
    expect(rows[rows.length - 1]).toMatchObject({ type: 'browse', id: 'target' });
  });

  it('inside meta/, only the writable branch is offered; files are selectable', () => {
    expect(ids(buildNavSuggestions(tree, 'meta/', target))).toEqual(['meta/evals']);
    expect(buildNavSuggestions(tree, 'meta/evals/', target).find((r) => r.id === 'meta/evals/e.md')).toMatchObject({
      type: 'target',
      selectable: true,
      enterable: false,
    });
  });
});

describe('buildNavSuggestions — ranking and cap', () => {
  it('suggested-slot rows carry the ★ marker and sort first within their kind', () => {
    const rows = buildNavSuggestions(tree, '', {
      field: 'ref',
      selectableTypes: ['file', 'directory'],
      isOffered: (n) => !n.path.startsWith('sessions'),
      suggestedDirs: ['visual/ui/handoff'],
      labels,
    });
    expect(rows[0]).toMatchObject({ id: 'visual', group: 'suggested' });
    expect(rows.find((r) => r.id === 'plan')?.group).toBeUndefined();
    expect(rows[rows.length - 1]).toMatchObject({ type: 'browse', id: 'refs' });
  });

  it('past the per-level cap, an "N more" browse row precedes the plain Browse row', () => {
    const rows = buildNavSuggestions(tree, '', { ...universalCtx, perLevelCap: 2 });
    const all = ids(buildNavSuggestions(tree, '', universalCtx)).length;
    expect(ids(rows)).toHaveLength(2);
    expect(browseRows(rows).map((r) => r.label)).toEqual([`${all - 2} more`, 'Browse']);
    expect(browseRows(rows).every((r) => r.id === 'context')).toBe(true);
  });
});
