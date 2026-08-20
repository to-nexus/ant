/**
 * Pipeline definition + run-history store. Disk is SSOT (account scope,
 * `atomicWriteFile`, no cache — the agent-definition discipline); Redis holds
 * only rebuildable projections owned by the coordinator.
 *
 * Failure shapes: `loadPipeline`/`savePipeline` throw
 * `PipelineValidationError` (loader precedent); HTTP callers catch → 400,
 * the FE form validates the same shared rule set → form-disable.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  PIPELINE_FILE_NAME,
  PIPELINE_ACTIVATION_FILE_NAME,
  validatePipelineDef,
  validatePipelineActivation,
  isApprovalStep,
  type PipelineActivation,
  type PipelineDef,
  type PipelineRunEvent,
  type PipelineRunSummary,
} from '@ant/shared';
import { atomicWriteFile } from '../utils/atomicWriteFile';
import { checkMinInterval } from './cron';
import {
  pipelineActivationPath,
  pipelineDefPath,
  pipelineDir,
  pipelineRunIndexPath,
  pipelineRunLogPath,
  pipelineRunsDir,
} from './paths';

export class PipelineValidationError extends Error {
  constructor(message: string, public readonly pipelineId?: string) {
    super(message);
    this.name = 'PipelineValidationError';
  }
}

export interface PipelineListItem {
  id: string;
  def?: PipelineDef;
  /** Present instead of `def` when the YAML is unreadable/invalid — the list never hides a broken entry. */
  error?: string;
}

/**
 * Every rule a saved definition must satisfy: shared structural rules, the
 * server-side cron minimum-interval cap, and the gate-anchor rule (an
 * approval step needs an upstream step — its chat card anchors to the
 * producing job's turn, and a rootless gate has none).
 */
export function validatePipelineDefServer(raw: unknown): string[] {
  const errors = validatePipelineDef(raw);
  if (errors.length > 0) return errors;
  const def = raw as PipelineDef;
  const intervalError = checkMinInterval(def.on.schedule.cron, def.on.schedule.tz);
  if (intervalError) errors.push(`on.schedule.cron: ${intervalError}`);
  def.steps.forEach((step, index) => {
    if (!isApprovalStep(step)) return;
    const effectiveNeeds = step.needs ?? (index > 0 ? [def.steps[index - 1].id] : []);
    if (effectiveNeeds.length === 0) {
      errors.push(`step "${step.id}": an approval gate needs an upstream step (it cannot be the entry step)`);
    }
  });
  return errors;
}

export function listPipelines(root: string): PipelineListItem[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: PipelineListItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      items.push({ id: entry.name, def: loadPipeline(root, entry.name) });
    } catch (e) {
      items.push({ id: entry.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

export function pipelineExists(root: string, pipelineId: string): boolean {
  return fs.existsSync(pipelineDefPath(root, pipelineId));
}

export function loadPipeline(root: string, pipelineId: string): PipelineDef {
  const defPath = pipelineDefPath(root, pipelineId);
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(defPath, 'utf-8'));
  } catch (e) {
    throw new PipelineValidationError(
      `Cannot read ${PIPELINE_FILE_NAME}: ${e instanceof Error ? e.message : String(e)}`,
      pipelineId,
    );
  }
  const errors = validatePipelineDefServer(raw);
  if (errors.length > 0) {
    throw new PipelineValidationError(errors[0], pipelineId);
  }
  return raw as PipelineDef;
}

export async function savePipeline(root: string, pipelineId: string, def: PipelineDef): Promise<void> {
  const errors = validatePipelineDefServer(def);
  if (errors.length > 0) {
    throw new PipelineValidationError(errors[0], pipelineId);
  }
  fs.mkdirSync(pipelineDir(root, pipelineId), { recursive: true });
  await atomicWriteFile(pipelineDefPath(root, pipelineId), yaml.dump(def, { lineWidth: 120 }));
}

export function deletePipeline(root: string, pipelineId: string): void {
  fs.rmSync(pipelineDir(root, pipelineId), { recursive: true, force: true });
}

// ============================================
// Activation (activation.json — disk SSOT; absence = deactivated)
// ============================================

/** Missing file → null. Unreadable/invalid file → throw (never silently deactivate). */
export function loadActivation(root: string, pipelineId: string): PipelineActivation | null {
  const activationPath = pipelineActivationPath(root, pipelineId);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(activationPath, 'utf-8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PipelineValidationError(
      `Cannot read ${PIPELINE_ACTIVATION_FILE_NAME}: ${e instanceof Error ? e.message : String(e)}`,
      pipelineId,
    );
  }
  const errors = validatePipelineActivation(raw);
  if (errors.length > 0) {
    throw new PipelineValidationError(errors[0], pipelineId);
  }
  return raw as PipelineActivation;
}

