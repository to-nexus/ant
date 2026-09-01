/**
 * Intent catalog — parsing and validation for the per-intent directories
 * `jobs/{jobId}/intents/{intentId}/`:
 *   infer.md    REQUIRED — optional `clarify` frontmatter + prose body = the
 *               inference criterion rendered into the Intent Catalog
 *   prompt.md   OPTIONAL — prose inlined while the intent is active
 *   hooks.yaml  OPTIONAL — the completion contract (shared H1–H6 rules)
 *
 * The catalog is CODE-EXTERIOR DATA (D-F) and JOB-ONLY (mirroring canonical,
 * where intents belong to jobs): it is loaded fresh at every job accept, and
 * its ids are a per-job runtime string vocabulary — they never join the
 * compile-time canonical `IntentId` union and never key any code-resident
 * matrix. The intent id IS the directory name — no file declares it, so an
 * intent rename is a pure directory rename.
 *
 * Shared by the loader (`loadCustomJob`) and the settings API's save
 * validation (single validation SSOT — a file the PUT funnel accepts is a
 * file the runtime will load). Per-file rules live in `validateInferFile` /
 * `validateHooksFileDoc`; the cross-file invariant (catalog cap) aggregates
 * in `parseIntentsDir`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  GENERAL_INTENT,
  INTENTS_DIR_NAME,
  INTENT_INFER_FILE_NAME,
  INTENT_PROMPT_FILE_NAME,
  INTENT_HOOKS_FILE_NAME,
  INTENT_OUTCOMES_MAX,
  INTENT_OUTCOMES_MIN,
  CUSTOM_ID_HINT,
  isValidCustomId,
  splitFrontmatter,
  validateIntentHooks,
  type CustomIntentDef,
  type IntentHooks,
} from '@ant/shared';
import { CustomAgentValidationError } from './types.js';
import { isUniversalBuiltinTool } from './universalToolPolicy.js';

/** Catalog size cap — keeps the rendered Intent Catalog bounded. */
export const INTENT_CATALOG_CAP = 32;

/**
 * infer.md body cap — the criterion is rendered into the Intent Catalog for
 * every intent on every turn: worst case 32 × 1000 = 32k chars (~8k tokens),
 * the same order as the base-prose cap. A criterion needing more than ~15
 * lines is procedure, which belongs in prompt.md.
 */
export const INFER_BODY_MAX = 1_000;

const LEGACY_INTENTS_FILE = 'intents.yaml';
const LEGACY_INTENT_FILE = 'intent.yaml';

function inferFileLabel(intentId: string): string {
  return `${INTENTS_DIR_NAME}/${intentId}/${INTENT_INFER_FILE_NAME}`;
}

function hooksFileLabel(intentId: string): string {
  return `${INTENTS_DIR_NAME}/${intentId}/${INTENT_HOOKS_FILE_NAME}`;
}

/**
 * Retired frontmatter/schema keys, each with a pointed move message — per
 * AGENTS.md, silently ignoring a removed key is how an author concludes a
 * knob works.
 */
const BANNED_FRONTMATTER_KEYS: Record<string, (intentId: string) => string> = {
  default: (id) =>
    `"default" was removed — there is no catalog default; an unpinned turn always runs as "${GENERAL_INTENT}" and self-selects off the Intent Catalog. Where you relied on the default (scheduled/API runs), pin the intent explicitly via @intent: / turn meta`,
  injections: (id) =>
    `"injections" was removed — an intent owns exactly one prose file, ${INTENTS_DIR_NAME}/${id}/${INTENT_PROMPT_FILE_NAME}; move the referenced content there`,
  description: () =>
    `"description" is not a frontmatter key — the infer.md BODY (below the closing ---) is the inference criterion`,
  id: (id) =>
    `"id" is not declared anywhere — the intent id IS the ${INTENTS_DIR_NAME}/${id}/ directory name (rename the directory to rename the intent)`,
  hooks: (id) => `"hooks" moved to ${hooksFileLabel(id)} — declare it there`,
};

function assertNotGeneral(intentId: string, agentId: string, jobId?: string): void {
  if (intentId === GENERAL_INTENT) {
    throw new CustomAgentValidationError(
      `${INTENTS_DIR_NAME}/${intentId}/: "${GENERAL_INTENT}" is the implicit fallback intent and cannot be declared`,
      agentId,
      jobId,
    );
  }
}

/**
 * Validate one raw `infer.md` file (per-file rules only — the cross-file cap
 * stays in `parseIntentsDir`). Frontmatter is optional and allows exactly one
 * key (`clarify: <bool>`); a comments-only frontmatter block is valid (that
 * is where authoring guidance lives without reaching the rendered prompt).
 * The prose body is the inference criterion: non-empty after trim, bounded.
 */
