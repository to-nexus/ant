/**
 * Asset-reference validation — shared single-owner helper (WS2 §1b/§1c/§1d).
 *
 * Both design completion nodes call this ONE helper:
 *   - serial   `design/graph.ts::checkTaskStatus`
 *   - parallel `design/parallel/workerGraph.ts::workerCheckTaskStatus`
 *
 * Before this extraction the asset gate lived inline in the serial node only,
 * so under the default `ANT_TASK_CONCURRENCY > 1` (game-art decompose is always
 * `parallelGroup`) the gate silently never ran — dangling `kind:external` srcs
 * and over-complex inline payloads shipped unchecked. Keeping the logic here
 * and calling it from both nodes closes that hole with a single owner.
 *
 * Two surfaces, two rule sets:
 *   - `ui-assets.json`      — external-only; every `src` must exist on disk.
 *   - `game-art-assets.json`— D20/D21/I6 via `validateGameArtAssetCatalog`:
 *       external srcs must exist under `assets/game/...`, inline payloads must
 *       stay under the css-only ceiling. An I6 cross-surface leak throws inside
 *       the catalog validator; here we catch it and fold it into a retry issue
 *       so a long-running parallel worker re-prompts instead of crashing.
 */
import path from 'node:path';
import fsSync from 'node:fs';
import {
  validateGameArtAssetCatalog,
  type GameArtAssetEntry,
} from '../../../../../../infrastructure/workspace/gameArtAssetValidator';

export interface AssetValidationResult {
  valid: boolean;
  /** External srcs that are missing / illegal (surfaced as "download or fix"). */
  missingFiles: string[];
  /** Total external refs considered (for the "N/M" progress message). */
  totalRefs: number;
  /** game-art only: inline entries that exceed the D21 css-only ceiling. */
  inlineViolations: Array<{ id: string; reason: string }>;
}

/** True for the two asset-catalog task ids the gate applies to. */
export function isAssetTask(taskId: string | undefined): boolean {
  return !!taskId && (taskId.startsWith('ui-assets-') || taskId.startsWith('game-art-assets-'));
}

/** Recursively collect every `src` string (UI surface — no inline kind). */
function extractAllSrcFields(obj: any): string[] {
  const srcs: string[] = [];
  if (!obj || typeof obj !== 'object') return srcs;
  if (Array.isArray(obj)) {
    for (const item of obj) srcs.push(...extractAllSrcFields(item));
  } else {
    if (typeof obj.src === 'string') srcs.push(obj.src);
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') srcs.push(...extractAllSrcFields(obj[key]));
    }
  }
  return srcs;
}

/** Flatten a `game-art-assets.json` category dictionary into a flat entry list. */
function extractGameArtEntries(parsed: any): GameArtAssetEntry[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const entries: GameArtAssetEntry[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '_meta') continue;
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry && typeof entry === 'object') entries.push(entry as GameArtAssetEntry);
    }
  }
  return entries;
}

/**
 * Validate the asset doc the active task targets. Pure w.r.t. state — takes the
 * feature path + task id so both the serial and worker nodes call it identically.
 */
export async function validateAssetReferences(
  featurePath: string,
  taskId: string,
): Promise<AssetValidationResult> {
  const empty: AssetValidationResult = { valid: true, missingFiles: [], totalRefs: 0, inlineViolations: [] };

  const isGameArt = taskId.startsWith('game-art-assets-');
  const isUi = taskId.startsWith('ui-assets-');
  if (!isGameArt && !isUi) return empty;

  const assetPath = isGameArt
    ? path.join(featurePath, 'visual', 'game-art', 'ant', 'game-art-assets.json')
    : path.join(featurePath, 'visual', 'ui', 'ant', 'ui-assets.json');

  let parsed: any;
  try {
    const content = await (await import('fs/promises')).readFile(assetPath, 'utf-8');
    parsed = JSON.parse(content);
  } catch {
    // Doc not written yet (task skipped) or unparseable — nothing to validate.
    return empty;
  }

  const srcExists = (rel: string): boolean => {
    try { return fsSync.existsSync(path.join(featurePath, rel)); } catch { return false; }
  };

  if (isUi) {
    const srcPaths = extractAllSrcFields(parsed);
    const missing = srcPaths.filter(src => !srcExists(src));
    return { valid: missing.length === 0, missingFiles: missing, totalRefs: srcPaths.length, inlineViolations: [] };
  }

  // game-art — D20/D21/I6 via the production validator (WS2 §1b).
  const entries = extractGameArtEntries(parsed);
  const externalCount = entries.filter(e => e && e.kind === 'external').length;
  let issues;
  try {
    issues = validateGameArtAssetCatalog(entries, { srcExists });
  } catch (e) {
    // I6 cross-surface leak throws — fold into a retry issue (no crash).
    return {
      valid: false,
      missingFiles: [],
      totalRefs: externalCount,
      inlineViolations: [{ id: '(catalog)', reason: (e as Error).message }],
    };
  }

  const missingFiles = issues
    .filter(i => i.code === 'external-src-missing' || i.code === 'external-outside-game-pool' || i.code === 'external-missing-src')
    .map(i => i.src ?? i.id);
  const inlineViolations = issues
    .filter(i => i.code === 'inline-svg-too-complex' || i.code === 'inline-css-too-long' || i.code === 'inline-oscillator-too-long')
    .map(i => ({ id: i.id, reason: i.reason }));

  return {
    valid: issues.length === 0,
    missingFiles,
    totalRefs: externalCount,
    inlineViolations,
  };
}

/**
 * Build the re-prompt appended to the execute conversation on a failed gate.
 * Shared so serial + worker phrasing never drifts. Covers both the missing /
 * illegal external srcs (WS2 §1b) and the over-complex inline payloads that
 * must be promoted to `kind:external` (WS2 §1c).
 */
export function buildAssetRetryMessage(result: AssetValidationResult, taskId: string): string {
  const isGameArt = taskId.startsWith('game-art-assets-');
  const docLabel = isGameArt ? 'game-art-assets.json (kind:external entries)' : 'ui-assets.json';

  const parts: string[] = ['VALIDATION FAILED.'];

  if (result.missingFiles.length > 0) {
    parts.push(
      `${result.missingFiles.length} asset(s) referenced in ${docLabel} are missing or point outside assets/game/:`,
      ...result.missingFiles.map(f => `- ${f}`),
      'Either place the file at the recorded path (kind:external must point at an existing file under assets/game/...) '
        + 'or convert the entry to kind:inline with simple-shape SVG/CSS/oscillator data.',
    );
  }

  if (result.inlineViolations.length > 0) {
    parts.push(
      `${result.inlineViolations.length} inline entr(y/ies) exceed the css-only ceiling (D21):`,
      ...result.inlineViolations.map(v => `- ${v.id}: ${v.reason}`),
      'Promote each over-complex inline entry to kind:external with a src under assets/game/<category>/ (user places the production file), '
        + 'or simplify the inline payload back under the ceiling.',
    );
  }

  return parts.join('\n');
}
