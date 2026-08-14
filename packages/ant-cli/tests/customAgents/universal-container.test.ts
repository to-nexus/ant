/**
 * Universal container axis — feature-slot resolution, the bidirectional
 * project-type × jobType gate, container bootstrap, and the per-(agentId,
 * jobId) session path shape. Fixtures live under os.tmpdir() per test.
 *
 * Tombstones (valid in the thread-removal commit): the thread plane
 * (`threadPaths.ts`, `ANT_THREAD_ID`) is fully deleted — universal projects
 * have exactly one chat container at `{project}/universal`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import {
  buildUniversalMergedTree,
  decideProjectJobGate,
  ensureUniversalContainer,
  getUniversalContainerPathOf,
  isUniversalProject,
  listUniversalContainers,
  moveUniversalAgentData,
  reconcileUniversalContainer,
  resolveUniversalContainerPath,
  resolveUniversalMergedPath,
  UNIVERSAL_ARTIFACT_CANONICAL_DIRS,
  UNIVERSAL_TREE_MAX_DEPTH,
  UNIVERSAL_TREE_MAX_ENTRIES,
} from '../../src/core/customAgents/universalContainer';
import { createEmptyFigmaData } from '@ant/shared';
import { ensureCanonicalStructure, getSessionFilePath } from '../../src/core/utils/sessionPaths';

let projectPath: string;

function writeConfig(config: unknown): void {
  fs.writeFileSync(path.join(projectPath, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
}

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-universal-container-'));
});

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true });
});

describe('resolveUniversalContainerPath — feature-slot truth table', () => {
  it.each([
    ['universal project + universal feature → container', { projectType: 'universal' }, UNIVERSAL_FEATURE, true],
    ['universal project + other feature → null', { projectType: 'universal' }, 'main', false],
    ['canonical project + universal feature → null', { projectType: 'canonical' }, UNIVERSAL_FEATURE, false],
    ['absent projectType + universal feature → null', {}, UNIVERSAL_FEATURE, false],
    ['malformed config → null', '{{{not json', UNIVERSAL_FEATURE, false],
  ] as const)('%s', (_label, config, featureName, resolves) => {
    writeConfig(config);
    const resolved = resolveUniversalContainerPath(projectPath, featureName);
    if (resolves) {
      expect(resolved).toBe(path.join(projectPath, 'universal'));
    } else {
      expect(resolved).toBeNull();
    }
  });

  it('missing config.json → null (and isUniversalProject false)', () => {
    expect(resolveUniversalContainerPath(projectPath, UNIVERSAL_FEATURE)).toBeNull();
    expect(isUniversalProject(projectPath)).toBe(false);
  });
});

describe('decideProjectJobGate — bidirectional truth table', () => {
  it.each([
    ['universal × code', 'universal', 'code', 'project-universal-requires-custom-job'],
    ['universal × design', 'universal', 'design', 'project-universal-requires-custom-job'],
    ['universal × learn', 'universal', 'learn', 'project-universal-requires-custom-job'],
    ['universal × plan', 'universal', 'plan', 'project-universal-requires-custom-job'],
    ['universal × visual', 'universal', 'visual', 'project-universal-requires-custom-job'],
    ['universal × inline-ask', 'universal', 'inline-ask', 'project-universal-requires-custom-job'],
    ['universal × universal', 'universal', 'universal', null],
    ['canonical × universal', 'canonical', 'universal', 'project-not-universal'],
    ['canonical × code', 'canonical', 'code', null],
    ['absent (defaults canonical) × universal', undefined, 'universal', 'project-not-universal'],
    ['absent (defaults canonical) × code', undefined, 'code', null],
  ] as const)('%s', (_label, projectType, jobType, expectedCode) => {
    const gate = decideProjectJobGate(projectType, jobType);
    if (expectedCode === null) {
      expect(gate).toEqual({ ok: true });
    } else {
      expect(gate).toEqual({ ok: false, code: expectedCode });
    }
  });
});

describe('ensureUniversalContainer', () => {
  it('materializes artifacts/ (+ canonical dirs) + sessions/ and is idempotent', () => {
    ensureUniversalContainer(projectPath);
    const container = getUniversalContainerPathOf(projectPath);
    expect(fs.statSync(path.join(container, 'artifacts')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(container, 'sessions')).isDirectory()).toBe(true);
    for (const dir of UNIVERSAL_ARTIFACT_CANONICAL_DIRS) {
      expect(fs.statSync(path.join(container, 'artifacts', dir)).isDirectory()).toBe(true);
    }
    expect(() => ensureUniversalContainer(projectPath)).not.toThrow();
  });

  it('canonical dir set matches the codespace vocabulary (plan)', () => {
    expect([...UNIVERSAL_ARTIFACT_CANONICAL_DIRS]).toEqual(['plan']);
  });
});

describe('per-(agentId, jobId) session path shape', () => {
  it('mirrors the canonical sessions/{agent}/{jobType}.json layout', () => {
    const container = getUniversalContainerPathOf(projectPath);
    expect(getSessionFilePath(container, 'assistant', 'chat')).toBe(
      path.join(projectPath, 'universal', 'sessions', 'assistant', 'chat.json'),
    );
  });
});

/**
 * Agent-id-keyed container data is per PROJECT while the definition is
 * account-wide, so an id rename has to sweep every universal project — these
 * rows pin what the sweep sees and what it refuses to touch.
 */
