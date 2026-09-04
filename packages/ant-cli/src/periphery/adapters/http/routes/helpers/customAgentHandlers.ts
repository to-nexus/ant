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
  INTENTS_DIR_NAME,
  INTENT_INFER_FILE_NAME,
  INTENT_PROMPT_FILE_NAME,
  INTENT_HOOKS_FILE_NAME,
  ON_DEMAND_DIR_NAME,
  isAllowedDefinitionPath,
  isValidCustomId,
  validateMcpServers,
  validateApiServers,
  type CustomAgentDefinitionFileNode,
  type DefinitionValidationResult,
  type CustomAgentSummary,
  type McpServerConfig,
  type RestApiServerConfig,
  type OrgMembershipRole,
} from '@ant/shared';
import { canEditOrgResource, computeOrgResourcePermissions, type OrgResourceGate } from './orgAclStore';
import {
  findAgentRoot,
  loadCustomJob,
  validateAgentYamlDoc,
  validateJobYamlDoc,
  type CustomAgentScopeRoot,
} from '../../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../../core/customAgents/types';
import {
  INTENT_CATALOG_CAP,
  validateHooksFileDoc,
  validateInferFile,
  clarifyExitOutcomes,
} from '../../../../../core/customAgents/intents';

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

export type DefinitionSaveGate =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Per-file byte budget for the definition write funnel. Definition files are
 * prose and yaml; anything larger belongs in the multipart upload channel,
 * which carries its own reservation budget.
 */
export const DEFINITION_FILE_MAX_BYTES = 1024 * 1024;

/**
 * PRE-WRITE gate for the single definition write funnel: whitelist membership,
 * YAML syntax, the id ≡ directory-name invariant for agent.yaml/job.yaml, the
 * infer.md contract (frontmatter grammar + criterion body), and the hooks.yaml
 * contract (same validators the loader runs at job accept). Failing any of
 * these returns 400 and the file is NOT written — a file the funnel records is
 * always at least structurally loadable. When `agentDir` is provided, the
 * cross-file catalog cap is front-loaded against the on-disk siblings too —
 * the loader stays the authority, this only turns a would-be broken catalog
 * into an immediate 400.
 */
/** First MCP/API contract violation in a parsed agent.yaml/job.yaml, or null. */
function mcpErrorOf(parsed: unknown): string | null {
  const doc = parsed as { mcp?: { servers?: Record<string, McpServerConfig> }; apis?: Record<string, RestApiServerConfig> } | null;
  return validateMcpServers(doc?.mcp?.servers)[0] ?? validateApiServers(doc?.apis)[0] ?? null;
}

/**
 * Whitelist refusal that names the alternative — a job writing its outputs
 * through the definition API is the common miss (major-loading-floor RCA), and
 * a bare refusal costs it a self-inference retry round.
 */
export function definitionWhitelistGuidance(relPath: string): string {
  return (
    `Path is outside the definition whitelist: ${relPath}. ` +
    `This endpoint writes agent DEFINITION files only (agent.yaml, base/, jobs/{jobId}/..., ${ON_DEMAND_DIR_NAME}/...). ` +
    'Job outputs and reports are artifacts — write them with the create_file tool into the job workspace, not through the definition API.'
  );
}

/**
 * A `uXXXX` run sitting immediately against non-ASCII text: a `\uXXXX` escape
 * whose backslash was lost, leaving the four hex digits as literal prose and
 * the character they meant absent. Observed live as `평ubc84vs` inside an
 * authored Korean procedure — well-formed JSON, valid on save, and unreadable
 * by the agent that later runs it. The adjacency is what makes this safe to
 * refuse: a word boundary separates real text from a real identifier, so no
 * legitimate prose puts bare hex digits flush against a Hangul syllable. The
 * backslash-bearing form is caught too, since that spelling is equally never
 * intended in a definition.
 */
const ORPHANED_UNICODE_ESCAPE =
  /\\u[0-9a-fA-F]{4}|[^\x00-\x7F]u[0-9a-fA-F]{4}|u[0-9a-fA-F]{4}[^\x00-\x7F]/;