export async function saveActivation(
  root: string,
  pipelineId: string,
  activation: PipelineActivation,
): Promise<void> {
  const errors = validatePipelineActivation(activation);
  if (errors.length > 0) {
    throw new PipelineValidationError(errors[0], pipelineId);
  }
  fs.mkdirSync(pipelineDir(root, pipelineId), { recursive: true });
  await atomicWriteFile(pipelineActivationPath(root, pipelineId), `${JSON.stringify(activation, null, 2)}\n`);
}

export function deleteActivation(root: string, pipelineId: string): void {
  fs.rmSync(pipelineActivationPath(root, pipelineId), { force: true });
}

/** Every activated pipeline under the account root. Invalid sidecars are skipped (reconciler logs them). */
export function listActivations(root: string): Array<{ pipelineId: string; activation: PipelineActivation }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ pipelineId: string; activation: PipelineActivation }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const activation = loadActivation(root, entry.name);
      if (activation) out.push({ pipelineId: entry.name, activation });
    } catch {
      // Invalid sidecar: not activated for scheduling purposes; surfaced by the reconciler's log.
    }
  }
  return out.sort((a, b) => a.pipelineId.localeCompare(b.pipelineId));
}

export function findActivationByProject(
  root: string,
  projectId: string,
): { pipelineId: string; activation: PipelineActivation } | null {
  return listActivations(root).find((item) => item.activation.projectId === projectId) ?? null;
}

// ============================================
// Run history (append-only JSONL; the coordinator is the single writer)
// ============================================

export async function appendRunEvent(
  root: string,
  pipelineId: string,
  event: PipelineRunEvent,
): Promise<void> {
  const logPath = pipelineRunLogPath(root, pipelineId, event.runId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  await fs.promises.appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf-8');
}

export async function appendRunIndex(
  root: string,
  pipelineId: string,
  entry: PipelineRunSummary,
): Promise<void> {
  const indexPath = pipelineRunIndexPath(root, pipelineId);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  await fs.promises.appendFile(indexPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

export function readRunEvents(root: string, pipelineId: string, runId: string): PipelineRunEvent[] {
  return readJsonlSafe<PipelineRunEvent>(pipelineRunLogPath(root, pipelineId, runId));
}

/** Most-recent-first. `limit` bounds the tail read (index lines are terminal runs only). */
export function readRunIndex(root: string, pipelineId: string, limit = 50): PipelineRunSummary[] {
  const entries = readJsonlSafe<PipelineRunSummary>(pipelineRunIndexPath(root, pipelineId));
  return entries.slice(-limit).reverse();
}

export function hasRunLog(root: string, pipelineId: string, runId: string): boolean {
  return fs.existsSync(pipelineRunLogPath(root, pipelineId, runId));
}

export function listRunLogIds(root: string, pipelineId: string): string[] {
  try {
    return fs
      .readdirSync(pipelineRunsDir(root, pipelineId))
      .filter((f) => f.endsWith('.jsonl') && f !== 'index.jsonl')
      .map((f) => f.slice(0, -'.jsonl'.length));
  } catch {
    return [];
  }
}

function readJsonlSafe<T>(filePath: string): T[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // A torn tail line (crash mid-append) is expected; skip, never throw.
    }
  }
  return out;
}
