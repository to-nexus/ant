/**
 * Design markdown doc integrity — shared single-owner helper.
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
 * refactor-mode append failure): the consuming code job would read two —
 * possibly contradictory — specs as one authoritative ref.
 *
 * Two modes, one owner:
 *
 * - generate: `healDuplicateSpecRoots` keeps the LAST root (the appended
 *   segment is by construction the newest complete revision). If the last
 *   segment is not a plausible full document (no `##` sections), the file is
 *   left untouched and flagged loudly.
 *
 * - refactor (`reconcileSpecDoc`): the revision-preservation gate. A
 *   revision run appends the candidate to the existing design doc
 *   (append_file on an existing target), so mid-task the file holds
 *   `original + candidate` — a free write-ahead log. At completion we
 *   validate the candidate against the pre-revision section headings:
 *   pass → candidate REPLACES the file (the "revision replaces atomically"
 *   contract lands here, at the validated moment); fail → the original is
 *   ROLLED BACK to disk and a retryable
 *   violation is returned so the phase node can re-prompt execute. Retry
 *   authority is declared here at the violation-creation site
 *   (`isRetryable`), never re-judged by phase nodes.
 *
 * Seam note (rev-sys adoption): `extractMarkdownHeadings`,
 * `evaluateRevisionPreservation` and `reconcileSpecDoc` are generic over
 * "markdown design doc with baseline headings" — system-design refactor
 * tasks reuse them via `isRevisableDesignDocTask` (spec ∪ system dirs).
 */
import path from 'node:path';
import { designDirOf } from '@ant/shared';

const SPEC_TARGET_DIR = 'architecture/spec';
const SYSTEM_TARGET_DIR = 'architecture/system';

/** True when the completed task writes a spec markdown under architecture/spec/. */
export function isSpecDocTask(task?: { targetDir?: string; targetFile?: string }): boolean {
  if (!task?.targetFile) return false;
  return (task.targetDir ?? designDirOf(task.targetFile)) === SPEC_TARGET_DIR;
}

/**
 * True for markdown design docs the refactor-mode revision gate covers:
 * spec (architecture/spec/) and system-design (architecture/system/) files.
 */
export function isRevisableDesignDocTask(task?: { targetDir?: string; targetFile?: string }): boolean {
  if (!task?.targetFile || !task.targetFile.endsWith('.md')) return false;
  const dir = task.targetDir ?? designDirOf(task.targetFile);
  return dir === SPEC_TARGET_DIR || dir === SYSTEM_TARGET_DIR;
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

/**
 * Fence-aware split of a (frontmatter-stripped) body into H1-rooted
 * segments. Any preamble before the first root stays attached to the first
 * segment. Zero roots → single segment containing the whole body.
 */
function splitRootSegments(body: string): { segments: string[]; rootCount: number } {
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

  if (rootLineIdx.length <= 1) return { segments: [body], rootCount: rootLineIdx.length };

  const segments: string[] = [];
  for (let s = 0; s < rootLineIdx.length; s++) {
    const start = s === 0 ? 0 : rootLineIdx[s];
    const end = s + 1 < rootLineIdx.length ? rootLineIdx[s + 1] : lines.length;
    segments.push(lines.slice(start, end).join('\n'));
  }
  return { segments, rootCount: rootLineIdx.length };
}

export interface MarkdownHeading {
  level: 1 | 2;
  text: string;
}

/**
 * Fence/frontmatter-aware `#` / `##` heading extraction. Single parser
 * shared by the decompose-time baseline capture and the completion-time
 * revision gate — the two must never disagree on what counts as a heading.
 */
export function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  const { body } = splitFrontmatter(content);
  const lines = body.split('\n');
  let inFence = false;
  const headings: MarkdownHeading[] = [];
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,2}) (.+)$/.exec(line);
    if (m) headings.push({ level: m[1].length as 1 | 2, text: m[2].trim() });
  }
  return headings;
}

export function healDuplicateSpecRoots(content: string): SpecIntegrityResult {
  const { frontmatter, body } = splitFrontmatter(content);
  const { segments, rootCount } = splitRootSegments(body);

  if (rootCount <= 1) return { action: 'none', rootCount };

  const lastSegment = segments[segments.length - 1];
  const isPlausibleFullDoc = /^## /m.test(lastSegment);
  if (!isPlausibleFullDoc) {
    return { action: 'flagged', rootCount };
  }

  return {
    action: 'healed',
    rootCount,
    healed: frontmatter + lastSegment.replace(/\s+$/, '') + '\n',
  };
}