export function validateInferFile(
  raw: string,
  intentId: string,
  agentId: string,
  jobId?: string,
): { infer: string; clarify?: boolean; outcomes?: string[] } {
  assertNotGeneral(intentId, agentId, jobId);
  const label = inferFileLabel(intentId);
  const { frontmatter, body, unterminated } = splitFrontmatter(raw);
  if (unterminated) {
    throw new CustomAgentValidationError(
      `${label} opens a "---" frontmatter fence that never closes — add the closing "---" line or remove the fence`,
      agentId,
      jobId,
    );
  }

  let clarify: boolean | undefined;
  let outcomes: string[] | undefined;
  if (frontmatter !== null) {
    let doc: unknown;
    try {
      doc = yaml.load(frontmatter);
    } catch (e) {
      throw new CustomAgentValidationError(
        `Invalid YAML in ${label} frontmatter: ${e instanceof Error ? e.message : String(e)}`,
        agentId,
        jobId,
      );
    }
    if (doc != null) {
      if (typeof doc !== 'object' || Array.isArray(doc)) {
        throw new CustomAgentValidationError(
          `${label} frontmatter must be a YAML mapping (or comments only)`,
          agentId,
          jobId,
        );
      }
      const keys = Object.keys(doc as Record<string, unknown>);
      for (const key of keys) {
        const banned = BANNED_FRONTMATTER_KEYS[key];
        if (banned) {
          throw new CustomAgentValidationError(`${label}: ${banned(intentId)}`, agentId, jobId);
        }
      }
      const extras = keys.filter((k) => k !== 'clarify' && k !== 'outcomes');
      if (extras.length > 0) {
        throw new CustomAgentValidationError(
          `${label} frontmatter allows only "clarify" and "outcomes" (got: ${keys.join(', ')})`,
          agentId,
          jobId,
        );
      }
      const value = (doc as Record<string, unknown>).clarify;
      if (value !== undefined && typeof value !== 'boolean') {
        throw new CustomAgentValidationError(
          `${label}: clarify must be true or false (got: ${JSON.stringify(value)}) — ` +
          `false declares turns under this intent autonomous/unattended: the agent never asks a blocking question and proceeds with sensible defaults`,
          agentId,
          jobId,
        );
      }
      clarify = value as boolean | undefined;
      const rawOutcomes = (doc as Record<string, unknown>).outcomes;
      if (rawOutcomes !== undefined) {
        if (
          !Array.isArray(rawOutcomes) ||
          rawOutcomes.length < INTENT_OUTCOMES_MIN ||
          rawOutcomes.length > INTENT_OUTCOMES_MAX ||
          rawOutcomes.some((o) => typeof o !== 'string' || !isValidCustomId(o))
        ) {
          throw new CustomAgentValidationError(
            `${label}: outcomes must be ${INTENT_OUTCOMES_MIN}–${INTENT_OUTCOMES_MAX} kebab-case ids ` +
            `(the decision vocabulary a turn ends with as <verdict>…</verdict>; got: ${JSON.stringify(rawOutcomes)})`,
            agentId,
            jobId,
          );
        }
        if (new Set(rawOutcomes).size !== rawOutcomes.length) {
          throw new CustomAgentValidationError(`${label}: outcomes must be unique`, agentId, jobId);
        }
        outcomes = rawOutcomes as string[];
      }
    }
  }

  const infer = body.trim();
  if (infer.length === 0) {
    throw new CustomAgentValidationError(
      `${label} requires a non-empty body — the prose below the frontmatter IS the inference criterion ("applies when does this intent fire")`,
      agentId,
      jobId,
    );
  }
  if (infer.length > INFER_BODY_MAX) {
    throw new CustomAgentValidationError(
      `${label} body exceeds ${INFER_BODY_MAX} chars — the criterion is rendered into every turn's Intent Catalog; move procedure/detail into ${INTENT_PROMPT_FILE_NAME}`,
      agentId,
      jobId,
    );
  }
  return { infer, ...(clarify !== undefined ? { clarify } : {}), ...(outcomes ? { outcomes } : {}) };
}

/**
 * Validate one parsed `hooks.yaml` document. An empty document (null /
 * comments-only, e.g. the settings API's empty-file create) means "no hooks"
 * and returns undefined — the file-absent equivalent. Otherwise the document
 * must be a mapping whose only key is `hooks`, whose value goes through the
 * shared H1–H6 rule set (`validateIntentHooks`, one owner for BE loader + FE
 * editor) with the universal-preset judgement injected for H6. Cross-file
 * satisfiability (H7/H8) stays in `loadCustomJob`.
 */