describe('listUniversalContainers / moveUniversalAgentData', () => {
  let workspacePath: string;

  function seedProject(projectId: string, projectType: string, agentId?: string): string {
    const project = path.join(workspacePath, projectId);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'config.json'), JSON.stringify({ projectType }));
    if (agentId) {
      const sessions = path.join(project, 'universal/sessions', agentId);
      fs.mkdirSync(sessions, { recursive: true });
      fs.writeFileSync(
        path.join(sessions, 'chat.json'),
        JSON.stringify({ state: { customJobRef: `${agentId}/chat` } }),
      );
      fs.mkdirSync(path.join(project, 'universal/artifacts/plan', agentId), { recursive: true });
    }
    return project;
  }

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-workspace-'));
  });

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('lists universal projects only — canonical projects and dotfiles are skipped', () => {
    seedProject('uni', 'universal');
    seedProject('canon', 'canonical');
    fs.mkdirSync(path.join(workspacePath, '.ant/agents'), { recursive: true });

    expect(listUniversalContainers(workspacePath).map((c) => c.projectId)).toEqual(['uni']);
  });

  it('moves sessions + plan dirs across projects and rewrites the recorded ref', () => {
    seedProject('a', 'universal', 'ops');
    seedProject('b', 'universal', 'ops');
    seedProject('c', 'universal'); // universal but untouched by this agent

    const { movedProjects, conflicts } = moveUniversalAgentData(workspacePath, 'ops', 'ops-team');
    expect(conflicts).toEqual([]);
    expect(movedProjects.sort()).toEqual(['a', 'b']);

    for (const projectId of ['a', 'b']) {
      const base = path.join(workspacePath, projectId, 'universal');
      expect(fs.existsSync(path.join(base, 'sessions/ops'))).toBe(false);
      expect(fs.existsSync(path.join(base, 'artifacts/plan/ops-team'))).toBe(true);
      const session = JSON.parse(fs.readFileSync(path.join(base, 'sessions/ops-team/chat.json'), 'utf-8'));
      expect(session.state.customJobRef).toBe('ops-team/chat');
    }
  });

  it('dryRun reports conflicts and moves nothing', () => {
    seedProject('a', 'universal', 'ops');
    fs.mkdirSync(path.join(workspacePath, 'a/universal/sessions/ops-team'), { recursive: true });

    const dry = moveUniversalAgentData(workspacePath, 'ops', 'ops-team', { dryRun: true });
    expect(dry.conflicts).toHaveLength(1);
    expect(fs.existsSync(path.join(workspacePath, 'a/universal/sessions/ops'))).toBe(true);
  });
});

describe('resolveUniversalMergedPath — merged-path routing truth table', () => {
  const container = () => getUniversalContainerPathOf(projectPath);

  it.each([
    ['artifact file → artifacts root', 'plan/notes.md', ['universal', 'artifacts', 'plan', 'notes.md']],
    ['free file → artifacts root', 'briefs/a.md', ['universal', 'artifacts', 'briefs', 'a.md']],
    ['sessions file → sessions root', 'sessions/chat.jsonl', ['universal', 'sessions', 'chat.jsonl']],
    ['bare sessions → sessions root itself', 'sessions', ['universal', 'sessions']],
    ['name-collision guard: artifacts/sessions-x stays in artifacts', 'sessions-x/a.md', ['universal', 'artifacts', 'sessions-x', 'a.md']],
    ['backslash normalization', 'plan\\notes.md', ['universal', 'artifacts', 'plan', 'notes.md']],
  ] as const)('%s', (_label, rel, expectedSegments) => {
    expect(resolveUniversalMergedPath(container(), rel)).toBe(path.join(projectPath, ...expectedSegments));
  });

  it.each([
    ['traversal out of artifacts', '../outside.md'],
    ['traversal out of sessions', 'sessions/../../outside.md'],
  ] as const)('rejects %s', (_label, rel) => {
    expect(() => resolveUniversalMergedPath(container(), rel)).toThrow(/Invalid artifact path/);
  });
});