// ─────────────────────────────────────────────────────────────
// Refactor mode — revision preservation gate
// ─────────────────────────────────────────────────────────────

export interface RevisionViolation {
  missingHeadings: string[];
  /** Retry authority SSOT — declared at the violation-creation site. */
  isRetryable: true;
}

export interface RevisionPreservationInput {
  /** `##` heading texts of the pre-revision document. */
  baselineHeadings: string[];
  /** Candidate full revised document. */
  candidate: string;
  /** Sealed plan JSON (may be unparseable — falls back to mention check). */
  planText?: string;
  /** User directive for the revision. */
  directive?: string;
}

export interface RevisionPreservationResult {
  ok: boolean;
  violation?: RevisionViolation;
}

/** Strip leading enumeration ("3. ", "2) ") and normalize for comparison. */
function normalizeHeading(text: string): string {
  return text
    .replace(/^\s*\d+[.)：:]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Directive-scoped ephemeral sections: their removal is always sanctioned —
 * they answer the PREVIOUS directive, so a revision that drops them is
 * correct by contract (see jobs/shared/injections/directive-qa.md).
 */
const EPHEMERAL_HEADINGS = new Set(['directive q&a']);

/**
 * Section names the sealed plan explicitly marked `disposition: "remove"`.
 * Tolerant of parse failure (returns []) — the mention fallback covers it.
 */
function extractSanctionedRemovals(planText?: string): string[] {
  if (!planText) return [];
  try {
    const parsed = JSON.parse(planText) as any;
    const outline = Array.isArray(parsed?.documentOutline) ? parsed.documentOutline : [];
    return outline
      .filter((e: any) => e && typeof e === 'object' && e.disposition === 'remove')
      .map((e: any) => String(e.section ?? ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * A missing baseline heading is a violation UNLESS its removal is
 * sanctioned: (a) a sealed-plan outline entry with `disposition: "remove"`
 * names it, or (b) the heading is mentioned in the directive / plan text
 * (permissive fallback — a legitimate removal must at least be talked about).
 */
export function evaluateRevisionPreservation(
  input: RevisionPreservationInput,
): RevisionPreservationResult {
  const { baselineHeadings, candidate, planText, directive } = input;
  if (baselineHeadings.length === 0) return { ok: true };

  const candidateSet = new Set(
    extractMarkdownHeadings(candidate)
      .filter((h) => h.level === 2)
      .map((h) => normalizeHeading(h.text)),
  );
  const sanctioned = extractSanctionedRemovals(planText).map(normalizeHeading);
  const mentionCorpus = `${directive ?? ''}\n${planText ?? ''}`.toLowerCase();

  const missingHeadings = baselineHeadings.filter((heading) => {
    const norm = normalizeHeading(heading);
    if (!norm) return false;
    if (EPHEMERAL_HEADINGS.has(norm)) return false;
    if (candidateSet.has(norm)) return false;
    if (sanctioned.some((s) => s === norm || s.includes(norm) || norm.includes(s))) return false;
    if (mentionCorpus.includes(norm)) return false;
    return true;
  });

  if (missingHeadings.length === 0) return { ok: true };
  return { ok: false, violation: { missingHeadings, isRetryable: true } };
}

export interface SpecReconcileOutcome {
  action: 'none' | 'healed' | 'flagged' | 'replaced' | 'rolled-back';
  violation?: RevisionViolation;
}

interface ReconcileFileSystem {
  readFile(p: string): Promise<string>;
  writeFile(p: string, c: string): Promise<void>;
}

/**
 * Completion-time reconcile for design markdown docs — the ONE entry both
 * completion nodes call. Never throws.
 *
 * - generate mode: duplicate-root heal, semantics unchanged (spec docs only).
 * - refactor mode: revision-preservation gate over spec + system docs.
 *   Candidate = last H1 segment (whole file when single-rooted). Baseline =
 *   first segment's `##` headings when the write-ahead append preserved the
 *   original in-file, else the decompose-captured `task.revisionBaselineHeadings`.
 *   Pass → candidate replaces the file. Fail → original rolled back + retryable
 *   violation returned (single-rooted file has no recoverable original —
 *   flagged loudly instead, no retry: the content to restore is gone).
 */
export async function reconcileSpecDoc(
  fileSystem: ReconcileFileSystem,
  featurePath: string,
  task: { targetDir?: string; targetFile?: string; revisionBaselineHeadings?: string[] },
  jobMode: string | undefined,
  opts: { planText?: string; directive?: string; logPrefix: string },
): Promise<SpecReconcileOutcome> {
  const isRefactor = jobMode === 'refactor';
  if (isRefactor ? !isRevisableDesignDocTask(task) : !isSpecDocTask(task)) {
    return { action: 'none' };
  }

  let filePath: string;
  let content: string;
  try {
    const dir = task.targetDir ?? designDirOf(task.targetFile!);
    filePath = path.join(featurePath, dir, task.targetFile!);
    content = await fileSystem.readFile(filePath);
  } catch {
    // File may not exist (task skipped) — nothing to reconcile.
    return { action: 'none' };
  }

  try {
    if (!isRefactor) {
      const result = healDuplicateSpecRoots(content);
      if (result.action === 'healed' && result.healed) {
        await fileSystem.writeFile(filePath, result.healed);
        console.warn(
          `🩹 [${opts.logPrefix}] Spec doc ${task.targetFile} had ${result.rootCount} document roots — kept newest full document`,
        );
        return { action: 'healed' };
      }
      if (result.action === 'flagged') {
        console.error(
          `❌ [${opts.logPrefix}] Spec doc ${task.targetFile} has ${result.rootCount} document roots but the last segment ` +
          `is not a full document (no sections) — left untouched. Manual review required before consumption.`,
        );
        return { action: 'flagged' };
      }
      return { action: 'none' };
    }

    // Refactor mode — revision preservation gate.
    const { frontmatter, body } = splitFrontmatter(content);
    const { segments, rootCount } = splitRootSegments(body);
    const candidate = segments[segments.length - 1];
    const original = rootCount > 1 ? segments[0] : undefined;
    const baselineHeadings = original
      ? extractMarkdownHeadings(original)
          .filter((h) => h.level === 2)
          .map((h) => h.text)
      : task.revisionBaselineHeadings ?? [];

    const evalResult = evaluateRevisionPreservation({
      baselineHeadings,
      candidate,
      planText: opts.planText,
      directive: opts.directive,
    });

    if (evalResult.ok) {
      if (rootCount > 1) {
        await fileSystem.writeFile(filePath, frontmatter + candidate.replace(/\s+$/, '') + '\n');
        console.log(
          `✅ [${opts.logPrefix}] Revision of ${task.targetFile} preserved all sections — candidate replaced the original`,
        );
        return { action: 'replaced' };
      }
      return { action: 'none' };
    }

    if (original) {
      await fileSystem.writeFile(filePath, frontmatter + original.replace(/\s+$/, '') + '\n');
      console.warn(
        `🩹 [${opts.logPrefix}] Revision of ${task.targetFile} dropped ${evalResult.violation!.missingHeadings.length} ` +
        `unsanctioned section(s) — original restored, revision will be retried`,
      );
      return { action: 'rolled-back', violation: evalResult.violation };
    }

    // Single root and no in-file original: the pre-revision content is
    // unrecoverable — retrying would only re-inject the narrow document as
    // "existing". Flag loudly for manual review instead.
    console.error(
      `❌ [${opts.logPrefix}] Revision of ${task.targetFile} dropped section(s) ` +
      `[${evalResult.violation!.missingHeadings.join(', ')}] but no pre-revision original is recoverable — ` +
      `left as-is. Manual review required.`,
    );
    return { action: 'flagged' };
  } catch {
    // Reconcile must never fail completion on the guard itself.
    return { action: 'none' };
  }
}

/**
 * Re-prompt appended to the execute conversation on a failed revision gate.
 * Shared so serial + worker phrasing never drifts (mirrors
 * `buildAssetRetryMessage`).
 */
export function buildSpecRevisionRetryMessage(
  missingHeadings: string[],
  targetFile: string,
): string {
  return [
    'REVISION VALIDATION FAILED.',
    `Your revised document dropped ${missingHeadings.length} section(s) that nothing sanctioned removing:`,
    ...missingHeadings.map((h) => `- ${h}`),
    `The document on disk (${targetFile}) has been restored to the pre-revision original.`,
    'Re-emit the FULL revised document in a single create_file call (overwrite: true): apply the directive as a delta, ' +
      'preserve every section the directive does not affect verbatim, and include the sections listed above.',
    'Only drop a section when the user directive sanctions its removal.',
  ].join('\n');
}