export function validateHooksFileDoc(
  doc: unknown,
  intentId: string,
  agentId: string,
  jobId?: string,
): IntentHooks | undefined {
  const label = hooksFileLabel(intentId);
  if (doc == null) return undefined;
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new CustomAgentValidationError(`${label} must be a mapping with a single "hooks" key`, agentId, jobId);
  }
  const keys = Object.keys(doc as Record<string, unknown>);
  const extras = keys.filter((k) => k !== 'hooks');
  if (extras.length > 0 || !('hooks' in (doc as Record<string, unknown>))) {
    throw new CustomAgentValidationError(
      `${label} must declare exactly one top-level "hooks" key${extras.length > 0 ? ` (got: ${keys.join(', ')})` : ''}`,
      agentId,
      jobId,
    );
  }
  const { normalized, errors } = validateIntentHooks((doc as Record<string, unknown>).hooks, {
    isKnownBuiltinAction: isUniversalBuiltinTool,
  });
  if (!normalized) {
    throw new CustomAgentValidationError(`${label}: intent "${intentId}" ${errors[0]}`, agentId, jobId);
  }
  return normalized;
}

function readHooksYamlDoc(filePath: string, label: string, agentId: string, jobId?: string): unknown {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    throw new CustomAgentValidationError(
      `Invalid YAML in ${label}: ${e instanceof Error ? e.message : String(e)}`,
      agentId,
      jobId,
    );
  }
}

const INTENT_DIR_FILES: readonly string[] = [
  INTENT_INFER_FILE_NAME,
  INTENT_PROMPT_FILE_NAME,
  INTENT_HOOKS_FILE_NAME,
];

/**
 * Read + validate one `intents/{intentId}/` directory: required `infer.md`,
 * optional `prompt.md` + `hooks.yaml`, and NOTHING else — a typo'd file
 * (`hook.yaml`, `infer.txt`) must fail loud rather than silently disarm the
 * contract it was meant to declare. A whitespace-only prompt.md counts as
 * absent (the settings API's empty-file create must not break the load).
 */
export function readIntentDir(
  intentDirPath: string,
  intentId: string,
  agentId: string,
  jobId?: string,
): { def: CustomIntentDef; promptBody?: string } {
  assertNotGeneral(intentId, agentId, jobId);
  const entries = fs.readdirSync(intentDirPath);
  if (entries.includes(LEGACY_INTENT_FILE)) {
    throw new CustomAgentValidationError(
      `${INTENTS_DIR_NAME}/${intentId}/${LEGACY_INTENT_FILE} was replaced by ${INTENT_INFER_FILE_NAME} — move the description into the ${INTENT_INFER_FILE_NAME} body (it IS the inference criterion), "clarify" into its frontmatter, and delete ${LEGACY_INTENT_FILE}. "injections" and "default" no longer exist: this intent's prose lives in ${INTENTS_DIR_NAME}/${intentId}/${INTENT_PROMPT_FILE_NAME}, and unpinned turns always run as "${GENERAL_INTENT}"`,
      agentId,
      jobId,
    );
  }
  const unknown = entries.filter((e) => !INTENT_DIR_FILES.includes(e));
  if (unknown.length > 0) {
    throw new CustomAgentValidationError(
      `${INTENTS_DIR_NAME}/${intentId}/ holds unexpected entr${unknown.length === 1 ? 'y' : 'ies'} ` +
      `"${unknown.join('", "')}" — an intent directory carries only ${INTENT_DIR_FILES.join(', ')}`,
      agentId,
      jobId,
    );
  }
  if (!entries.includes(INTENT_INFER_FILE_NAME)) {
    throw new CustomAgentValidationError(
      `${INTENTS_DIR_NAME}/${intentId}/ is missing its required ${INTENT_INFER_FILE_NAME} — the file's body is this intent's inference criterion ("applies when"), its optional frontmatter carries clarify`,
      agentId,
      jobId,
    );
  }

  const inferRaw = fs.readFileSync(path.join(intentDirPath, INTENT_INFER_FILE_NAME), 'utf-8');
  const { infer, clarify, outcomes } = validateInferFile(inferRaw, intentId, agentId, jobId);

  let hooks: IntentHooks | undefined;
  if (entries.includes(INTENT_HOOKS_FILE_NAME)) {
    hooks = validateHooksFileDoc(
      readHooksYamlDoc(path.join(intentDirPath, INTENT_HOOKS_FILE_NAME), hooksFileLabel(intentId), agentId, jobId),
      intentId,
      agentId,
      jobId,
    );
  }

  let promptBody: string | undefined;
  if (entries.includes(INTENT_PROMPT_FILE_NAME)) {
    const raw = fs.readFileSync(path.join(intentDirPath, INTENT_PROMPT_FILE_NAME), 'utf-8');
    if (raw.trim().length > 0) promptBody = raw;
  }

  const def: CustomIntentDef = {
    id: intentId,
    infer,
    ...(clarify !== undefined ? { clarify } : {}),
    ...(outcomes ? { outcomes } : {}),
    ...(hooks ? { hooks } : {}),
    ...(promptBody !== undefined ? { hasPrompt: true } : {}),
  };
  return { def, ...(promptBody !== undefined ? { promptBody } : {}) };
}

