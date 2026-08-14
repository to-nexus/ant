/**
 * Shared handler pieces for the custom-agent definition CRUD — used by BOTH
 * the project-scoped routes (`customAgents.routes.ts`) and the account-scoped
 * agent-settings routes (`accountAgents.routes.ts`). One implementation, two
 * mounts: 400/404/403 semantics must not drift between them.
 */

import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  isAllowedDefinitionPath,
  isValidCustomId,
  validateMcpServers,
  type CustomAgentDefinitionFileNode,
  type DefinitionValidationResult,
  type CustomAgentSummary,
  type McpServerConfig,
  type OrgMembershipRole,
} from '@ant/shared';
import { canEditOrgAgent, computeOrgAgentPermissions, type OrgAgentAcl } from './orgAgentAclStore';
import {
  findAgentRoot,
  loadCustomJob,
  validateAgentYamlDoc,
  validateJobYamlDoc,
  type CustomAgentScopeRoot,
} from '../../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../../core/customAgents/types';
import { validateIntentsDoc } from '../../../../../core/customAgents/intents';

// ── scaffolds ────────────────────────────────────────────────────────────────

export const AGENT_SCAFFOLD_ROLE_MD = `# Role

Describe this agent's shared persona and working principles here.
Everything in \`base/\` is always injected for every job of this agent.
Job-specific procedure, conditional material (\`injections/\`), and the intent
catalog live under each \`jobs/{jobId}/\` directory.
`;

export const JOB_SCAFFOLD_SYSTEM_MD = `# Job Procedure

Describe what this job does, step by step, and what a good result looks like.
This file is always injected on top of the agent's shared \`base/\` prose.
Put long, situational material into this job's \`injections/\` instead — the
runtime shows a table of contents and loads files on demand.
`;

/**
 * Default base-prose filenames. The agent level answers "who is this" and the
 * job level "how does this run", so they get distinct names — and the shipped
 * builtin uses the same two, so a scaffolded agent and the exemplar read alike.
 * Additional `base/*.md` files are always allowed; these are only the defaults.
 */
export const AGENT_BASE_DEFAULT_MD = 'role.md';
export const JOB_BASE_DEFAULT_MD = 'system.md';

