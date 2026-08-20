/**
 * Pipeline definition + availability + activation + run-history store. Disk is
 * SSOT (`atomicWriteFile`, no cache — the agent-definition discipline); Redis
 * holds only rebuildable projections owned by the coordinator.
 *
 * Two disjoint trees (see `paths.ts`): definitions under scope roots,
 * activations (+ their runs) under the activator's account keyed by projectId.
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
  PIPELINE_AVAILABILITY_FILE_NAME,
  validatePipelineDef,
  validatePipelineActivation,
  validatePipelineAvailability,
  isApprovalStep,
  type PipelineActivation,
  type PipelineAvailability,
  type PipelineDef,
  type PipelineRunEvent,
  type PipelineRunSummary,
} from '@ant/shared';
import { atomicWriteFile } from '../utils/atomicWriteFile';
import { checkMinInterval } from './cron';
import {
  activationDir,
  activationFilePath,
  activationRunIndexPath,
  activationRunLogPath,
  activationRunsDir,
  pipelineAvailabilityPath,
  pipelineDefPath,
  pipelineDir,
  PIPELINE_ACTIVATIONS_DIRNAME,
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
// Availability (availability.json — missing file = disabled/draft)
// ============================================

/** Missing file → disabled (draft default). Unreadable/invalid → throw (never silently enable). */
export function loadAvailability(root: string, pipelineId: string): PipelineAvailability {
  const availabilityPath = pipelineAvailabilityPath(root, pipelineId);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(availabilityPath, 'utf-8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { enabled: false, changedAt: new Date(0).toISOString() };
    }
    throw new PipelineValidationError(
      `Cannot read ${PIPELINE_AVAILABILITY_FILE_NAME}: ${e instanceof Error ? e.message : String(e)}`,
      pipelineId,
    );
  }
  const errors = validatePipelineAvailability(raw);
  if (errors.length > 0) {
    throw new PipelineValidationError(errors[0], pipelineId);
  }
  return raw as PipelineAvailability;
}

export async function saveAvailability(
  root: string,
  pipelineId: string,
  record: PipelineAvailability,
): Promise<void> {
  const errors = validatePipelineAvailability(record);
  if (errors.length > 0) {
    throw new PipelineValidationError(errors[0], pipelineId);
  }
  fs.mkdirSync(pipelineDir(root, pipelineId), { recursive: true });
  await atomicWriteFile(pipelineAvailabilityPath(root, pipelineId), `${JSON.stringify(record, null, 2)}\n`);
}

// ============================================
// Activation (activation.json — disk SSOT; absence = deactivated)
// ============================================

/** Missing file → null. Unreadable/invalid file → throw (never silently deactivate). */
export function loadActivationByProject(actRoot: string, projectId: string): PipelineActivation | null {
  const activationPath = activationFilePath(actRoot, projectId);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(activationPath, 'utf-8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PipelineValidationError(
      `Cannot read ${PIPELINE_ACTIVATION_FILE_NAME}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const errors = validatePipelineActivation(raw);
  if (errors.length > 0) {
    throw new PipelineValidationError(errors[0]);
  }
  return raw as PipelineActivation;
}

export async function saveActivationRecord(actRoot: string, activation: PipelineActivation): Promise<void> {
  const errors = validatePipelineActivation(activation);
  if (errors.length > 0) {
    throw new PipelineValidationError(errors[0], activation.pipelineId);
  }
  fs.mkdirSync(activationDir(actRoot, activation.projectId), { recursive: true });
  await atomicWriteFile(
    activationFilePath(actRoot, activation.projectId),
    `${JSON.stringify(activation, null, 2)}\n`,
  );
}

/** Removes activation.json ONLY — run history survives deactivation. */
export function deleteActivationRecord(actRoot: string, projectId: string): void {
  fs.rmSync(activationFilePath(actRoot, projectId), { force: true });
}

/** Every activation under one account root. Invalid sidecars are skipped (reconciler logs them). */
export function listAccountActivations(actRoot: string): PipelineActivation[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(actRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: PipelineActivation[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const activation = loadActivationByProject(actRoot, entry.name);
      if (activation) out.push(activation);
    } catch {
      // Invalid sidecar: not activated for scheduling purposes; surfaced by the reconciler's log.
    }
  }
  return out.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

/**
 * All activations of one pipeline across an org's members — the disk leg of
 * "who holds this pipeline" (disable gate, org-visible activation list).
 * Bounded: one readdir per member. Owner kind is derived from the org id the
 * activation is anchored under (same mapping as the reconciler's path
 * inference).
 */
export function findActivationsForPipeline(
  workspacesPath: string,
  organizationId: string,
  pipelineId: string,
): Array<{ userId: string; activation: PipelineActivation }> {
  const orgDir = path.join(workspacesPath, organizationId);
  let users: fs.Dirent[];
  try {
    users = fs.readdirSync(orgDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ userId: string; activation: PipelineActivation }> = [];
  for (const user of users) {
    if (!user.isDirectory() || user.name.startsWith('.')) continue;
    const actRoot = path.join(orgDir, user.name, PIPELINE_ACTIVATIONS_DIRNAME);
    for (const activation of listAccountActivations(actRoot)) {
      if (activation.pipelineId === pipelineId) out.push({ userId: user.name, activation });
    }
  }
  return out;
}

// ============================================
// Run history (append-only JSONL; the coordinator is the single writer)
// ============================================

export async function appendRunEvent(actRoot: string, projectId: string, event: PipelineRunEvent): Promise<void> {
  const logPath = activationRunLogPath(actRoot, projectId, event.runId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  await fs.promises.appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf-8');
}

export async function appendRunIndex(actRoot: string, projectId: string, entry: PipelineRunSummary): Promise<void> {
  const indexPath = activationRunIndexPath(actRoot, projectId);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  await fs.promises.appendFile(indexPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

export function readRunEvents(actRoot: string, projectId: string, runId: string): PipelineRunEvent[] {
  return readJsonlSafe<PipelineRunEvent>(activationRunLogPath(actRoot, projectId, runId));
}

/**
 * Most-recent-first. `limit` bounds the tail read (index lines are terminal
 * runs only). `pipelineId` filters to one pipeline's runs — a project's run
 * index interleaves every pipeline it ever hosted.
 */
export function readRunIndex(
  actRoot: string,
  projectId: string,
  limit = 50,
  pipelineId?: string,
): PipelineRunSummary[] {
  let entries = readJsonlSafe<PipelineRunSummary>(activationRunIndexPath(actRoot, projectId));
  if (pipelineId) entries = entries.filter((e) => e.pipelineId === pipelineId);
  return entries.slice(-limit).reverse();
}

export function hasRunLog(actRoot: string, projectId: string, runId: string): boolean {
  return fs.existsSync(activationRunLogPath(actRoot, projectId, runId));
}

export function listRunLogIds(actRoot: string, projectId: string): string[] {
  try {
    return fs
      .readdirSync(activationRunsDir(actRoot, projectId))
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