/**
 * Parse + validate a job's whole intent catalog from `jobs/{jobId}/intents/`.
 * Returns an empty catalog when the directory does not exist (a job without
 * intents is valid — the scaffold ships none). Intent order is the sorted
 * directory-name order (deterministic, same convention as agent/markdown
 * listing). Throws `CustomAgentValidationError` on any structural violation
 * (fail-loud, same contract as the rest of the loader) — including a
 * leftover single-file `intents.yaml`, which was replaced by this layout.
 * `intentPrompts` carries each present prompt.md body, preloaded here so the
 * prompt builder never re-reads disk mid-job.
 */
export function parseIntentsDir(
  jobDir: string,
  agentId: string,
  jobId?: string,
): { intents: CustomIntentDef[]; intentPrompts: Record<string, string> } {
  if (fs.existsSync(path.join(jobDir, LEGACY_INTENTS_FILE))) {
    throw new CustomAgentValidationError(
      `jobs/{jobId}/${LEGACY_INTENTS_FILE} was replaced by per-intent directories — move each intent to ` +
      `jobs/{jobId}/${INTENTS_DIR_NAME}/{intentId}/${INTENT_INFER_FILE_NAME} (criterion body + clarify frontmatter; ` +
      `prose into ${INTENT_PROMPT_FILE_NAME}, hooks into ${INTENT_HOOKS_FILE_NAME} alongside) and delete the file`,
      agentId,
      jobId,
    );
  }
  const intentsDir = intentsDirPathFor(jobDir);
  if (!fs.existsSync(intentsDir)) return { intents: [], intentPrompts: {} };

  const intents: CustomIntentDef[] = [];
  const intentPrompts: Record<string, string> = {};
  for (const name of fs.readdirSync(intentsDir).sort()) {
    const dirPath = path.join(intentsDir, name);
    if (!fs.statSync(dirPath).isDirectory()) {
      throw new CustomAgentValidationError(
        `${INTENTS_DIR_NAME}/ holds a stray file "${name}" — every entry must be an intent directory ` +
        `containing ${INTENT_INFER_FILE_NAME}`,
        agentId,
        jobId,
      );
    }
    if (!isValidCustomId(name)) {
      throw new CustomAgentValidationError(
        `${INTENTS_DIR_NAME}/${name}/ is not a valid intent id — must be ${CUSTOM_ID_HINT}`,
        agentId,
        jobId,
      );
    }
    const { def, promptBody } = readIntentDir(dirPath, name, agentId, jobId);
    intents.push(def);
    if (promptBody !== undefined) intentPrompts[name] = promptBody;
  }

  if (intents.length > INTENT_CATALOG_CAP) {
    throw new CustomAgentValidationError(
      `${INTENTS_DIR_NAME}/: catalog has ${intents.length} intents — cap is ${INTENT_CATALOG_CAP}`,
      agentId,
      jobId,
    );
  }
  return { intents, intentPrompts };
}

/** Convenience: job-level catalog directory path. */
export function intentsDirPathFor(jobDir: string): string {
  return path.join(jobDir, INTENTS_DIR_NAME);
}

/**
 * Lenient parse for discovery (`CustomJobSummary.intents`) — returns the
 * validated catalog (full defs: the actions-tab detail needs hooks/clarify/
 * hasPrompt), or undefined when the catalog fails to parse. Fail-loud belongs
 * to load/validate; a broken catalog must not hide the job from the chip
 * list.
 */
export function tryReadJobIntentSummaries(
  jobDir: string,
  agentId: string,
  jobId: string,
): CustomIntentDef[] | undefined {
  try {
    return parseIntentsDir(jobDir, agentId, jobId).intents;
  } catch {
    return undefined;
  }
}