export function scaffoldAgent(agentDir: string, id: string, name: string): void {
  fs.mkdirSync(path.join(agentDir, 'base'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.yaml'), yaml.dump({ id, name, version: 1 }), 'utf-8');
  fs.writeFileSync(path.join(agentDir, 'base', AGENT_BASE_DEFAULT_MD), AGENT_SCAFFOLD_ROLE_MD, 'utf-8');
}

export const JOB_SCAFFOLD_INTENTS_YAML = `# Job intent catalog (optional). An empty catalog costs nothing — the intent
# classifier is skipped entirely until you declare entries.
#
# Each description is the classification matching criterion; when an intent is
# active its \`injections\` files (this job's injections/*.md) are inlined in
# full (otherwise they stay in the on-demand table of contents). Example:
#
# intents:
#   - id: review
#     description: 'Review or critique an existing document in the workspace'
#     injections: [review-checklist.md]
version: 1
intents: []
`;

export function scaffoldJob(jobDir: string, id: string, name: string): void {
  fs.mkdirSync(path.join(jobDir, 'base'), { recursive: true });
  fs.mkdirSync(path.join(jobDir, 'injections'), { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'job.yaml'), yaml.dump({ id, name, version: 1 }), 'utf-8');
  fs.writeFileSync(path.join(jobDir, 'base', JOB_BASE_DEFAULT_MD), JOB_SCAFFOLD_SYSTEM_MD, 'utf-8');
  fs.writeFileSync(path.join(jobDir, 'intents.yaml'), JOB_SCAFFOLD_INTENTS_YAML, 'utf-8');
}

/** Patch top-level yaml fields in place, preserving the rest of the document. */
export function patchYamlFile(filePath: string, patch: Record<string, unknown>): void {
  const doc = (yaml.load(fs.readFileSync(filePath, 'utf-8')) ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) doc[k] = v;
  }
  fs.writeFileSync(filePath, yaml.dump(doc), 'utf-8');
}

/** Caller identity + resolved org authority for the ACL-governed write gate. */
export interface OrgWriteGate {
  callerId: string;
  /** Live team role — null when the caller is no longer a member (stale JWT). */
  liveRole: OrgMembershipRole | null;
  acl: OrgAgentAcl;
}

/**
 * Resolve a writable agent or write the failure response (400 invalid id /
 * 404 not found / 403 readonly scope or org-ACL refusal) and return null.
 * `orgGate` resolves the caller's org authority LAZILY — only invoked when
 * the agent lives in an ACL-governed (per-org) root.
 */
export async function findWritableAgent(
  res: Response,
  scopeRoots: CustomAgentScopeRoot[],
  agentId: string,
  orgGate?: () => Promise<OrgWriteGate>,
): Promise<{ scopeRoot: CustomAgentScopeRoot; agentDir: string } | null> {
  if (!isValidCustomId(agentId)) {
    res.status(400).json({ error: `Invalid agent id: ${agentId}` });
    return null;
  }
  const found = findAgentRoot(scopeRoots, agentId);
  if (!found) {
    res.status(404).json({ error: `Custom agent not found: ${agentId}` });
    return null;
  }
  if (found.scopeRoot.readonly) {
    res.status(403).json({ error: `Custom agent "${agentId}" is read-only (scope: ${found.scopeRoot.scope})` });
    return null;
  }
  if (found.scopeRoot.aclGoverned) {
    const gate = orgGate ? await orgGate() : null;
    if (!gate || !canEditOrgAgent(gate.acl.agents[agentId], gate.callerId, gate.liveRole)) {
      res.status(403).json({
        error: `You do not have edit access to org agent "${agentId}" — ask the agent owner or an org admin`,
        code: 'org-agent-forbidden',
      });
      return null;
    }
  }
  return found;
}

/**
 * 409 message for agent creation/import collisions. Readonly (org/builtin)
 * ownership gets its own wording — shadowing is refused, not silently applied.
 */
export function createCollisionMessage(
  agentId: string,
  collision: { scopeRoot: CustomAgentScopeRoot },
): string {
  if (collision.scopeRoot.scope === 'builtin') {
    return `Agent id "${agentId}" is taken by a built-in agent — choose another id`;
  }
  if (collision.scopeRoot.scope === 'org') {
    return `Agent id "${agentId}" is taken by an org agent — choose another id`;
  }
  return `Custom agent already exists: ${agentId}`;
}

/**
 * Per-caller decoration of org-scope summaries from an ACL-governed root:
 * `readonly` flips to the caller's effective authority and the `org`
 * permission projection is attached. env-dir org agents (no ACL root) and
 * other scopes pass through untouched. Shared by BOTH list mounts.
 */
export function decorateOrgAgentSummaries(
  agents: CustomAgentSummary[],
  scopeRoots: CustomAgentScopeRoot[],
  gate: OrgWriteGate,
): CustomAgentSummary[] {
  return agents.map((agent) => {
    if (agent.scope !== 'org') return agent;
    const found = findAgentRoot(scopeRoots, agent.id);
    if (!found?.scopeRoot.aclGoverned) return agent;
    const org = computeOrgAgentPermissions(gate.acl.agents[agent.id], gate.callerId, gate.liveRole);
    return { ...agent, readonly: !org.canEdit, org };
  });
}

// ── definition file surface ──────────────────────────────────────────────────

/** Path-traversal-safe resolve inside an agent definition dir. */
export function resolveDefinitionPath(agentDir: string, relPath: string): string {
  const root = path.resolve(agentDir);
  const full = path.resolve(root, relPath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Invalid definition path: ${relPath}`);
  }
  return full;
}

/** Recursive definition file tree (dirs first, name-sorted, dotfiles hidden). */
export function buildDefinitionTree(agentDir: string, rel = ''): CustomAgentDefinitionFileNode[] {
  const abs = rel ? path.join(agentDir, rel) : agentDir;
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    .map((e) => {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        return { name: e.name, path: childRel, type: 'directory' as const, children: buildDefinitionTree(agentDir, childRel) };
      }
      let size = 0;
      try {
        size = fs.statSync(path.join(abs, e.name)).size;
      } catch { /* skip stat failures */ }
      return { name: e.name, path: childRel, type: 'file' as const, size };
    });
}

export type DefinitionSaveGate =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * PRE-WRITE gate for the single definition write funnel: whitelist membership,
 * YAML syntax, the id ≡ directory-name invariant for agent.yaml/job.yaml, and
 * the full intent-catalog contract for intents.yaml (same validator the loader
 * runs at job accept). Failing any of these returns 400 and the file is NOT
 * written — a file the funnel records is always at least structurally loadable.
 */
/** First MCP contract violation in a parsed agent.yaml/job.yaml, or null. */
function mcpErrorOf(parsed: unknown): string | null {
  const servers = (parsed as { mcp?: { servers?: Record<string, McpServerConfig> } } | null)?.mcp?.servers;
  return validateMcpServers(servers)[0] ?? null;
}

export function gateDefinitionSave(agentId: string, relPath: string, content: string): DefinitionSaveGate {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!isAllowedDefinitionPath(normalized)) {
    // Legacy agent-level intent/injection paths get the migration message,
    // not the generic whitelist refusal.
    if (normalized === 'intents.yaml') {
      return {
        ok: false,
        status: 400,
        error: `Agent-level intents.yaml was removed — intents are job-only; save the catalog as jobs/{jobId}/intents.yaml`,
      };
    }
    if (/^injections\/[^/]+\.md$/.test(normalized)) {
      return {
        ok: false,
        status: 400,
        error: `Agent-level injections/ was removed — save the file under jobs/{jobId}/injections/`,
      };
    }
    return { ok: false, status: 400, error: `Path is outside the definition whitelist: ${normalized}` };
  }
  if (normalized.endsWith('.yaml')) {
    let parsed: unknown;
    try {
      parsed = yaml.load(content);
    } catch (e) {
      return { ok: false, status: 400, error: `YAML syntax error: ${e instanceof Error ? e.message : String(e)}` };
    }
    const segments = normalized.split('/');
    if (normalized === 'agent.yaml') {
      const id = (parsed as { id?: unknown } | null)?.id;
      if (id !== agentId) {
        return { ok: false, status: 400, error: `agent.yaml id "${String(id)}" must equal the agent directory name "${agentId}"` };
      }
      try {
        validateAgentYamlDoc(parsed, agentId);
      } catch (e) {
        if (e instanceof CustomAgentValidationError) return { ok: false, status: 400, error: e.message };
        throw e;
      }
      const mcpError = mcpErrorOf(parsed);
      if (mcpError) return { ok: false, status: 400, error: mcpError };
    } else if (segments[0] === 'jobs' && segments[2] === 'job.yaml') {
      const jobId = segments[1];
      const id = (parsed as { id?: unknown } | null)?.id;
      if (id !== jobId) {
        return { ok: false, status: 400, error: `job.yaml id "${String(id)}" must equal the job directory name "${jobId}"` };
      }
      try {
        validateJobYamlDoc(parsed, agentId, jobId);
      } catch (e) {
        if (e instanceof CustomAgentValidationError) return { ok: false, status: 400, error: e.message };
        throw e;
      }
      const mcpError = mcpErrorOf(parsed);
      if (mcpError) return { ok: false, status: 400, error: mcpError };
    } else if (segments[segments.length - 1] === 'intents.yaml') {
      try {
        validateIntentsDoc(parsed, agentId, segments[0] === 'jobs' ? segments[1] : undefined);
      } catch (e) {
        if (e instanceof CustomAgentValidationError) {
          return { ok: false, status: 400, error: e.message };
        }
        throw e;
      }
    }
  }
  return { ok: true };
}

function listJobIds(agentDir: string): string[] {
  const jobsDir = path.join(agentDir, 'jobs');
  if (!fs.existsSync(jobsDir)) return [];
  return fs
    .readdirSync(jobsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidCustomId(e.name) && fs.existsSync(path.join(jobsDir, e.name, 'job.yaml')))
    .map((e) => e.name);
}

/**
 * POST-WRITE semantic validation: `loadCustomJob` dry-run over the affected
 * jobs (the edited job only when the path is job-scoped, every job of the
 * agent otherwise — agent-level files feed all of them). Errors are warnings,
 * not rollbacks: the file is saved, the settings UI surfaces the list.
 */
export function validateDefinitionSave(
  scopeRoots: CustomAgentScopeRoot[],
  agentDir: string,
  agentId: string,
  relPath: string,
): DefinitionValidationResult {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  const affectedJobs = segments[0] === 'jobs' && isValidCustomId(segments[1] ?? '')
    ? listJobIds(agentDir).filter((j) => j === segments[1])
    : listJobIds(agentDir);

  const errors: string[] = [];
  for (const jobId of affectedJobs) {
    try {
      loadCustomJob(scopeRoots, agentId, jobId);
    } catch (e) {
      if (e instanceof CustomAgentValidationError) {
        errors.push(`${agentId}/${jobId}: ${e.message}`);
      } else {
        errors.push(`${agentId}/${jobId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
