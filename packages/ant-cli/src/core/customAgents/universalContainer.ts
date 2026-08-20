/**
 * Universal container resolution — the single seam that maps the constant
 * `UNIVERSAL_FEATURE` (`'universal'`) riding the `:feature` slot to the
 * on-disk container `{project}/universal` on universal-type projects.
 *
 * Layout (D6 — layout is invariant, project type is policy):
 *   {project}/universal/artifacts/                    user workspace files (codebasePath)
 *   {project}/universal/sessions/{agentId}/{jobId}.json  per-(agent, job) LLM session
 *   {project}/universal/sessions/chat.jsonl           one chat per workspace
 *   {project}/universal/sessions/feature.jsonl        prompt context SSOT
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileNode } from '@ant/shared';
import { CANONICAL_FEATURE_DIRS, UNIVERSAL_FEATURE, UNIVERSAL_PIPELINE_RUNS_DIRNAME, createEmptyFigmaData } from '@ant/shared';
import { computeFileMeta, shouldEvaluateTemplate } from '../utils/computeFileMeta';
import { PIPELINE_ACTIVATIONS_DIRNAME } from '../pipelines/paths';

export const UNIVERSAL_DIRNAME = 'universal';
export const UNIVERSAL_ARTIFACTS_DIRNAME = 'artifacts';

/**
 * Canonical dirs inside `universal/artifacts/` — always present, never
 * deletable/renamable (delete = clear contents), mirroring the codespace
 * canonical dirs. `plan` matches the codespace feature dir name so plan
 * artifacts read the same across project kinds.
 */
export const UNIVERSAL_ARTIFACT_CANONICAL_DIRS = ['plan'] as const;

export function isUniversalProject(projectPath: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'config.json'), 'utf-8');
    return JSON.parse(raw)?.projectType === 'universal';
  } catch {
    return false;
  }
}

export function getUniversalContainerPathOf(projectPath: string): string {
  return path.join(projectPath, UNIVERSAL_DIRNAME);
}

/**
 * Returns the container path when `featureName` is the universal pseudo-feature
 * on a universal-type project; null otherwise (canonical projects fall through
 * to their normal feature path resolution).
 */
export function resolveUniversalContainerPath(projectPath: string, featureName: string): string | null {
  if (featureName !== UNIVERSAL_FEATURE) return null;
  if (!isUniversalProject(projectPath)) return null;
  return getUniversalContainerPathOf(projectPath);
}

/**
 * Materializes `{container}/artifacts` (+ its canonical dirs) and
 * `{container}/sessions`. Idempotent. Must run before any session/chat
 * write — FileSessionAdapter's ghost-guard silently drops appends when the
 * container directory does not exist. Also sweeps legacy canonical-skeleton
 * pollution (see {@link reconcileUniversalContainer}).
 */