describe('buildUniversalMergedTree — assembly contract', () => {
  it('canonical plan first (synthesized when missing), free content next, sessions last', () => {
    ensureUniversalContainer(projectPath);
    const container = getUniversalContainerPathOf(projectPath);
    fs.mkdirSync(path.join(container, 'artifacts', 'briefs'), { recursive: true });
    fs.writeFileSync(path.join(container, 'artifacts', 'briefs', 'a.md'), 'x');
    fs.writeFileSync(path.join(container, 'sessions', 'chat.jsonl'), '');
    // Reserved-name shadowing: an agent-created artifacts/sessions dir is hidden.
    fs.mkdirSync(path.join(container, 'artifacts', 'sessions'), { recursive: true });

    const tree = buildUniversalMergedTree(container);
    expect(tree[0]).toMatchObject({ name: 'plan', type: 'directory', path: 'plan' });
    expect(tree[tree.length - 1]).toMatchObject({ name: 'sessions', type: 'directory', path: 'sessions' });
    const names = tree.map((n) => n.name);
    expect(names.filter((n) => n === 'sessions')).toHaveLength(1);
    const briefs = tree.find((n) => n.name === 'briefs');
    expect(briefs?.children?.[0]).toMatchObject({ name: 'a.md', path: 'briefs/a.md', type: 'file' });
    const sessions = tree[tree.length - 1];
    expect(sessions.children?.some((c) => c.path === 'sessions/chat.jsonl')).toBe(true);
  });

  it('synthesizes the plan node when the dir is missing on disk', () => {
    const container = getUniversalContainerPathOf(projectPath);
    const tree = buildUniversalMergedTree(container);
    expect(tree[0]).toMatchObject({ name: 'plan', type: 'directory', children: [] });
  });

  // H-008: the walk is synchronous over a tree the requesting account controls,
  // so it needs a bound — otherwise a deep or wide artifact tree plus repeated
  // polling monopolises the shared event loop.
  describe('traversal budget', () => {
    const countNodes = (nodes: any[]): number =>
      nodes.reduce((n, node) => n + 1 + countNodes(node.children ?? []), 0);

    it('stops descending past the depth cap and marks the cut', () => {
      ensureUniversalContainer(projectPath);
      const container = getUniversalContainerPathOf(projectPath);
      const deep = path.join(
        container,
        'artifacts',
        ...Array.from({ length: UNIVERSAL_TREE_MAX_DEPTH + 5 }, (_, i) => `d${i}`),
      );
      fs.mkdirSync(deep, { recursive: true });

      const tree = buildUniversalMergedTree(container);
      const depthOf = (nodes: any[], d = 1): number =>
        nodes.reduce((max, n) => Math.max(max, n.children?.length ? depthOf(n.children, d + 1) : d), 0);
      expect(depthOf(tree)).toBeLessThanOrEqual(UNIVERSAL_TREE_MAX_DEPTH + 1);

      const findTruncated = (nodes: any[]): boolean =>
        nodes.some((n) => n.truncated === true || findTruncated(n.children ?? []));
      expect(findTruncated(tree)).toBe(true);
    });

    it('stops at the entry cap across BOTH roots, not per root', () => {
      ensureUniversalContainer(projectPath);
      const container = getUniversalContainerPathOf(projectPath);
      const wide = path.join(container, 'artifacts', 'many');
      fs.mkdirSync(wide, { recursive: true });
      for (let i = 0; i < UNIVERSAL_TREE_MAX_ENTRIES + 200; i++) {
        fs.writeFileSync(path.join(wide, `f${i}.md`), 'x');
      }
      fs.writeFileSync(path.join(container, 'sessions', 'chat.jsonl'), '');

      const tree = buildUniversalMergedTree(container);
      // canonical placeholders are synthesized, not walked, so allow for them
      const walked = countNodes(tree) - UNIVERSAL_ARTIFACT_CANONICAL_DIRS.length;
      expect(walked).toBeLessThanOrEqual(UNIVERSAL_TREE_MAX_ENTRIES + 2);
    });

    it('leaves an ordinary small tree untouched', () => {
      ensureUniversalContainer(projectPath);
      const container = getUniversalContainerPathOf(projectPath);
      fs.mkdirSync(path.join(container, 'artifacts', 'briefs'), { recursive: true });
      fs.writeFileSync(path.join(container, 'artifacts', 'briefs', 'a.md'), 'x');

      const tree = buildUniversalMergedTree(container);
      const briefs = tree.find((n) => n.name === 'briefs');
      expect(briefs?.truncated).toBeUndefined();
      expect(briefs?.children).toHaveLength(1);
    });
  });
});

