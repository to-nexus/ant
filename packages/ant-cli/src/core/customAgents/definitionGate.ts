/**
 * The definition save gate — pure over file contents, no HTTP, no Redis.
 *
 * Owned here so the SAME rules judge a definition wherever it is authored:
 * the `PUT /definitions/agents/:id/file` funnel, the multipart import lanes,
 * and the offline `definition` CLI an external agent runs against a folder it
 * wrote from the builder handoff. One implementation; a rule added here is
 * enforced on every lane at once.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  INTENTS_DIR_NAME,
  INTENT_INFER_FILE_NAME,
  INTENT_PROMPT_FILE_NAME,
  INTENT_HOOKS_FILE_NAME,
  ON_DEMAND_DIR_NAME,
  DEFINITION_ICON_MAX_BYTES,
  DEFINITION_ICON_MIME,
  isAllowedDefinitionPath,
  isDefinitionIconPath,
  isValidCustomId,
  validateMcpServers,
  validateApiServers,
  clarifyExitOutcomes,
  type DefinitionValidationResult,
  type McpServerConfig,
  type RestApiServerConfig,
} from '@ant/shared';
import {
  loadCustomJob,
  validateAgentYamlDoc,
  validateJobYamlDoc,
  type CustomAgentScopeRoot,
} from './CustomAgentLoader';
import { CustomAgentValidationError } from './types';
import { detectImageMimeFromBuffer } from '../utils/imageMime';
import { INTENT_CATALOG_CAP, validateHooksFileDoc, validateInferFile } from './intents';

/**
 * Admission for a file arriving as BYTES (the multipart lanes and the offline
 * CLI): whitelist membership, and for an icon the size cap plus a magic-byte
 * sniff that must agree with the name it is stored under — a `.png`-named JPEG
 * is refused rather than served with a lying Content-Type. Text files are
 * judged by `gateDefinitionSave`, which reads their content.
 */
export function admitDefinitionUpload(
  relPath: string,
  buffer: Buffer,
): { ok: true; rel: string } | { ok: false; reason: string } {
  const rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || !isAllowedDefinitionPath(rel)) {
    return { ok: false, reason: 'outside the definition whitelist' };
  }
  if (isDefinitionIconPath(rel)) {
    if (buffer.length > DEFINITION_ICON_MAX_BYTES) {
      return { ok: false, reason: `icon exceeds ${DEFINITION_ICON_MAX_BYTES} bytes` };
    }
    const sniffed = detectImageMimeFromBuffer(buffer);
    if (sniffed !== DEFINITION_ICON_MIME[rel]) {
      return {
        ok: false,
        reason: `icon bytes are ${sniffed ?? 'not a supported image'}, expected ${DEFINITION_ICON_MIME[rel]}`,
      };
    }
  }
  return { ok: true, rel };
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

/**
 * The same residue with MORE of the escape eaten: `\uBA74` for 면 came back as
 * "일치하a74", where `\uB` is gone and three hex digits are left welded to the
 * preceding syllable — too few digits and no `u` for the pattern above.
 *
 * Kept narrow so real text survives: the run must sit directly against a
 * Hangul syllable, be 3-4 characters of LOWERCASE hex holding BOTH a digit and
 * an a-f letter, and end at a space or another syllable. A codepoint's hex
 * always mixes the two, while the strings this would otherwise catch do not —
 * "삼성A74" is uppercase, "갤럭시S23" is not hex, "테스트abc" has no digit.
 */
const ORPHANED_ESCAPE_HEX_RESIDUE = new RegExp(
  '[가-힣]'
  + '(?=(?:[0-9a-f]{3,4})(?:[\\s가-힣]|$))'
  + '(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])'
  + '[0-9a-f]{3,4}',
);

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
    const orphan = ORPHANED_UNICODE_ESCAPE.exec(content) ?? ORPHANED_ESCAPE_HEX_RESIDUE.exec(content);
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

export function listJobIds(agentDir: string): string[] {
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
