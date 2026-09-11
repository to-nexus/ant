/**
 * Builder handoff bundles — one self-contained markdown file per (builder,
 * job, intent) that lets an external agent do the builtin's job with no clone.
 *
 * The bundle is a RENDERING, never a source: Part 1 is the hand-written delta
 * document under `docs/guides/builder-handoff/`, Part 2 is the definition's
 * own files inlined in reading order, Part 3 the committed worked example.
 * The same composer serves `GET /definitions/agents/:id/handoff/:job/:intent`
 * (the running server's files — no version drift) and the `definition
 * handoff` CLI (a clone's files). Nothing here is hand-edited, so the contract
 * keeps one home; `tests/policy/builder-handoff-binding.test.ts` pins that the
 * output carries every source byte.
 */

import * as fs from 'fs';
import * as path from 'path';
import { INTENTS_DIR_NAME, ON_DEMAND_DIR_NAME } from '@ant/shared';

export interface BuilderHandoffSpec {
  /** File name under `docs/guides/builder-handoff/`. */
  doc: string;
  agentId: string;
  jobId: string;
  intentId: string;
  /** Build handoffs substitute EVERY route the builder can call; review handoffs use a subset. */
  routesComplete: boolean;
}

export const BUILDER_HANDOFF_DIR = 'docs/guides/builder-handoff';

/** The one table — the guard test, the route, the list decoration and the CLI all read it. */
export const BUILDER_HANDOFFS: readonly BuilderHandoffSpec[] = [
  { doc: 'agent-build.md', agentId: 'agent-builder', jobId: 'author', intentId: 'build', routesComplete: true },
  { doc: 'agent-review.md', agentId: 'agent-builder', jobId: 'author', intentId: 'review', routesComplete: false },
  { doc: 'pipeline-build.md', agentId: 'pipeline-builder', jobId: 'author', intentId: 'build', routesComplete: true },
  { doc: 'pipeline-review.md', agentId: 'pipeline-builder', jobId: 'author', intentId: 'review', routesComplete: false },
];

export function listBuilderHandoffs(agentId: string): BuilderHandoffSpec[] {
  return BUILDER_HANDOFFS.filter((h) => h.agentId === agentId);
}

export function findBuilderHandoff(agentId: string, jobId: string, intentId: string): BuilderHandoffSpec | undefined {
  return BUILDER_HANDOFFS.find((h) => h.agentId === agentId && h.jobId === jobId && h.intentId === intentId);
}

export interface HandoffRoots {
  /** The directory holding `{agentId}/…` builtin definitions. */
  agentsRoot: string;
  /** The monorepo `docs/` directory. */
  docsRoot: string;
  /** The monorepo `examples/` directory — omitted when absent (the runtime image ships docs only). */
  examplesRoot?: string;
}

const EXAMPLE_TREES = ['custom-agents/ops-team', 'pipelines/weekly-ops.yaml'];

function listFiles(abs: string): string[] {
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? listFiles(path.join(abs, e.name)) : [path.join(abs, e.name)]));
}

/**
 * The definition files a handoff's reader must hold, repo-relative, in the
 * order the runtime injects them: agent prose → job prose → job.yaml → the
 * handoff's own intent (criterion, prompt, hooks) → on-demand docs → the
 * sibling intents (the standard the other lane judges by).
 */
export function handoffReadList(spec: BuilderHandoffSpec, agentsRoot: string): string[] {
  const agentDir = path.join(agentsRoot, spec.agentId);
  const jobDir = path.join(agentDir, 'jobs', spec.jobId);
  const rel = (abs: string) => `packages/ant-cli/src/core/data/agents/${path.relative(agentsRoot, abs).split(path.sep).join('/')}`;
  const intentFiles = (intentId: string) =>
    ['infer.md', 'prompt.md', 'hooks.yaml']
      .map((f) => path.join(jobDir, INTENTS_DIR_NAME, intentId, f))
      .filter((f) => fs.existsSync(f));
  const intentsDir = path.join(jobDir, INTENTS_DIR_NAME);
  const siblings = fs.existsSync(intentsDir)
    ? fs
        .readdirSync(intentsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== spec.intentId)
        .map((e) => e.name)
        .sort()
    : [];
  return [
    ...listFiles(path.join(agentDir, 'base')),
    ...listFiles(path.join(jobDir, 'base')),
    path.join(jobDir, 'job.yaml'),
    ...intentFiles(spec.intentId),
    ...listFiles(path.join(agentDir, ON_DEMAND_DIR_NAME)),
    ...listFiles(path.join(jobDir, ON_DEMAND_DIR_NAME)),
    ...siblings.flatMap(intentFiles),
  ].map(rel);
}

