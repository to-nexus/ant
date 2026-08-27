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
 *       intents/{intentId}/ job intent catalog — one directory per intent:
 *         infer.md          criterion body + optional clarify frontmatter (id ≡ dirname)
 *         prompt.md         optional prose inlined while the intent is active
 *         hooks.yaml        optional per-intent hook contract
 *
 * Intents and tools are JOB-ONLY (mirroring canonical). The agent contributes
 * name, `base/` prose, and shared `mcp` only.
 *
 * Validation failures throw CustomAgentValidationError → HTTP 400 at
 * job-accept (fail-loud, never a silent fallback).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  INTENTS_DIR_NAME,
  ON_DEMAND_DIR_NAME,
  INTENT_INFER_FILE_NAME,
  INTENT_PROMPT_FILE_NAME,
  INTENT_HOOKS_FILE_NAME,
  isValidCustomId,
  validateMcpServers,
  validateApiServers,
  API_TOOL_PREFIX,
  type CustomAgentScope,
  type CustomAgentSummary,
  type CustomJobSummary,
} from '@ant/shared';
import {
  CustomAgentValidationError,
  type ApprovalPolicy,
  type CustomAgentYaml,
  type CustomJobYaml,
  type McpServerConfig,
  type RestApiServerConfig,
  type ResolvedCustomJob,
} from './types.js';
import { ARTIFACT_WRITE_EVIDENCE_TOOLS, UNIVERSAL_BUILTIN_TOOLS, isUniversalBuiltinTool } from './universalToolPolicy.js';
import { parseIntentsDir, tryReadJobIntentSummaries } from './intents.js';

/** One discovery root, in D8 priority order (user > org > builtin). */
export interface CustomAgentScopeRoot {
  scope: CustomAgentScope;
  /** Absolute path of the `agents/` container dir (may not exist yet). */
  root: string;
  readonly: boolean;
  /**
   * Writes are gated per-agent by the org ACL (`agent-acl.json`) instead of
   * the root-level `readonly` flag. Kept `readonly: false` structurally; the
   * route layer resolves the caller's actual authority.
   */
  aclGoverned?: boolean;
}

/** Cap applied to the merged (agent base + job base) prose, ANTRULES-style. */
export const CUSTOM_PROSE_CAP = 8_000;
const TRUNCATION_FOOTER =
  '\n\n[... truncated: custom prose exceeds the size cap — read the full base/*.md via read_file under _agent-definition/ (startLine/endLine). Authors: move detail into intents/{intentId}/prompt.md ...]';

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
      `agent.yaml: intents belong in jobs/{jobId}/${INTENTS_DIR_NAME}/{intentId}/${INTENT_INFER_FILE_NAME} (intents are job-only)`,
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

/** Rules live in `@ant/shared.validateMcpServers`; the loader only chooses the failure shape. */
function assertMcpServers(servers: Record<string, McpServerConfig> | undefined, agentId: string, jobId?: string): void {
  const [first] = validateMcpServers(servers);
  if (first) throw new CustomAgentValidationError(first, agentId, jobId);
}

/** Same contract for the declared REST API channel (`apis`). */
function assertApiServers(servers: Record<string, RestApiServerConfig> | undefined, agentId: string, jobId?: string): void {
  const [first] = validateApiServers(servers);
  if (first) throw new CustomAgentValidationError(first, agentId, jobId);
}

/**
 * The `clarify` knob must be a real boolean at every level — a truthy string
 * like `"yes"`/`"false"` would silently invert the author's intent. The
 * message states the knob's semantic so the author knows what `false` means.
 */
