/**
 * Custom agent / job loader — discovery + load.
 *
 * File layout (workspace disk is the SSOT — no caching beyond one load call):
 *
 *   {scopeRoot}/{agentId}/
 *     agent.yaml            identity + shared MCP connections
 *     base/*.md             shared persona — always injected, filename order
 *     jobs/{jobId}/
 *       job.yaml            job machine contract (tools ⊆ universal preset)
 *       base/*.md           job procedure — always injected
 *       injections/*.md     job conditional prose (TOC injected, body on demand)
 *       intents.yaml        job intent catalog
 *
 * Intents, injections, and tools are JOB-ONLY (mirroring canonical). The
 * agent contributes name, `base/` prose, and shared `mcp` only.
 *
 * Validation failures throw CustomAgentValidationError → HTTP 400 at
 * job-accept (fail-loud, never a silent fallback).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  INTENTS_FILE_NAME,
  isValidCustomId,
  type CustomAgentScope,
  type CustomAgentSummary,
  type CustomJobSummary,
} from '@ant/shared';
import {
  CustomAgentValidationError,
  type ApprovalPolicy,
  type CustomAgentYaml,
  type CustomJobYaml,
  type InjectionTocEntry,
  type McpServerConfig,
  type ResolvedCustomJob,
} from './types.js';
import { UNIVERSAL_BUILTIN_TOOLS } from './universalToolPolicy.js';
import {
  intentsFilePathFor,
  parseIntentsYaml,
  tryReadJobIntentSummaries,
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

/**
 * Legacy-key rejection for agent.yaml / job.yaml — shared by `loadCustomJob`
 * and the settings PUT funnel (`gateDefinitionSave`), so a file the funnel
 * accepts is exactly a file the runtime loads. Every message is the migration
 * instruction for that key.
 */
export function validateAgentYamlDoc(doc: unknown, agentId: string): void {
  if (!doc || typeof doc !== 'object') return;
  const keys = doc as Record<string, unknown>;
  if (keys.tools !== undefined) {
    throw new CustomAgentValidationError(
      `agent.yaml: "tools" moved to job level — declare tools.builtin / tools.approval in jobs/{jobId}/job.yaml (each job validates directly against the universal preset)`,
      agentId,
    );
  }
  if (keys.description !== undefined) {
    throw new CustomAgentValidationError(
      `agent.yaml: "description" was removed — the agent shows its name only; put persona prose in base/*.md`,
      agentId,
    );
  }
  if (keys.intents !== undefined) {
    throw new CustomAgentValidationError(
      `agent.yaml: intents belong in jobs/{jobId}/intents.yaml (intents are job-only)`,
      agentId,
    );
  }
  for (const key of ['workspace', 'models'] as const) {
    if (keys[key] !== undefined) {
      throw new CustomAgentValidationError(
        `agent.yaml: "${key}" was removed (it never had a runtime effect) — delete the field`,
        agentId,
      );
    }
  }
}

export function validateJobYamlDoc(doc: unknown, agentId: string, jobId: string): void {
  if (!doc || typeof doc !== 'object') return;
  const keys = doc as Record<string, unknown>;
  if (keys.outputs !== undefined) {
    throw new CustomAgentValidationError(
      `job.yaml: "outputs" was removed — describe output conventions in the job's base/*.md prose instead`,
      agentId,
      jobId,
    );
  }
  if (keys.plan !== undefined) {
    throw new CustomAgentValidationError(
      `job.yaml: "plan" was removed — planning is now a per-turn composer toggle (@plan); delete the field`,
      agentId,
      jobId,
    );
  }
  if (keys.description !== undefined) {
    throw new CustomAgentValidationError(
      `job.yaml: "description" was removed — the job shows its name only; put what the job is and how it works in base/*.md prose (mirrors agent.yaml)`,
      agentId,
      jobId,
    );
  }
  for (const key of ['workspace', 'models'] as const) {
    if (keys[key] !== undefined) {
      throw new CustomAgentValidationError(
        `job.yaml: "${key}" was removed (it never had a runtime effect) — delete the field`,
        agentId,
        jobId,
      );
    }
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
        const intents = tryReadJobIntentSummaries(path.join(jobsDir, entry.name), path.basename(agentDir), entry.name);
        summaries.push({
          id: job.id,
          name: job.name ?? job.id,
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
 * Collision check for agent creation: ANY scope owning the id blocks — a new
 * agent must not silently shadow a readonly (org/builtin) agent. Pre-existing
 * on-disk shadows still resolve leniently by scope priority (discoverAgents /
 * findAgentRoot); only new creations are refused.
 */
export function findCreateCollision(
  scopeRoots: CustomAgentScopeRoot[],
  agentId: string,
): { scopeRoot: CustomAgentScopeRoot; agentDir: string } | null {
  return findAgentRoot(scopeRoots, agentId);
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

// ── load ─────────────────────────────────────────────────────────────────────

/**
 * Load agent.yaml + job.yaml, validate, and return the single immutable
 * definition the runtime consumes.
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

  // Legacy agent-level structure fails loud with the migration instruction.
  if (fs.existsSync(intentsFilePathFor(agentDir))) {
    throw new CustomAgentValidationError(
      `Agent-level ${INTENTS_FILE_NAME} is no longer supported — intents are job-only. Move the catalog into jobs/{jobId}/${INTENTS_FILE_NAME} and its referenced files into jobs/{jobId}/injections/, then delete the agent-level file (the settings Prompts view can create/delete these files).`,
      agentId,
      jobId,
    );
  }
  if (listMarkdownFiles(path.join(agentDir, 'injections')).length > 0) {
    throw new CustomAgentValidationError(
      `Agent-level injections/ is no longer supported — move the *.md files into jobs/{jobId}/injections/ and delete the agent-level directory.`,
      agentId,
      jobId,
    );
  }

  const agent = readYamlFile<CustomAgentYaml>(path.join(agentDir, 'agent.yaml'), agentId);
  validateAgentYamlDoc(agent, agentId);
  validateIdMatchesDir('agent', agent.id, agentId, agentId);
  const job = readYamlFile<CustomJobYaml>(path.join(jobDir, 'job.yaml'), agentId, jobId);
  validateJobYamlDoc(job, agentId, jobId);
  validateIdMatchesDir('job', job.id, jobId, agentId, jobId);

  validateMcpServers(agent.mcp?.servers, agentId);
  validateMcpServers(job.mcp?.servers, agentId, jobId);

  // tools.builtin: job ⊆ universal preset (job-only, mirroring canonical)
  const builtinTools = validateBuiltinSubset(job.tools?.builtin, UNIVERSAL_BUILTIN_TOOLS, 'the universal preset', agentId, jobId);

  // approval: job-declared only
  const approval: Record<string, ApprovalPolicy> = { ...(job.tools?.approval ?? {}) };

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

  // injections TOC + intents: job-only
  const injectionsToc = readInjectionsToc(path.join(jobDir, 'injections'));
  const intents = parseIntentsYaml(intentsFilePathFor(jobDir), agentId, jobId);
  validateIntentInjectionRefs(intents, new Set(injectionsToc.map((e) => e.file)), `job "${jobId}"`, agentId, jobId);

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
  for (const entry of injectionsToc) {
    const mapped = intentsByFile.get(entry.file);
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

  return {
    agentId,
    jobId,
    scope: scopeRoot.scope,
    agentName: agent.name ?? agentId,
    jobName: job.name ?? jobId,
    prose,
    injectionsToc,
    intents,
    mcpServers,
    builtinTools,
    approval,
    agentDir,
    jobDir,
  };
}
