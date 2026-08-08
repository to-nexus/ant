/**
 * Universal container resolution — the single seam that maps the constant
 * `UNIVERSAL_FEATURE` (`'universal'`) riding the `:feature` slot to the
 * on-disk container `{project}/universal` on universal-type projects.
 *
 * Layout (D6 — layout is invariant, project type is policy):
 *   {project}/universal/artifacts/                    user workspace files (codebasePath)
 *   {project}/universal/sessions/{agentId}/{jobId}.json  per-(agent, job) LLM session
 *   {project}/universal/sessions/chat.jsonl           one chat per workspace
 *   {project}/universal/sessions/feature.jsonl        prompt context SSOT
 */

import * as fs from 'fs';
import * as path from 'path';
import { UNIVERSAL_FEATURE } from '@ant/shared';

export const UNIVERSAL_DIRNAME = 'universal';
export const UNIVERSAL_ARTIFACTS_DIRNAME = 'artifacts';

/**
 * Canonical dirs inside `universal/artifacts/` — always present, never
 * deletable/renamable (delete = clear contents), mirroring the codespace
 * canonical dirs. `plan` matches the codespace feature dir name so plan
 * artifacts read the same across project kinds.
 */
export const UNIVERSAL_ARTIFACT_CANONICAL_DIRS = ['plan'] as const;

export function isUniversalProject(projectPath: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'config.json'), 'utf-8');
    return JSON.parse(raw)?.projectType === 'universal';
  } catch {
    return false;
  }
}

export function getUniversalContainerPathOf(projectPath: string): string {
  return path.join(projectPath, UNIVERSAL_DIRNAME);
}

/**
 * Returns the container path when `featureName` is the universal pseudo-feature
 * on a universal-type project; null otherwise (canonical projects fall through
 * to their normal feature path resolution).
 */
export function resolveUniversalContainerPath(projectPath: string, featureName: string): string | null {
  if (featureName !== UNIVERSAL_FEATURE) return null;
  if (!isUniversalProject(projectPath)) return null;
  return getUniversalContainerPathOf(projectPath);
}

/**
 * Materializes `{container}/artifacts` (+ its canonical dirs) and
 * `{container}/sessions`. Idempotent. Must run before any session/chat
 * write — FileSessionAdapter's ghost-guard silently drops appends when the
 * container directory does not exist.
 */
export function ensureUniversalContainer(projectPath: string): void {
  const container = getUniversalContainerPathOf(projectPath);
  for (const dir of UNIVERSAL_ARTIFACT_CANONICAL_DIRS) {
    fs.mkdirSync(path.join(container, UNIVERSAL_ARTIFACTS_DIRNAME, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(container, 'sessions'), { recursive: true });
}

export type ProjectJobGateResult =
  | { ok: true }
  | { ok: false; code: 'project-not-universal' | 'project-universal-requires-custom-job' };

/**
 * The single truth table for the bidirectional project-type × jobType gate:
 * universal projects run ONLY `jobType='universal'` (custom jobs); canonical
 * projects run everything EXCEPT it.
 */
export function decideProjectJobGate(
  projectType: 'canonical' | 'universal' | undefined,
  jobType: string,
): ProjectJobGateResult {
  const isUniversalJob = jobType === 'universal';
  const isUniversalType = projectType === 'universal';
  if (isUniversalJob && !isUniversalType) return { ok: false, code: 'project-not-universal' };
  if (!isUniversalJob && isUniversalType) return { ok: false, code: 'project-universal-requires-custom-job' };
  return { ok: true };
}