function assertClarifyKnob(value: unknown, level: 'agent.yaml' | 'job.yaml', agentId: string, jobId?: string): void {
  if (value === undefined || typeof value === 'boolean') return;
  throw new CustomAgentValidationError(
    `${level}: "clarify" must be true or false (got: ${JSON.stringify(value)}) — ` +
    `false declares the job autonomous/unattended: the agent never asks a blocking question and proceeds with sensible defaults`,
    agentId,
    jobId,
  );
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
        `tools.builtin contains "${tool}" which is not in ${boundLabel} — narrowing only, tools cannot be added (use mcp.servers or apis for extra capability)`,
        agentId,
        jobId,
      );
    }
  }
  return [...child];
}

// ── prose ────────────────────────────────────────────────────────────────────

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

/**
 * Recursive listing of an `on-demand/` docs dir (.md/.json, any depth) as
 * definition-relative paths — the read-on-demand index the system block
 * renders so the model knows these documents exist without inlining them.
 */
function listOnDemandDocs(agentDir: string, relBase: string): string[] {
  const walk = (rel: string): string[] => {
    const abs = path.join(agentDir, rel);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(childRel));
      else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) out.push(childRel);
    }
    return out;
  };
  return walk(relBase);
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
  for (const { scope, root, readonly, aclGoverned } of scopeRoots) {
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
          // Conservative default for ACL-governed roots — the route layer
          // flips it per caller after resolving the org ACL + live role.
          readonly: aclGoverned ? true : readonly,
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

  // Legacy structure fails loud with the migration instruction.
  if (fs.existsSync(path.join(agentDir, 'intents.yaml'))) {
    throw new CustomAgentValidationError(
      `Agent-level intents.yaml is no longer supported — intents are job-only. Move each intent into jobs/{jobId}/${INTENTS_DIR_NAME}/{intentId}/${INTENT_INFER_FILE_NAME} (criterion body; prose into ${INTENT_PROMPT_FILE_NAME}, hooks into ${INTENT_HOOKS_FILE_NAME} alongside), then delete the agent-level file.`,
      agentId,
      jobId,
    );
  }
  if (fs.existsSync(path.join(agentDir, 'injections'))) {
    throw new CustomAgentValidationError(
      `Agent-level injections/ is no longer supported — each intent owns its prose as jobs/{jobId}/${INTENTS_DIR_NAME}/{intentId}/${INTENT_PROMPT_FILE_NAME}; move each file into the intent that used it and delete the directory.`,
      agentId,
      jobId,
    );
  }
  if (fs.existsSync(path.join(agentDir, 'reference'))) {
    throw new CustomAgentValidationError(
      `Agent-level reference/ was renamed to ${ON_DEMAND_DIR_NAME}/ — the channel is unchanged (paths rendered, bodies read on demand); rename the directory.`,
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

  assertMcpServers(agent.mcp?.servers, agentId);
  assertMcpServers(job.mcp?.servers, agentId, jobId);
  assertApiServers(agent.apis, agentId);
  assertApiServers(job.apis, agentId, jobId);

  assertClarifyKnob(agent.clarify, 'agent.yaml', agentId);
  assertClarifyKnob(job.clarify, 'job.yaml', agentId, jobId);
  const clarifyDefault = job.clarify ?? agent.clarify ?? true;

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
      `Custom job ${agentId}/${jobId} has no prose — add at least one base/*.md (e.g. base/role.md or jobs/${jobId}/base/system.md)`,
      agentId,
      jobId,
    );
  }
  if (prose.length > CUSTOM_PROSE_CAP) {
    prose = prose.slice(0, CUSTOM_PROSE_CAP) + TRUNCATION_FOOTER;
  }

  // intents: job-only. A leftover injections/ pool fails loud — hard cutover,
  // no backward compatibility (even an empty directory: delete it).
  if (fs.existsSync(path.join(jobDir, 'injections'))) {
    throw new CustomAgentValidationError(
      `jobs/${jobId}/injections/ was removed — each intent now owns its prose as ${INTENTS_DIR_NAME}/{intentId}/${INTENT_PROMPT_FILE_NAME} (inlined while that intent is active). Move each file into the intent that referenced it and delete the directory.`,
      agentId,
      jobId,
    );
  }
  if (fs.existsSync(path.join(jobDir, 'reference'))) {
    throw new CustomAgentValidationError(
      `jobs/${jobId}/reference/ was renamed to ${ON_DEMAND_DIR_NAME}/ — the channel is unchanged (paths rendered, bodies read on demand); rename the directory.`,
      agentId,
      jobId,
    );
  }
  const { intents, intentPrompts } = parseIntentsDir(jobDir, agentId, jobId);

  // mcp servers: union, job wins on name collision
  const mcpServers: Record<string, McpServerConfig> = {
    ...(agent.mcp?.servers ?? {}),
    ...(job.mcp?.servers ?? {}),
  };
  // declared REST APIs: same union rule
  const apiServers: Record<string, RestApiServerConfig> = {
    ...(agent.apis ?? {}),
    ...(job.apis ?? {}),
  };

  // on-demand/ docs index: agent-level + this job's (paths only — never inlined)
  const onDemandDocs = [
    ...listOnDemandDocs(agentDir, ON_DEMAND_DIR_NAME),
    ...listOnDemandDocs(agentDir, `jobs/${jobId}/${ON_DEMAND_DIR_NAME}`),
  ];

  // Stop-hook cross-file rules (H7/H8) — intra-file shape was validated by
  // parseIntentsDir; here the declaration must be SATISFIABLE by this job's
  // machine contract, or the hook could never be met at runtime.
  for (const intent of intents) {
    const hooksLabel = `${INTENTS_DIR_NAME}/${intent.id}/${INTENT_HOOKS_FILE_NAME}`;
    for (const hook of intent.hooks?.stop ?? []) {
      if ('artifact' in hook) {
        // H7 — an artifact hook needs at least one write-evidence tool.
        if (!builtinTools.some((t) => (ARTIFACT_WRITE_EVIDENCE_TOOLS as readonly string[]).includes(t))) {
          throw new CustomAgentValidationError(
            `${hooksLabel}: intent "${intent.id}" declares an artifact stop hook ("${hook.artifact}") but tools.builtin grants no artifact-write tool (${ARTIFACT_WRITE_EVIDENCE_TOOLS.join(', ')})`,
            agentId,
            jobId,
          );
        }
      } else if (isUniversalBuiltinTool(hook.action)) {
        // H8 — builtin action must be in this job's allowlist.
        if (!builtinTools.includes(hook.action)) {
          throw new CustomAgentValidationError(
            `${hooksLabel}: intent "${intent.id}" declares action stop hook "${hook.action}" which is not in this job's tools.builtin`,
            agentId,
            jobId,
          );
        }
      } else if (hook.action.startsWith(API_TOOL_PREFIX)) {
        // H8 — a synthesized api__ action's server must be declared in the merged apis.
        const serverName = hook.action.slice(API_TOOL_PREFIX.length).split('__')[0];
        if (!apiServers[serverName]) {
          throw new CustomAgentValidationError(
            `${hooksLabel}: intent "${intent.id}" declares action stop hook "${hook.action}" but no API server "${serverName}" is declared in apis`,
            agentId,
            jobId,
          );
        }
      } else {
        // H8 — MCP action's server must be declared in the merged mcp.servers.
        const serverName = hook.action.slice('mcp__'.length).split('__')[0];
        if (!mcpServers[serverName]) {
          throw new CustomAgentValidationError(
            `${hooksLabel}: intent "${intent.id}" declares action stop hook "${hook.action}" but no MCP server "${serverName}" is declared in mcp.servers`,
            agentId,
            jobId,
          );
        }
      }
    }
  }

  return {
    agentId,
    jobId,
    scope: scopeRoot.scope,
    agentName: agent.name ?? agentId,
    jobName: job.name ?? jobId,
    prose,
    intents,
    intentPrompts,
    mcpServers,
    apiServers,
    onDemandDocs,
    builtinTools,
    approval,
    clarifyDefault,
    agentDir,
    jobDir,
  };
}