function renderFile(repoRel: string, content: string): string {
  const ext = path.extname(repoRel);
  const body = ext === '.md' ? content.trimEnd() : `\`\`\`${ext.slice(1)}\n${content.trimEnd()}\n\`\`\``;
  return `---\n\n## FILE: \`${repoRel}\`\n\n${body}\n`;
}

/** Compose the bundle. Throws when the delta document or a read-list file is missing — a partial bundle is worse than none. */
export function composeBuilderHandoff(spec: BuilderHandoffSpec, roots: HandoffRoots, now: Date = new Date()): string {
  const repoRoot = path.resolve(roots.docsRoot, '..');
  const docPath = path.join(roots.docsRoot, 'guides', 'builder-handoff', spec.doc);
  const delta = fs.readFileSync(docPath, 'utf-8').trimEnd();
  const readList = handoffReadList(spec, roots.agentsRoot);

  const parts: string[] = [];
  parts.push(
    `<!-- Generated ${now.toISOString()} by composeBuilderHandoff — do not edit. Sources: ` +
      `${BUILDER_HANDOFF_DIR}/${spec.doc} and the definition files inlined below. -->`,
    '',
    `# Handoff bundle — ${spec.agentId} / ${spec.jobId} / ${spec.intentId}`,
    '',
    'This file is self-contained. **Part 1** is the handoff: what to produce, where, and how',
    'each runtime instruction translates offline. **Part 2** inlines every contract file the',
    'handoff tells you to read, in reading order — the same bytes a clone would give you.',
    '**Part 3** is a worked example that already passes the validators.',
    '',
    'You need no clone of the Ant repository. If you have one at the same version, prefer',
    'the files at their paths and the `pnpm --filter @ant/cli definition` validator; without',
    'one, the import into Ant is the validator — its response carries the loader verdict.',
    '',
    '**Working directory.** Work in the directory the person names. When none is named,',
    'create a fresh folder OUTSIDE any Ant clone (never inside `packages/`, `docs/` or the',
    'repository root — the deliverables would land in its git working tree). No layout is',
    'prescribed beyond the two or three names the handoff says bind; keep what you were',
    'given apart from what you produce, and say where you put things when you report.',
    '',
    '# Part 1 — Handoff',
    '',
    delta,
    '',
    '# Part 2 — Contract files, in reading order',
    '',
    'Each file below is the shipped source, verbatim. Where Part 1 says "read',
    '`packages/ant-cli/src/core/data/agents/…`", this is that file.',
    '',
  );
  for (const rel of readList) {
    const abs = path.join(repoRoot, rel);
    parts.push(renderFile(rel, fs.readFileSync(abs, 'utf-8')));
  }

  if (roots.examplesRoot && fs.existsSync(roots.examplesRoot)) {
    parts.push('', '# Part 3 — Worked example', '', 'A definition and a pipeline that pass `validate-agent` and `validate-pipeline` as committed.', '');
    for (const tree of EXAMPLE_TREES) {
      for (const abs of listFiles(path.join(roots.examplesRoot, tree))) {
        const rel = `examples/${path.relative(roots.examplesRoot, abs).split(path.sep).join('/')}`;
        parts.push(renderFile(rel, fs.readFileSync(abs, 'utf-8')));
      }
    }
  }
  return parts.join('\n') + '\n';
}