describe('reconcileUniversalContainer — pollution sweep rows', () => {
  const container = () => getUniversalContainerPathOf(projectPath);

  beforeEach(() => {
    writeConfig({ projectType: 'universal' });
    ensureUniversalContainer(projectPath);
  });

  it('deletes empty canonical-skeleton dirs (architecture/visual/assets/meta + builtin session agents)', () => {
    for (const dir of ['architecture/system', 'visual/ui/ant', 'assets/service', 'meta/evals/prd']) {
      fs.mkdirSync(path.join(container(), dir), { recursive: true });
    }
    for (const agent of ['architect', 'planner', 'creator']) {
      fs.mkdirSync(path.join(container(), 'sessions', agent, 'debug', 'prompts'), { recursive: true });
    }
    reconcileUniversalContainer(projectPath);
    for (const dir of ['architecture', 'visual', 'assets', 'meta']) {
      expect(fs.existsSync(path.join(container(), dir))).toBe(false);
    }
    for (const agent of ['architect', 'planner', 'creator']) {
      expect(fs.existsSync(path.join(container(), 'sessions', agent))).toBe(false);
    }
    expect(fs.existsSync(path.join(container(), 'artifacts', 'plan'))).toBe(true);
    expect(fs.existsSync(path.join(container(), 'sessions'))).toBe(true);
  });

  it('deletes dirs whose only files are byte-identical factory placeholders', () => {
    const figmaDir = path.join(container(), 'visual', 'ui', 'figma');
    fs.mkdirSync(figmaDir, { recursive: true });
    fs.writeFileSync(path.join(figmaDir, 'figma.json'), JSON.stringify(createEmptyFigmaData(), null, 2));
    reconcileUniversalContainer(projectPath);
    expect(fs.existsSync(path.join(container(), 'visual'))).toBe(false);
  });

  it('user bytes are inviolable — a dir with real data is kept', () => {
    const dir = path.join(container(), 'visual', 'ui');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'user-notes.md'), 'my data');
    reconcileUniversalContainer(projectPath);
    expect(fs.readFileSync(path.join(dir, 'user-notes.md'), 'utf-8')).toBe('my data');
  });

  it('removes the phantom features/universal plane (and features/ once empty)', () => {
    fs.mkdirSync(path.join(projectPath, 'features', 'universal', 'sessions', 'universal'), { recursive: true });
    reconcileUniversalContainer(projectPath);
    expect(fs.existsSync(path.join(projectPath, 'features'))).toBe(false);
  });

  it('keeps a phantom plane that carries user data (and sibling features)', () => {
    fs.mkdirSync(path.join(projectPath, 'features', 'universal'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'features', 'universal', 'user.md'), 'keep');
    reconcileUniversalContainer(projectPath);
    expect(fs.existsSync(path.join(projectPath, 'features', 'universal', 'user.md'))).toBe(true);
  });
});

describe('ensureCanonicalStructure — universal-plane no-op guard', () => {
  it.each([
    ['universal container', () => path.join(projectPath, 'universal')],
    ['phantom features/universal', () => path.join(projectPath, 'features', 'universal')],
  ] as const)('refuses to scaffold on the %s of a universal project', async (_label, target) => {
    writeConfig({ projectType: 'universal' });
    fs.mkdirSync(target(), { recursive: true });
    const result = await ensureCanonicalStructure(target());
    expect(result).toEqual({ createdDirs: 0, createdFiles: 0 });
    expect(fs.existsSync(path.join(target(), 'architecture'))).toBe(false);
    expect(fs.existsSync(path.join(target(), 'sessions', 'architect'))).toBe(false);
  });

  it('still scaffolds a canonical feature dir normally', async () => {
    writeConfig({ projectType: 'canonical' });
    const featurePath = path.join(projectPath, 'features', 'main');
    fs.mkdirSync(featurePath, { recursive: true });
    const result = await ensureCanonicalStructure(featurePath);
    expect(result.createdDirs).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(featurePath, 'plan'))).toBe(true);
  });
});

describe('thread-plane tombstones (deletion commit)', () => {
  it('threadPaths.ts stays deleted', () => {
    expect(fs.existsSync(path.join(__dirname, '../../src/core/customAgents/threadPaths.ts'))).toBe(false);
  });

  it('ANT_THREAD_ID never appears in ant-cli sources', () => {
    const srcRoot = path.join(__dirname, '../../src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(full, 'utf-8').includes('ANT_THREAD_ID')) {
          hits.push(full);
        }
      }
    };
    walk(srcRoot);
    expect(hits).toEqual([]);
  });
});
