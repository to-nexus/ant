/**
 * Spec document integrity — shared single-owner helper.
 *
 * Both design completion nodes call this ONE helper (same ownership pattern
 * as `assetValidation.ts`):
 *   - serial   `design/graph.ts::checkTaskStatus`
 *   - parallel `design/parallel/workerGraph.ts::workerCheckTaskStatus`
 *
 * Invariant: a spec markdown has EXACTLY ONE `# ` H1 root outside fenced
 * blocks / YAML frontmatter. Legitimate multi-section authoring appends only
 * `##`-level sections, so the invariant holds for every well-formed spec.
 * A second root means a full document was appended below the first (the
 * refactor-mode `<append>` failure): the consuming code job would read two —
 * possibly contradictory — specs as one authoritative ref.
 *
 * Heal keeps the LAST root: refactor mode's contract is "output the FULL
 * modified document", so the appended segment is by construction the newest
 * complete revision. If the last segment is not a plausible full document
 * (no `##` sections), the file is left untouched and flagged loudly.
 */
import path from 'node:path';
import { designDirOf } from '@ant/shared';

const SPEC_TARGET_DIR = 'architecture/spec';

/** True when the completed task writes a spec markdown under architecture/spec/. */
export function isSpecDocTask(task?: { targetDir?: string; targetFile?: string }): boolean {
  if (!task?.targetFile) return false;
  return (task.targetDir ?? designDirOf(task.targetFile)) === SPEC_TARGET_DIR;
}

export interface SpecIntegrityResult {
  action: 'none' | 'healed' | 'flagged';
  /** H1 roots found outside fences/frontmatter. */
  rootCount: number;
  /** Present when action === 'healed' — the content to write back. */
  healed?: string;
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return { frontmatter: '', body: content };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      const fmEnd = i + 1;
      return {
        frontmatter: lines.slice(0, fmEnd).join('\n') + '\n',
        body: lines.slice(fmEnd).join('\n'),
      };
    }
  }
  return { frontmatter: '', body: content };
}

export function healDuplicateSpecRoots(content: string): SpecIntegrityResult {
  const { frontmatter, body } = splitFrontmatter(content);
  const lines = body.split('\n');

  let inFence = false;
  const rootLineIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^# /.test(lines[i])) rootLineIdx.push(i);
  }

  if (rootLineIdx.length <= 1) return { action: 'none', rootCount: rootLineIdx.length };

  const lastSegment = lines.slice(rootLineIdx[rootLineIdx.length - 1]).join('\n');
  const isPlausibleFullDoc = /^## /m.test(lastSegment);
  if (!isPlausibleFullDoc) {
    return { action: 'flagged', rootCount: rootLineIdx.length };
  }

  return {
    action: 'healed',
    rootCount: rootLineIdx.length,
    healed: frontmatter + lastSegment.replace(/\s+$/, '') + '\n',
  };
}

/**
 * Read → check invariant → heal (or flag) the completed spec task's output.
 * Never throws — completion must not fail on the guard itself.
 */
export async function enforceSpecDocIntegrity(
  fileSystem: { readFile(p: string): Promise<string>; writeFile(p: string, c: string): Promise<void> },
  featurePath: string,
  task: { targetDir?: string; targetFile?: string },
  logPrefix: string,
): Promise<void> {
  if (!isSpecDocTask(task)) return;
  try {
    const dir = task.targetDir ?? designDirOf(task.targetFile!);
    const filePath = path.join(featurePath, dir, task.targetFile!);
    const content = await fileSystem.readFile(filePath);
    const result = healDuplicateSpecRoots(content);
    if (result.action === 'healed' && result.healed) {
      await fileSystem.writeFile(filePath, result.healed);
      console.warn(
        `🩹 [${logPrefix}] Spec doc ${task.targetFile} had ${result.rootCount} document roots — kept newest full document`,
      );
    } else if (result.action === 'flagged') {
      console.error(
        `❌ [${logPrefix}] Spec doc ${task.targetFile} has ${result.rootCount} document roots but the last segment ` +
        `is not a full document (no sections) — left untouched. Manual review required before consumption.`,
      );
    }
  } catch {
    // File may not exist (task skipped) — nothing to enforce.
  }
}
