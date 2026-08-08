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
  type CustomAgentDefinitionFileNode,
  type DefinitionValidationResult,
} from '@ant/shared';
import {
  findAgentRoot,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../../core/customAgents/types';

// ── scaffolds ────────────────────────────────────────────────────────────────

export const AGENT_SCAFFOLD_SYSTEM_MD = `# Role

Describe this agent's shared persona and working principles here.
Everything in \`base/\` is always injected for every job of this agent.
Put long, situational material into \`injections/\` instead — the runtime
shows a table of contents and loads files on demand.
`;

export const JOB_SCAFFOLD_SYSTEM_MD = `# Job Procedure

Describe what this job does, step by step, and what a good result looks like.
This file is always injected on top of the agent's shared \`base/\` prose.
`;

export const AGENT_SCAFFOLD_INTENTS_YAML = `# Intent catalog (optional). An empty catalog costs nothing — the intent
# classifier is skipped entirely until you declare entries.
#
# Each description is the classification matching criterion; when an intent is
# active its \`injections\` files are inlined in full (otherwise they stay in
# the on-demand table of contents). Example:
#
# intents:
#   - id: review
#     description: 'Review or critique an existing document in the workspace'
#     injections: [review-checklist.md]
version: 1
intents: []
`;

export function scaffoldAgent(agentDir: string, id: string, name: string, description: string): void {
  fs.mkdirSync(path.join(agentDir, 'base'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'injections'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.yaml'), yaml.dump({ id, name, description, version: 1 }), 'utf-8');
  fs.writeFileSync(path.join(agentDir, 'base', 'system.md'), AGENT_SCAFFOLD_SYSTEM_MD, 'utf-8');
  fs.writeFileSync(path.join(agentDir, 'intents.yaml'), AGENT_SCAFFOLD_INTENTS_YAML, 'utf-8');
}

export function scaffoldJob(jobDir: string, id: string, name: string, description: string): void {
  fs.mkdirSync(path.join(jobDir, 'base'), { recursive: true });
  fs.mkdirSync(path.join(jobDir, 'injections'), { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, 'job.yaml'),
    yaml.dump({ id, name, description, version: 1, outputs: { mode: 'free' } }),
    'utf-8',
  );
  fs.writeFileSync(path.join(jobDir, 'base', 'system.md'), JOB_SCAFFOLD_SYSTEM_MD, 'utf-8');
}

/** Patch top-level yaml fields in place, preserving the rest of the document. */
export function patchYamlFile(filePath: string, patch: Record<string, unknown>): void {
  const doc = (yaml.load(fs.readFileSync(filePath, 'utf-8')) ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) doc[k] = v;
  }
  fs.writeFileSync(filePath, yaml.dump(doc), 'utf-8');
}

/**
 * Resolve a writable agent or write the failure response (400 invalid id /
 * 404 not found / 403 readonly scope) and return null.
 */
export function findWritableAgent(
  res: Response,
  scopeRoots: CustomAgentScopeRoot[],
  agentId: string,
): { scopeRoot: CustomAgentScopeRoot; agentDir: string } | null {
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
  return found;
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
 * YAML syntax, and the id ≡ directory-name invariant for agent.yaml/job.yaml.
 * Failing any of these returns 400 and the file is NOT written — a file the
 * funnel records is always at least structurally loadable.
 */
export function gateDefinitionSave(agentId: string, relPath: string, content: string): DefinitionSaveGate {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!isAllowedDefinitionPath(normalized)) {
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
    } else if (segments[0] === 'jobs' && segments[2] === 'job.yaml') {
      const jobId = segments[1];
      const id = (parsed as { id?: unknown } | null)?.id;
      if (id !== jobId) {
        return { ok: false, status: 400, error: `job.yaml id "${String(id)}" must equal the job directory name "${jobId}"` };
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