export function ensureUniversalContainer(projectPath: string): void {
  const container = getUniversalContainerPathOf(projectPath);
  for (const dir of UNIVERSAL_ARTIFACT_CANONICAL_DIRS) {
    fs.mkdirSync(path.join(container, UNIVERSAL_ARTIFACTS_DIRNAME, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(container, 'sessions'), { recursive: true });
  try {
    reconcileUniversalContainer(projectPath);
  } catch (e) {
    console.warn(`⚠️ [UniversalContainer] reconcile failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── agent-id-keyed container data ────────────────────────────────────────────

/**
 * Container paths keyed by the AGENT id. Definitions live account-wide under
 * `.ant/agents/{agentId}`, but these two live per project — so renaming an
 * agent has to sweep every universal project of the account, not just the
 * current one.
 */
function agentKeyedDirsOf(container: string, agentId: string): string[] {
  return [
    path.join(container, 'sessions', agentId),
    path.join(container, UNIVERSAL_ARTIFACTS_DIRNAME, 'plan', agentId),
  ];
}

/** Every universal container under an account workspace (`workspaces/{org}/{user}`). */
export function listUniversalContainers(workspacePath: string): Array<{ projectId: string; container: string }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workspacePath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ projectId: e.name, projectPath: path.join(workspacePath, e.name) }))
    .filter((p) => isUniversalProject(p.projectPath))
    .map((p) => ({ projectId: p.projectId, container: getUniversalContainerPathOf(p.projectPath) }));
}

export interface AgentDataMoveResult {
  /** Project ids that had (or would have had) data moved. */
  movedProjects: string[];
  /** Destination paths already occupied — the caller must refuse before moving anything. */
  conflicts: string[];
}

/**
 * Move the container data keyed by `oldId` to `newId` across the account.
 *
 * Callers MUST run this with `dryRun` first and refuse on any conflict: a
 * partial move would split one agent's memory across two ids with no way back.
 * The session JSON also records `customJobRef` for forensics; it is patched
 * best-effort (nothing reads it back, so a failure there is not worth aborting
 * an otherwise complete move).
 */
export function moveUniversalAgentData(
  workspacePath: string,
  oldId: string,
  newId: string,
  opts: { dryRun?: boolean } = {},
): AgentDataMoveResult {
  const movedProjects: string[] = [];
  const conflicts: string[] = [];

  for (const { projectId, container } of listUniversalContainers(workspacePath)) {
    const sources = agentKeyedDirsOf(container, oldId);
    const targets = agentKeyedDirsOf(container, newId);
    let touched = false;

    for (const [i, source] of sources.entries()) {
      if (!fs.existsSync(source)) continue;
      touched = true;
      if (fs.existsSync(targets[i])) {
        conflicts.push(targets[i]);
        continue;
      }
      if (opts.dryRun) continue;
      fs.mkdirSync(path.dirname(targets[i]), { recursive: true });
      fs.renameSync(source, targets[i]);
      if (i === 0) patchSessionRefs(targets[i], newId);
    }
    if (touched) movedProjects.push(projectId);
  }

  return { movedProjects, conflicts };
}

/**
 * Container paths keyed by the (agent, job) PAIR — the per-job session file and
 * the job's plan artifacts. The agent segment is untouched here: a job rename
 * moves only what the job id names.
 */
function jobKeyedPathsOf(container: string, agentId: string, jobId: string): string[] {
  return [
    path.join(container, 'sessions', agentId, `${jobId}.json`),
    path.join(container, UNIVERSAL_ARTIFACTS_DIRNAME, 'plan', agentId, jobId),
  ];
}

/**
 * Job-id counterpart of {@link moveUniversalAgentData} — same dry-run-then-move
 * contract, same reason: leaving `sessions/{agent}/{oldJob}.json` behind would
 * silently reset the job's memory in every project of the account.
 */
export function moveUniversalJobData(
  workspacePath: string,
  agentId: string,
  oldJobId: string,
  newJobId: string,
  opts: { dryRun?: boolean } = {},
): AgentDataMoveResult {
  const movedProjects: string[] = [];
  const conflicts: string[] = [];

  for (const { projectId, container } of listUniversalContainers(workspacePath)) {
    const sources = jobKeyedPathsOf(container, agentId, oldJobId);
    const targets = jobKeyedPathsOf(container, agentId, newJobId);
    let touched = false;

    for (const [i, source] of sources.entries()) {
      if (!fs.existsSync(source)) continue;
      touched = true;
      if (fs.existsSync(targets[i])) {
        conflicts.push(targets[i]);
        continue;
      }
      if (opts.dryRun) continue;
      fs.mkdirSync(path.dirname(targets[i]), { recursive: true });
      fs.renameSync(source, targets[i]);
      if (i === 0) patchSessionFileRef(targets[i], undefined, newJobId);
    }
    if (touched) movedProjects.push(projectId);
  }

  return { movedProjects, conflicts };
}

/** Rewrite the recorded `{agentId}/{jobId}` inside moved session files. */
function patchSessionRefs(sessionDir: string, newAgentId: string): void {
  let files: string[];
  try {
    files = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }
  for (const file of files) {
    patchSessionFileRef(path.join(sessionDir, file), newAgentId, undefined);
  }
}

/** Patch one session file's `customJobRef` segment(s); best-effort by contract. */
function patchSessionFileRef(full: string, newAgentId?: string, newJobId?: string): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(full, 'utf-8'));
    const ref = parsed?.state?.customJobRef;
    if (typeof ref !== 'string') return;
    const [agent, job] = ref.split('/');
    parsed.state.customJobRef = `${newAgentId ?? agent ?? ''}/${newJobId ?? job ?? ''}`;
    fs.writeFileSync(full, JSON.stringify(parsed, null, 2), 'utf-8');
  } catch {
    /* forensic field only — never fail the move over it */
  }
}

/**
 * Factory placeholder contents keyed by canonical relative path — a polluted
 * dir is deletable only when every file in it is byte-identical to the
 * placeholder that `ensureCanonicalStructure` would have written there.
 */
const PLACEHOLDER_FACTORIES: Record<string, () => string> = {
  'visual/ui/figma/figma.json': () => JSON.stringify(createEmptyFigmaData(), null, 2),
  'visual/game-art/figma/figma.json': () => JSON.stringify(createEmptyFigmaData(), null, 2),
};

/**
 * True when the dir holds nothing but empty subdirs and factory-placeholder
 * files (byte-equal at their canonical relative path). Any user byte keeps
 * the dir.
 */
function isFactoryResidueOnly(absDir: string, relFromPlaneRoot: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const absChild = path.join(absDir, entry.name);
    const relChild = relFromPlaneRoot ? `${relFromPlaneRoot}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!isFactoryResidueOnly(absChild, relChild)) return false;
    } else if (entry.isFile()) {
      const factory = PLACEHOLDER_FACTORIES[relChild];
      if (!factory) return false;
      try {
        if (!fs.readFileSync(absChild).equals(Buffer.from(factory(), 'utf-8'))) return false;
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

/** Derived from the canonical dir SSOT: top-level pollution roots (minus the
 * legitimate universal `plan`) and the builtin session agent dirs. */
const POLLUTION_TOP_DIRS = Array.from(
  new Set(CANONICAL_FEATURE_DIRS.map((d) => d.split('/')[0])),
).filter((d) => d !== 'plan' && d !== 'sessions');
const POLLUTION_SESSION_AGENTS = Array.from(
  new Set(
    CANONICAL_FEATURE_DIRS.filter((d) => d.startsWith('sessions/')).map((d) => d.split('/')[1]),
  ),
);

function sweepResidueDir(absDir: string, relFromPlaneRoot: string): boolean {
  if (!fs.existsSync(absDir)) return false;
  if (!isFactoryResidueOnly(absDir, relFromPlaneRoot)) {
    console.warn(
      `⚠️ [UniversalContainer] canonical-skeleton dir carries user data — kept as-is: ${absDir}`,
    );
    return false;
  }
  fs.rmSync(absDir, { recursive: true, force: true });
  return true;
}

/**
 * One-shot cleanup of historical pollution (idempotent, cheap when clean):
 *   1. Canonical skeleton dirs stamped into the container root by the
 *      pre-gate FileTreeBroadcaster (`architecture/visual/assets/meta` +
 *      `sessions/{architect,planner,creator}`) — deleted only when they hold
 *      nothing beyond empty dirs / byte-identical factory placeholders.
 *   2. The phantom `{project}/features/universal` plane minted by
 *      universal-unaware cleanup paths (and `features/` itself once empty).
 * User bytes are inviolable — a dir with real data is kept and logged.
 */
export function reconcileUniversalContainer(projectPath: string): void {
  const container = getUniversalContainerPathOf(projectPath);

  for (const dir of POLLUTION_TOP_DIRS) {
    sweepResidueDir(path.join(container, dir), dir);
  }
  for (const agent of POLLUTION_SESSION_AGENTS) {
    sweepResidueDir(path.join(container, 'sessions', agent), `sessions/${agent}`);
  }

  const featuresDir = path.join(projectPath, 'features');
  const phantom = path.join(featuresDir, UNIVERSAL_FEATURE);
  if (fs.existsSync(phantom)) {
    sweepResidueDir(phantom, '');
    try {
      if (fs.existsSync(featuresDir) && fs.readdirSync(featuresDir).length === 0) {
        fs.rmdirSync(featuresDir);
      }
    } catch { /* best-effort */ }
  }
}

// ── Merged view (artifacts tree + grafted sessions node) ────────────────────

/** Reserved top-level node name — the grafted sessions folder. */
export const UNIVERSAL_SESSIONS_NODE = 'sessions';

/**
 * Reserved top-level node name — the grafted pipeline run-log folder
 * (read-only: every mutation route blocks the prefix, sessions-guard style).
 * Name SSOT: `@ant/shared` (the FE panel keys its permissions on it).
 */
export const UNIVERSAL_PIPELINE_RUNS_NODE = UNIVERSAL_PIPELINE_RUNS_DIRNAME;

/**
 * Activation run-log dir for the project that owns this container. Structural
 * mapping, no activation required: containerPath is
 * `{ws}/{org}/{user}/{projectId}/universal` and activations anchor at the
 * SAME active-org account (`deriveActivationsRoot` — no individual fork), so
 * `{ws}/{org}/{user}/.ant/pipeline-activations/{projectId}/runs` is derivable.
 * Runs survive deactivation, so the graft outlives the activation too.
 */
export function getPipelineRunsRootOf(containerPath: string): string {
  const projectPath = path.dirname(containerPath);
  const userDir = path.dirname(projectPath);
  return path.join(userDir, PIPELINE_ACTIVATIONS_DIRNAME, path.basename(projectPath), 'runs');
}

/** Path-traversal-safe resolve inside a root. */
function resolveWithinRoot(root: string, rel: string): string {
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Invalid artifact path: ${rel}`);
  }
  return full;
}

/**
 * Merged-path routing SSOT: the explorer shows the artifacts tree with a
 * top-level `sessions` node grafted in (mirrors the codespace per-feature
 * sessions folder). Paths under `sessions/` resolve against the container's
 * sessions dir; everything else against `{container}/artifacts`.
 */
export function resolveUniversalMergedPath(containerPath: string, rel: string): string {
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized === UNIVERSAL_SESSIONS_NODE || normalized.startsWith(`${UNIVERSAL_SESSIONS_NODE}/`)) {
    const remainder = normalized === UNIVERSAL_SESSIONS_NODE ? '' : normalized.slice(UNIVERSAL_SESSIONS_NODE.length + 1);
    return resolveWithinRoot(path.join(containerPath, UNIVERSAL_SESSIONS_NODE), remainder);
  }
  if (normalized === UNIVERSAL_PIPELINE_RUNS_NODE || normalized.startsWith(`${UNIVERSAL_PIPELINE_RUNS_NODE}/`)) {
    const remainder = normalized === UNIVERSAL_PIPELINE_RUNS_NODE ? '' : normalized.slice(UNIVERSAL_PIPELINE_RUNS_NODE.length + 1);
    return resolveWithinRoot(getPipelineRunsRootOf(containerPath), remainder);
  }
  return resolveWithinRoot(path.join(containerPath, UNIVERSAL_ARTIFACTS_DIRNAME), normalized);
}

/** One node of the merged universal tree (SSOT for both the artifacts route
 * and FileOperationService.getFileTree — the two consumers decorate it into
 * their own node shapes). */
export interface UniversalTreeNode {
  name: string;
  /** Merged-view relative path (`plan/...`, `notes.md`, `sessions/...`). */
  path: string;
  type: 'file' | 'directory';
  size?: number;
  mtimeMs?: number;
  absolutePath: string;
  children?: UniversalTreeNode[];
  /** Set when the traversal budget cut this directory's listing short. */
  truncated?: boolean;
}

/**
 * Traversal budget for the merged tree.
 *
 * The walk is synchronous and recursive over a directory the requesting account
 * controls, so an account that creates a deep or wide artifact tree and polls
 * the endpoint monopolises the shared event loop and the filesystem (H-008).
 * Truncation is visible in the response rather than silent: a `truncated`
 * directory tells the UI it is not showing everything.
 */
export const UNIVERSAL_TREE_MAX_DEPTH = 12;
export const UNIVERSAL_TREE_MAX_ENTRIES = 5000;

interface TraversalBudget {
  remaining: number;
  /** Set when the budget ran out at the very top level, where no parent node can carry the flag. */
  rootTruncated?: boolean;
}

/**
 * Read at most `budget.remaining` entries from a directory, charging the budget as
 * each raw entry is read.
 *
 * `readdirSync` materialises and sorts the WHOLE directory before any budget can
 * apply, so a directory with a million entries still costs a million `Dirent`s and
 * a million-element sort even though only 5,000 are returned — the response was
 * bounded, the work was not (H-008). `opendirSync` + `readSync` charges the budget
 * at the moment of reading, and closes the handle the instant it is exhausted.
 *
 * Hidden entries are skipped from the RESULT but still charged, so a flood of
 * dotfiles cannot buy unlimited enumeration under the same cap.
 */
function readBoundedEntries(abs: string, budget: TraversalBudget): fs.Dirent[] {
  let dir: fs.Dir;
  try {
    dir = fs.opendirSync(abs);
  } catch {
    return [];
  }

  const collected: fs.Dirent[] = [];
  try {
    for (;;) {
      if (budget.remaining <= 0) break;
      const entry = dir.readSync();
      if (entry === null) break;
      budget.remaining -= 1;
      if (entry.name.startsWith('.')) continue;
      collected.push(entry);
    }
  } finally {
    try {
      dir.closeSync();
    } catch {
      /* already closed */
    }
  }

  // Only the entries actually collected are sorted — bounded input, bounded sort.
  return collected.sort((a, b) =>
    a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
  );
}

function buildSubtree(
  root: string,
  rel = '',
  prefix = '',
  depth = 0,
  budget: TraversalBudget = { remaining: UNIVERSAL_TREE_MAX_ENTRIES },
): UniversalTreeNode[] {
  const abs = rel ? path.join(root, rel) : root;
  if (!fs.existsSync(abs)) return [];
  if (depth >= UNIVERSAL_TREE_MAX_DEPTH || budget.remaining <= 0) return [];

  const entries = readBoundedEntries(abs, budget);
  if (budget.remaining <= 0 && depth === 0) budget.rootTruncated = true;

  const nodes: UniversalTreeNode[] = [];
  for (const e of entries) {

    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const nodePath = prefix ? `${prefix}/${childRel}` : childRel;
    const absolutePath = path.join(abs, e.name);

    if (e.isDirectory()) {
      const children = buildSubtree(root, childRel, prefix, depth + 1, budget);
      const truncated = depth + 1 >= UNIVERSAL_TREE_MAX_DEPTH || budget.remaining <= 0;
      nodes.push({
        name: e.name,
        path: nodePath,
        type: 'directory' as const,
        absolutePath,
        children,
        ...(truncated ? { truncated: true } : {}),
      });
      continue;
    }

    let size = 0;
    let mtimeMs = 0;
    try {
      const stats = fs.statSync(absolutePath);
      size = stats.size;
      mtimeMs = stats.mtimeMs;
    } catch { /* skip stat failures */ }
    nodes.push({ name: e.name, path: nodePath, type: 'file' as const, size, mtimeMs, absolutePath });
  }
  return nodes;
}

/**
 * Merged-tree assembly SSOT: canonical dirs first (synthesized when missing,
 * mirroring the codespace panel's placeholder rows), then free-form content,
 * the grafted `sessions` node last — same ordering contract as
 * CANONICAL_DIR_DEFS.
 */
export interface UniversalMergedTree {
  nodes: UniversalTreeNode[];
  /**
   * The enumeration budget ran out at the ARTIFACTS ROOT, where there is no parent
   * node to carry a `truncated` flag. Without this the response looked complete
   * exactly in the worst case — a single directory wide enough to exhaust the
   * budget on its own (H-008).
   */
  truncated: boolean;
}

export function buildUniversalMergedTreeResult(containerPath: string): UniversalMergedTree {
  const artifactsRoot = path.join(containerPath, UNIVERSAL_ARTIFACTS_DIRNAME);
  const sessionsRoot = path.join(containerPath, UNIVERSAL_SESSIONS_NODE);

  // One budget across BOTH walks — the response is a single payload, so
  // bounding each root separately would double the worst case.
  const budget: TraversalBudget = { remaining: UNIVERSAL_TREE_MAX_ENTRIES };

  // Reserved names: agent-created `artifacts/sessions/` or
  // `artifacts/pipeline-runs/` dirs are shadowed by the grafted nodes
  // (user creation is blocked at upload/mkdir).
  const artifactNodes = buildSubtree(artifactsRoot, '', '', 0, budget).filter(
    (n) => n.name !== UNIVERSAL_SESSIONS_NODE && n.name !== UNIVERSAL_PIPELINE_RUNS_NODE,
  );

  const canonicalNodes: UniversalTreeNode[] = UNIVERSAL_ARTIFACT_CANONICAL_DIRS.map(
    (name) =>
      artifactNodes.find((n) => n.name === name && n.type === 'directory') ?? {
        name,
        path: name,
        type: 'directory' as const,
        absolutePath: path.join(artifactsRoot, name),
        children: [],
      },
  );
  const freeNodes = artifactNodes.filter(
    (n) => !(UNIVERSAL_ARTIFACT_CANONICAL_DIRS as readonly string[]).includes(n.name) || n.type !== 'directory',
  );
  const sessionsNode: UniversalTreeNode = {
    name: UNIVERSAL_SESSIONS_NODE,
    path: UNIVERSAL_SESSIONS_NODE,
    type: 'directory',
    absolutePath: sessionsRoot,
    children: buildSubtree(sessionsRoot, '', UNIVERSAL_SESSIONS_NODE, 0, budget),
  };
  // Pipeline run logs graft in only when the project has (ever had) an
  // activation — the dir survives deactivation, so history stays reachable.
  const pipelineRunsRoot = getPipelineRunsRootOf(containerPath);
  const pipelineRunsNode: UniversalTreeNode | null = fs.existsSync(pipelineRunsRoot)
    ? {
        name: UNIVERSAL_PIPELINE_RUNS_NODE,
        path: UNIVERSAL_PIPELINE_RUNS_NODE,
        type: 'directory',
        absolutePath: pipelineRunsRoot,
        children: buildSubtree(pipelineRunsRoot, '', UNIVERSAL_PIPELINE_RUNS_NODE, 0, budget),
      }
    : null;
  return {
    nodes: [...canonicalNodes, ...freeNodes, sessionsNode, ...(pipelineRunsNode ? [pipelineRunsNode] : [])],
    truncated: budget.rootTruncated === true,
  };
}

/**
 * Nodes-only form for callers that render the tree and have no place to show a
 * root-level truncation flag (the codespace file panel). New callers that DO
 * surface it should use {@link buildUniversalMergedTreeResult}.
 */
export function buildUniversalMergedTree(containerPath: string): UniversalTreeNode[] {
  return buildUniversalMergedTreeResult(containerPath).nodes;
}

/**
 * `UniversalTreeNode[]` → `FileNode[]` with meta, the shape both the HTTP file
 * tree and the SSE broadcaster ship.
 *
 * Single owner on purpose: the broadcaster used to walk the container directly
 * with its own blacklist, which emitted `artifacts/…`-prefixed paths while the
 * HTTP route emitted merged-view paths (`plan/…`). Both write the same
 * `ARTIFACTS.FILETREE` Redis key, so whichever ran last decided the shape and a
 * cached raw-walk tree made every artifact click resolve to
 * `{container}/artifacts/artifacts/…` → 404. Route every universal tree through
 * {@link buildUniversalMergedTree} + this decorator.
 */
export async function decorateUniversalTree(nodes: UniversalTreeNode[]): Promise<FileNode[]> {
  return Promise.all(nodes.map(async (n): Promise<FileNode> => {
    if (n.type === 'directory') {
      return {
        name: n.name,
        path: n.path,
        type: 'directory',
        children: await decorateUniversalTree(n.children ?? []),
      };
    }
    let content: string | null = null;
    if (shouldEvaluateTemplate(n.path)) {
      try {
        content = await fs.promises.readFile(n.absolutePath, 'utf-8');
      } catch { /* skip read failures */ }
    }
    const meta = computeFileMeta({
      relativePath: n.path,
      content,
      size: n.size ?? 0,
      mtime: n.mtimeMs ?? 0,
    });
    return { name: n.name, path: n.path, type: 'file', meta };
  }));
}

export type ProjectJobGateResult =
  | { ok: true }
  | { ok: false; code: 'project-not-universal' | 'project-universal-requires-custom-job' };

/**
 * The single truth table for the bidirectional project-type × jobType gate:
 * universal projects run ONLY `jobType='universal'` (custom jobs); canonical
 * projects run everything EXCEPT it.
 */
export function decideProjectJobGate(
  projectType: 'canonical' | 'universal' | undefined,
  jobType: string,
): ProjectJobGateResult {
  const isUniversalJob = jobType === 'universal';
  const isUniversalType = projectType === 'universal';
  if (isUniversalJob && !isUniversalType) return { ok: false, code: 'project-not-universal' };
  if (!isUniversalJob && isUniversalType) return { ok: false, code: 'project-universal-requires-custom-job' };
  return { ok: true };
}
