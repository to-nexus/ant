/**
 * Custom agent / job loader — discovery + load + D4 merge.
 *
 * File layout (workspace disk is the SSOT — no caching beyond one load call):
 *
 *   {scopeRoot}/{agentId}/
 *     agent.yaml            machine contract (shared MCP / tool bound / defaults)
 *     base/*.md             shared persona — always injected, filename order
 *     injections/*.md       shared conditional prose (TOC injected, body on demand)
 *     jobs/{jobId}/
 *       job.yaml            job machine contract (narrows the agent's)
 *       base/*.md           job procedure — always injected
 *       injections/*.md     job conditional prose
 *
 * Validation failures throw CustomAgentValidationError → HTTP 400 at
 * job-accept (fail-loud, never a silent fallback).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { isValidCustomId, type CustomAgentScope, type CustomAgentSummary, type CustomJobSummary } from '@ant/shared';
import {
  CustomAgentValidationError,
  type ApprovalPolicy,
  type CustomAgentYaml,
  type CustomJobYaml,
  type InjectionTocEntry,
  type McpServerConfig,
  type OutputsContract,
  type ResolvedCustomJob,
} from './types.js';
import { UNIVERSAL_BUILTIN_TOOLS, WRITE_TOOLS } from './universalToolPolicy.js';
import {
  intentsFilePathFor,
  mergeIntentCatalogs,
  parseIntentsYaml,
  tryReadMergedIntentSummaries,
  validateIntentInjectionRefs,
} from './intents.js';

/** One discovery root, in D8 priority order (user > org > builtin). */
export interface CustomAgentScopeRoot {
  scope: CustomAgentScope;
  /** Absolute path of the `agents/` container dir (may not exist yet). */
  root: string;
  readonly: boolean;
}

/** Cap applied to the merged (agent base + job base) prose, ANTRULES-style. */
export const CUSTOM_PROSE_CAP = 8_000;
const TRUNCATION_FOOTER = '\n\n[... truncated: custom prose exceeds the size cap — move detail into injections/ ...]';

// ── yaml reading ─────────────────────────────────────────────────────────────

