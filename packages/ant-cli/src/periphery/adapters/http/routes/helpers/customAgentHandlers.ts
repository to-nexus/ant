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
  DEFINITION_ICON_NAMES,
  isDefinitionIconPath,
  isValidCustomId,
  type CustomAgentDefinitionFileNode,
  type CustomAgentSummary,
  type OrgMembershipRole,
} from '@ant/shared';
import { canEditOrgResource, computeOrgResourcePermissions, type OrgResourceGate } from './orgAclStore';
import {
  findAgentRoot,
  type CustomAgentScopeRoot,
} from '../../../../../core/customAgents/CustomAgentLoader';
import { admitDefinitionUpload } from '../../../../../core/customAgents/definitionGate';

// ── scaffolds ────────────────────────────────────────────────────────────────

export const AGENT_SCAFFOLD_ROLE_MD = `# Role

Describe this agent's purpose — who it is and what it is for, stated so it
still fits when the next job in the same domain arrives. What it DOES is the
intent catalog, which the runtime renders every turn: do not restate or
enumerate the intents (or the situations they cover) here, and leave each
procedure's own rules to the job and intent that own them.
Everything in \`base/\` is always injected for every job of this agent.
Job-specific procedure and the intent catalog (each intent's criterion,
prompt, and hooks) live under each \`jobs/{jobId}/\` directory.
`;

export const JOB_SCAFFOLD_SYSTEM_MD = `# Job Procedure

Describe the shared ground every intent under this job works on — the
principles, constraints, and domain facts that hold for all of them, and what
a good result looks like. What this job does is its intent catalog: the
runtime renders that list every turn, so do not restate or enumerate the
intents here. This file is always injected on top of the agent's shared
\`base/\` prose. Put long, situational material into an intent's \`prompt.md\`
instead — its \`infer.md\` criterion says when it applies, and the runtime
loads the prompt only for turns under that intent.
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

export function scaffoldJob(jobDir: string, id: string, name: string): void {
  fs.mkdirSync(path.join(jobDir, 'base'), { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'job.yaml'), yaml.dump({ id, name, version: 1 }), 'utf-8');
  fs.writeFileSync(path.join(jobDir, 'base', JOB_BASE_DEFAULT_MD), JOB_SCAFFOLD_SYSTEM_MD, 'utf-8');
  // No intent scaffold: a job without intents/ is a valid empty catalog; the
  // settings UI creates intents/{id}/infer.md through the PUT funnel.
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
export type OrgWriteGate = OrgResourceGate;

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
    if (!gate || !canEditOrgResource(gate.records[agentId], gate.callerId, gate.liveRole)) {
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
    const org = computeOrgResourcePermissions(gate.records[agent.id], gate.callerId, gate.liveRole);
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

/**
 * The ONE writer behind both multipart definition lanes (`files/upload` and
 * `/import`). They used to carry byte-identical loops that each ended in
 * `writeFileSync(full, buffer.toString('utf-8'), 'utf-8')` — a silent binary
 * corrupter, and two places for the whitelist verdict to drift.
 *
 * Admission (whitelist + icon sniff) is `admitDefinitionUpload` in core, so the
 * offline CLI judges a folder by the same rule; this function owns only the
 * write. The buffer lands verbatim (a no-op for valid text) and on success the
 * sibling icon names are unlinked, which is what keeps "one agent, one icon"
 * true without a second owner.
 */
export function writeDefinitionUpload(
  agentDir: string,
  relPath: string,
  buffer: Buffer,
): { ok: true } | { ok: false; reason: string } {
  const admitted = admitDefinitionUpload(relPath, buffer);
  if (!admitted.ok) return admitted;
  const rel = admitted.rel;
  let full: string;
  try {
    full = resolveDefinitionPath(agentDir, rel);
  } catch {
    return { ok: false, reason: 'outside the definition whitelist' };
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  if (isDefinitionIconPath(rel)) {
    for (const other of DEFINITION_ICON_NAMES) {
      if (other === rel) continue;
      try {
        fs.rmSync(path.join(agentDir, other), { force: true });
      } catch { /* nothing to drop */ }
    }
  }
  return { ok: true };
}
