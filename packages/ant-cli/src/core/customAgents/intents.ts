/**
 * Intent catalog — parsing and validation for `jobs/{jobId}/intents.yaml`.
 *
 * The catalog is CODE-EXTERIOR DATA (D-F) and JOB-ONLY (mirroring canonical,
 * where intents belong to jobs): it is loaded fresh at every job accept, and
 * its ids are a per-job runtime string vocabulary — they never join the
 * compile-time canonical `IntentId` union and never key any code-resident
 * matrix.
 *
 * Shared by the loader (`loadCustomJob`) and the settings API's save
 * validation (single validation SSOT — a file the PUT funnel accepts is a
 * file the runtime will load).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { GENERAL_INTENT, INTENTS_FILE_NAME, type CustomIntentDef } from '@ant/shared';
import { CustomAgentValidationError } from './types.js';

/** Catalog size cap — keeps the classify prompt table bounded. */
export const INTENT_CATALOG_CAP = 32;

const INTENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DESCRIPTION_MAX = 200;

/**
 * Parse + validate one `intents.yaml`. Returns `[]` when the file does not
 * exist or contains no entries (comments-only scaffold). Throws
 * `CustomAgentValidationError` on any structural violation (fail-loud, same
 * contract as the rest of the loader).
 */
export function parseIntentsYaml(filePath: string, agentId: string, jobId?: string): CustomIntentDef[] {
  if (!fs.existsSync(filePath)) return [];

  let doc: unknown;
  try {
    doc = yaml.load(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    throw new CustomAgentValidationError(
      `Invalid YAML in ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
      agentId,
      jobId,
    );
  }
  return validateIntentsDoc(doc, agentId, jobId);
}

/**
 * Validate an already-parsed `intents.yaml` document. Split out from
 * `parseIntentsYaml` so the settings PUT funnel can gate content PRE-WRITE
 * with the identical rules the loader applies at job accept.
 */
export function validateIntentsDoc(doc: unknown, agentId: string, jobId?: string): CustomIntentDef[] {
  if (doc == null) return [];
  if (typeof doc !== 'object') {
    throw new CustomAgentValidationError(`${INTENTS_FILE_NAME} must be a mapping`, agentId, jobId);
  }
  const rawIntents = (doc as { intents?: unknown }).intents;
  if (rawIntents == null) return [];
  if (!Array.isArray(rawIntents)) {
    throw new CustomAgentValidationError(`${INTENTS_FILE_NAME}: "intents" must be a list`, agentId, jobId);
  }

  const seen = new Set<string>();
  const result: CustomIntentDef[] = [];
  for (const entry of rawIntents) {
    if (!entry || typeof entry !== 'object') {
      throw new CustomAgentValidationError(`${INTENTS_FILE_NAME}: each intent must be a mapping`, agentId, jobId);
    }
    const { id, description, injections } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !INTENT_ID_PATTERN.test(id)) {
      throw new CustomAgentValidationError(
        `${INTENTS_FILE_NAME}: intent id must match [a-z0-9][a-z0-9-]* (got: ${String(id)})`,
        agentId,
        jobId,
      );
    }
    if (id === GENERAL_INTENT) {
      throw new CustomAgentValidationError(
        `${INTENTS_FILE_NAME}: "${GENERAL_INTENT}" is the implicit fallback intent and cannot be declared`,
        agentId,
        jobId,
      );
    }
    if (seen.has(id)) {
      throw new CustomAgentValidationError(`${INTENTS_FILE_NAME}: duplicate intent id "${id}"`, agentId, jobId);
    }
    seen.add(id);
    if (typeof description !== 'string' || description.trim().length === 0) {
      throw new CustomAgentValidationError(
        `${INTENTS_FILE_NAME}: intent "${id}" requires a non-empty description (it IS the matching criterion)`,
        agentId,
        jobId,
      );
    }
    if (description.length > DESCRIPTION_MAX) {
      throw new CustomAgentValidationError(
        `${INTENTS_FILE_NAME}: intent "${id}" description exceeds ${DESCRIPTION_MAX} chars`,
        agentId,
        jobId,
      );
    }
    let injectionList: string[] | undefined;
    if (injections != null) {
      if (!Array.isArray(injections) || injections.some((f) => typeof f !== 'string')) {
        throw new CustomAgentValidationError(
          `${INTENTS_FILE_NAME}: intent "${id}" injections must be a list of file names`,
          agentId,
          jobId,
        );
      }
      for (const f of injections as string[]) {
        if (f.includes('/') || f.includes('\\')) {
          throw new CustomAgentValidationError(
            `${INTENTS_FILE_NAME}: intent "${id}" injection "${f}" must be a bare file name (no path separators)`,
            agentId,
            jobId,
          );
        }
        if (!f.endsWith('.md')) {
          throw new CustomAgentValidationError(
            `${INTENTS_FILE_NAME}: intent "${id}" injection "${f}" must be a .md file`,
            agentId,
            jobId,
          );
        }
      }
      injectionList = [...(injections as string[])];
    }
    result.push({ id, description: description.trim(), ...(injectionList ? { injections: injectionList } : {}) });
  }
  if (result.length > INTENT_CATALOG_CAP) {
    throw new CustomAgentValidationError(
      `${INTENTS_FILE_NAME}: catalog has ${result.length} intents — cap is ${INTENT_CATALOG_CAP}`,
      agentId,
      jobId,
    );
  }
  return result;
}

/**
 * Injection-reference check: every intent must only reference files that
 * exist in the job's `injections/` set — a dangling reference would silently
 * inline nothing at classify time.
 */
export function validateIntentInjectionRefs(
  intents: CustomIntentDef[],
  visibleFiles: ReadonlySet<string>,
  levelLabel: string,
  agentId: string,
  jobId?: string,
): void {
  for (const intent of intents) {
    for (const f of intent.injections ?? []) {
      if (!visibleFiles.has(f)) {
        throw new CustomAgentValidationError(
          `${INTENTS_FILE_NAME}: intent "${intent.id}" references injection "${f}" which does not exist in the ${levelLabel} injections set`,
          agentId,
          jobId,
        );
      }
    }
  }
}

/** Convenience: job-level catalog file path. */
export function intentsFilePathFor(dir: string): string {
  return path.join(dir, INTENTS_FILE_NAME);
}

/**
 * Lenient parse for discovery (`CustomJobSummary.intents`) — returns the
 * job catalog's id/description rows, or undefined when the file fails to
 * parse. Fail-loud belongs to load/validate; a broken catalog must not hide
 * the job from the chip list.
 */
export function tryReadJobIntentSummaries(
  jobDir: string,
  agentId: string,
  jobId: string,
): Pick<CustomIntentDef, 'id' | 'description'>[] | undefined {
  try {
    return parseIntentsYaml(intentsFilePathFor(jobDir), agentId, jobId).map(({ id, description }) => ({
      id,
      description,
    }));
  } catch {
    return undefined;
  }
}