function readYamlFile<T>(filePath: string, agentId: string, jobId?: string): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    throw new CustomAgentValidationError(`Missing definition file: ${filePath}`, agentId, jobId);
  }
  try {
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('not a mapping');
    }
    return parsed as T;
  } catch (e) {
    throw new CustomAgentValidationError(
      `Invalid YAML in ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
      agentId,
      jobId,
    );
  }
}

function validateIdMatchesDir(kind: 'agent' | 'job', id: unknown, dirName: string, agentId: string, jobId?: string): void {
  if (typeof id !== 'string' || !isValidCustomId(id)) {
    throw new CustomAgentValidationError(`${kind} id must match [a-z0-9-]+ (got: ${String(id)})`, agentId, jobId);
  }
  if (id !== dirName) {
    throw new CustomAgentValidationError(`${kind} id "${id}" must equal its directory name "${dirName}"`, agentId, jobId);
  }
}

function validateMcpServers(servers: Record<string, McpServerConfig> | undefined, agentId: string, jobId?: string): void {
  for (const [name, cfg] of Object.entries(servers ?? {})) {
    if (!isValidCustomId(name)) {
      throw new CustomAgentValidationError(`MCP server name "${name}" must match [a-z0-9-]+`, agentId, jobId);
    }
    if (cfg.transport === 'stdio') {
      if (!cfg.command) {
        throw new CustomAgentValidationError(`MCP server "${name}": stdio transport requires "command"`, agentId, jobId);
      }
    } else if (cfg.transport === 'http') {
      if (!cfg.url) {
        throw new CustomAgentValidationError(`MCP server "${name}": http transport requires "url"`, agentId, jobId);
      }
    } else {
      throw new CustomAgentValidationError(`MCP server "${name}": transport must be "stdio" | "http"`, agentId, jobId);
    }
    for (const [key, value] of Object.entries(cfg.env ?? {})) {
      if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
        throw new CustomAgentValidationError(
          `MCP server "${name}": env.${key} must reference a host env var NAME (got: ${String(value)}) — secrets never live in the definition file`,
          agentId,
          jobId,
        );
      }
    }
  }
}

function validateBuiltinSubset(
  child: string[] | undefined,
  bound: readonly string[],
  boundLabel: string,
  agentId: string,
  jobId?: string,
): string[] {
  if (!child) return [...bound];
  for (const tool of child) {
    if (!bound.includes(tool)) {
      throw new CustomAgentValidationError(
        `tools.builtin contains "${tool}" which is not in ${boundLabel} — narrowing only, tools cannot be added (use MCP for extra capability)`,
        agentId,
        jobId,
      );
    }
  }
  return [...child];
}

// ── prose / injections ───────────────────────────────────────────────────────

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

function readBaseProse(dir: string): string {
  return listMarkdownFiles(dir)
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf-8').trim())
    .filter((s) => s.length > 0)
    .join('\n\n');
}

function readInjectionsToc(dir: string): InjectionTocEntry[] {
  return listMarkdownFiles(dir).map((f) => {
    const absolutePath = path.join(dir, f);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const summary = content.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
    // Body rides along so intent-mapped entries can be annotated without a
    // second disk read (the file is already fully read for its summary).
    return { file: f, summary, absolutePath, body: content };
  });
}

// ── discovery ────────────────────────────────────────────────────────────────

function listAgentDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidCustomId(e.name))
    .map((e) => e.name)
    .sort();
}

function summarizeJobs(agentDir: string): CustomJobSummary[] {
  const jobsDir = path.join(agentDir, 'jobs');
  if (!fs.existsSync(jobsDir)) return [];
  const summaries: CustomJobSummary[] = [];
  for (const entry of fs.readdirSync(jobsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidCustomId(entry.name)) continue;
    const yamlPath = path.join(jobsDir, entry.name, 'job.yaml');
    if (!fs.existsSync(yamlPath)) continue;
    try {
      const job = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as CustomJobYaml;
      if (job && typeof job === 'object' && job.id === entry.name) {
        // Lenient intents projection for the `@intent:` mention vocabulary —
        // omitted (not []) when the catalog fails to parse.
        const intents = tryReadMergedIntentSummaries(agentDir, path.join(jobsDir, entry.name), path.basename(agentDir), entry.name);
        summaries.push({
          id: job.id,
          name: job.name ?? job.id,
          description: job.description ?? '',
          ...(intents ? { intents } : {}),
        });
      }
    } catch {
      // Discovery is lenient (a broken job must not hide its siblings);
      // loadCustomJob is where a broken definition fails loud.
    }
  }
  return summaries;
}

/**
 * List all custom agents across scope roots. Closer scope wins id collisions
 * (roots must be passed in D8 priority order).
 */
export function discoverAgents(scopeRoots: CustomAgentScopeRoot[]): CustomAgentSummary[] {
  const byId = new Map<string, CustomAgentSummary>();
  for (const { scope, root, readonly } of scopeRoots) {
    for (const agentId of listAgentDirs(root)) {
      if (byId.has(agentId)) continue; // earlier (closer) scope wins
      const agentDir = path.join(root, agentId);
      const yamlPath = path.join(agentDir, 'agent.yaml');
      if (!fs.existsSync(yamlPath)) continue;
      try {
        const agent = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as CustomAgentYaml;
        if (!agent || typeof agent !== 'object' || agent.id !== agentId) continue;
        byId.set(agentId, {
          id: agentId,
          name: agent.name ?? agentId,
          description: agent.description ?? '',
          scope,
          readonly,
          jobs: summarizeJobs(agentDir),
        });
      } catch {
        // lenient — see summarizeJobs
      }
    }
  }
  return Array.from(byId.values());
}

/**
 * Collision check for agent creation: only a writable-scope collision blocks —
 * a new agent may shadow readonly scopes (org/builtin) wholesale.
 */
export function findCreateCollision(
  scopeRoots: CustomAgentScopeRoot[],
  agentId: string,
): { scopeRoot: CustomAgentScopeRoot; agentDir: string } | null {
  return findAgentRoot(
    scopeRoots.filter((r) => !r.readonly),
    agentId,
  );
}

/** Resolve which scope root owns an agent id (first match in priority order). */
export function findAgentRoot(
  scopeRoots: CustomAgentScopeRoot[],
  agentId: string,
): { scopeRoot: CustomAgentScopeRoot; agentDir: string } | null {
  for (const scopeRoot of scopeRoots) {
    const agentDir = path.join(scopeRoot.root, agentId);
    if (fs.existsSync(path.join(agentDir, 'agent.yaml'))) {
      return { scopeRoot, agentDir };
    }
  }
  return null;
}

// ── load + merge ─────────────────────────────────────────────────────────────

const DEFAULT_OUTPUTS: OutputsContract = { mode: 'free' };

/**
 * Load agent.yaml + job.yaml, apply the D4 merge rules, validate, and return
 * the single immutable definition the runtime consumes.
 */
export function loadCustomJob(
  scopeRoots: CustomAgentScopeRoot[],
  agentId: string,
  jobId: string,
): ResolvedCustomJob {
  if (!isValidCustomId(agentId) || !isValidCustomId(jobId)) {
    throw new CustomAgentValidationError(`Invalid custom job ref: ${agentId}/${jobId}`, agentId, jobId);
  }
  const found = findAgentRoot(scopeRoots, agentId);
  if (!found) {
    throw new CustomAgentValidationError(`Custom agent not found: ${agentId}`, agentId, jobId);
  }
  const { scopeRoot, agentDir } = found;
  const jobDir = path.join(agentDir, 'jobs', jobId);

  const agent = readYamlFile<CustomAgentYaml>(path.join(agentDir, 'agent.yaml'), agentId);
  validateIdMatchesDir('agent', agent.id, agentId, agentId);
  const job = readYamlFile<CustomJobYaml>(path.join(jobDir, 'job.yaml'), agentId, jobId);
  validateIdMatchesDir('job', job.id, jobId, agentId, jobId);

  validateMcpServers(agent.mcp?.servers, agentId);
  validateMcpServers(job.mcp?.servers, agentId, jobId);

  // tools.builtin: job ⊆ agent ⊆ universal preset (narrowing only)
  const agentBound = validateBuiltinSubset(agent.tools?.builtin, UNIVERSAL_BUILTIN_TOOLS, 'the universal preset', agentId);
  const builtinTools = validateBuiltinSubset(job.tools?.builtin, agentBound, `agent "${agentId}"'s tools.builtin`, agentId, jobId);

  // approval: union, stricter (always) wins on collision
  const approval: Record<string, ApprovalPolicy> = { ...(agent.tools?.approval ?? {}) };
  for (const [tool, policy] of Object.entries(job.tools?.approval ?? {})) {
    approval[tool] = approval[tool] === 'always' ? 'always' : policy;
  }

  // prose: agent base → job base (harness prose is owned by templates/, not here)
  let prose = [readBaseProse(path.join(agentDir, 'base')), readBaseProse(path.join(jobDir, 'base'))]
    .filter((s) => s.length > 0)
    .join('\n\n');
  if (prose.trim().length === 0) {
    throw new CustomAgentValidationError(
      `Custom job ${agentId}/${jobId} has no prose — add at least one base/*.md (e.g. base/system.md)`,
      agentId,
      jobId,
    );
  }
  if (prose.length > CUSTOM_PROSE_CAP) {
    prose = prose.slice(0, CUSTOM_PROSE_CAP) + TRUNCATION_FOOTER;
  }

  // injections TOC: union, job wins on filename collision
  const agentToc = readInjectionsToc(path.join(agentDir, 'injections'));
  const jobToc = readInjectionsToc(path.join(jobDir, 'injections'));
  const tocByFile = new Map<string, InjectionTocEntry>();
  for (const entry of agentToc) tocByFile.set(entry.file, entry);
  for (const entry of jobToc) tocByFile.set(entry.file, entry);

  // intents: dedicated single-file catalog per level (agent-shared +
  // optional job extension), job entry wins WHOLESALE on id collision.
  // Injection refs are LEVEL-scoped: agent intents may only reference agent
  // injections (a job-private ref would explode on sibling jobs); job
  // intents see the merged set.
  const agentIntents = parseIntentsYaml(intentsFilePathFor(agentDir), agentId);
  const jobIntents = parseIntentsYaml(intentsFilePathFor(jobDir), agentId, jobId);
  validateIntentInjectionRefs(agentIntents, new Set(agentToc.map((e) => e.file)), `agent "${agentId}"`, agentId);
  validateIntentInjectionRefs(jobIntents, new Set(tocByFile.keys()), `merged agent+job`, agentId, jobId);
  const intents = mergeIntentCatalogs(agentIntents, jobIntents, agentId, jobId);

  // Annotate the TOC with the reverse mapping (file → intent ids); body is
  // kept ONLY on intent-mapped entries (they inline in full at prompt time —
  // no mid-job disk re-read), and dropped elsewhere.
  const intentsByFile = new Map<string, string[]>();
  for (const intent of intents) {
    for (const f of intent.injections ?? []) {
      const list = intentsByFile.get(f);
      if (list) list.push(intent.id);
      else intentsByFile.set(f, [intent.id]);
    }
  }
  for (const [file, entry] of tocByFile) {
    const mapped = intentsByFile.get(file);
    if (mapped) {
      entry.intents = mapped;
    } else {
      delete entry.body;
    }
  }

  // mcp servers: union, job wins on name collision
  const mcpServers: Record<string, McpServerConfig> = {
    ...(agent.mcp?.servers ?? {}),
    ...(job.mcp?.servers ?? {}),
  };

  const outputs: OutputsContract = job.outputs ?? DEFAULT_OUTPUTS;
  if (outputs.mode === 'contract') {
    if (!outputs.artifacts?.length) {
      throw new CustomAgentValidationError(`outputs.mode "contract" requires at least one artifacts entry`, agentId, jobId);
    }
    if (!builtinTools.some((t) => (WRITE_TOOLS as readonly string[]).includes(t))) {
      throw new CustomAgentValidationError(
        `outputs.mode "contract" requires a write tool (${WRITE_TOOLS.join(', ')}) in tools.builtin`,
        agentId,
        jobId,
      );
    }
  }

  return {
    agentId,
    jobId,
    scope: scopeRoot.scope,
    agentName: agent.name ?? agentId,
    jobName: job.name ?? jobId,
    description: job.description ?? '',
    prose,
    injectionsToc: Array.from(tocByFile.values()),
    intents,
    mcpServers,
    builtinTools,
    approval,
    workspace: job.workspace ?? agent.workspace ?? 'none',
    models: { ...(agent.models ?? {}), ...(job.models ?? {}) },
    plan: job.plan ?? 'suggested',
    outputs,
    agentDir,
    jobDir,
  };
}