export function gateDefinitionSave(
  agentId: string,
  relPath: string,
  content: string,
  agentDir?: string,
): DefinitionSaveGate {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (Buffer.byteLength(content, 'utf-8') > DEFINITION_FILE_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error:
        `File exceeds the ${Math.floor(DEFINITION_FILE_MAX_BYTES / 1024)}KB definition-file budget — ` +
        'split the document, or attach large material through the file upload channel instead',
    };
  }
  if (!isAllowedDefinitionPath(normalized)) {
    // Legacy intent/injection paths get the migration message, not the
    // generic whitelist refusal.
    if (normalized === 'intents.yaml') {
      return {
        ok: false,
        status: 400,
        error: `Agent-level intents.yaml was removed — intents are job-only; save each intent's criterion as jobs/{jobId}/${INTENTS_DIR_NAME}/{intentId}/${INTENT_INFER_FILE_NAME}`,
      };
    }
    if (/^jobs\/[^/]+\/intents\.yaml$/.test(normalized)) {
      return {
        ok: false,
        status: 400,
        error: `jobs/{jobId}/intents.yaml was replaced by per-intent directories — save each intent's criterion as jobs/{jobId}/${INTENTS_DIR_NAME}/{intentId}/${INTENT_INFER_FILE_NAME} (prose into ${INTENT_PROMPT_FILE_NAME}, hooks into ${INTENT_HOOKS_FILE_NAME} alongside)`,
      };
    }
    if (/^jobs\/[^/]+\/intents\/[^/]+\/intent\.yaml$/.test(normalized)) {
      return {
        ok: false,
        status: 400,
        error: `${INTENTS_DIR_NAME}/{intentId}/intent.yaml was replaced by ${INTENT_INFER_FILE_NAME} — save the criterion as the ${INTENT_INFER_FILE_NAME} body (clarify in its frontmatter) and the intent's prose as ${INTENT_PROMPT_FILE_NAME}`,
      };
    }
    if (/^(jobs\/[^/]+\/)?injections\/[^/]+\.md$/.test(normalized)) {
      return {
        ok: false,
        status: 400,
        error: `injections/ was removed — each intent owns its prose as jobs/{jobId}/${INTENTS_DIR_NAME}/{intentId}/${INTENT_PROMPT_FILE_NAME} (its ${INTENT_INFER_FILE_NAME} criterion says when it applies)`,
      };
    }
    if (/^(jobs\/[^/]+\/)?reference\//.test(normalized)) {
      return {
        ok: false,
        status: 400,
        error: `reference/ was renamed to ${ON_DEMAND_DIR_NAME}/ — the channel is unchanged (paths rendered into the system block, bodies read on demand); save the file under ${ON_DEMAND_DIR_NAME}/ instead`,
      };
    }
    return { ok: false, status: 400, error: definitionWhitelistGuidance(normalized) };
  }
  {
    const orphan = ORPHANED_UNICODE_ESCAPE.exec(content);
    if (orphan) {
      return {
        ok: false,
        status: 400,
        error:
          `"${orphan[0]}" — a Unicode escape that lost its backslash, so the character it stood for is ` +
          `missing from the text. Write the text directly; the transport encodes it. Re-send this file with ` +
          `the intended characters in place of that fragment.`,
      };
    }
  }
  {
    const segments = normalized.split('/');
    if (segments[2] === INTENTS_DIR_NAME && segments[4] === INTENT_INFER_FILE_NAME) {
      const jobId = segments[1];
      const intentId = segments[3];
      try {
        const { outcomes } = validateInferFile(content, intentId, agentId, jobId);
        // Save-only: an outcome id meaning the turn could not start is the clarify
        // exit wearing a verdict, and every pipeline branching on this intent gets
        // a route for an answer nobody gave. The loader does not re-check it, so a
        // definition already carrying one still loads.
        const clarifyExits = clarifyExitOutcomes(outcomes);
        if (clarifyExits.length > 0) {
          return {
            ok: false,
            status: 400,
            error:
              `outcomes may not include "${clarifyExits.join('", "')}" — an outcome is a conclusion the work ` +
              `reached, and "the inputs were missing" is the clarify exit, not a verdict. Drop it from the ` +
              `vocabulary and let the turn end through clarify when it cannot start; if nothing is left that ` +
              `names a decision, this intent is not a judgment and declares no outcomes at all`,
          };
        }
      } catch (e) {
        if (e instanceof CustomAgentValidationError) return { ok: false, status: 400, error: e.message };
        throw e;
      }
      // An intent directory is born by its first infer.md write — front-load
      // the catalog cap so the UI gets an immediate 400 instead of a broken
      // catalog (the loader stays the authority).
      if (agentDir) {
        const intentsDir = path.join(agentDir, 'jobs', jobId, INTENTS_DIR_NAME);
        if (!fs.existsSync(path.join(intentsDir, intentId))) {
          const existing = fs.existsSync(intentsDir)
            ? fs.readdirSync(intentsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
            : 0;
          if (existing >= INTENT_CATALOG_CAP) {
            return {
              ok: false,
              status: 400,
              error: `${INTENTS_DIR_NAME}/: catalog already has ${existing} intents — cap is ${INTENT_CATALOG_CAP}`,
            };
          }
        }
      }
      return { ok: true };
    }
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
    } else if (segments[2] === INTENTS_DIR_NAME && segments[4] === INTENT_HOOKS_FILE_NAME) {
      try {
        validateHooksFileDoc(parsed, segments[3], agentId, segments[1]);
      } catch (e) {
        if (e instanceof CustomAgentValidationError) return { ok: false, status: 400, error: e.message };
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
      const resolved = loadCustomJob(scopeRoots, agentId, jobId);
      // H9-class advisories: non-fatal at load (a running agent stays
      // loadable) but a save must hear them — the author is mid-edit and
      // self-corrects on `valid: false`.
      for (const advisory of resolved.advisories ?? []) {
        errors.push(`${agentId}/${jobId}: ${advisory}`);
      }
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
