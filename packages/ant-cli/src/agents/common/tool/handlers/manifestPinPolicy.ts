/**
 * manifestPinPolicy — workspace-wide dependency-pin policy guard.
 *
 * Sibling of `invalidationScope.ts` and `workspaceDepPins.ts`. Centralises
 * the "would this write/install introduce a conflicting library version?"
 * decision so three call sites — `editFile`, `createFile`, `runCommand` —
 * each reduce to a single helper call. DRY: without this module, the
 * snapshot scan + violation detection + display rendering would duplicate
 * across all three handlers.
 *
 * Returns `null` when the operation is allowed; returns a
 * `PinPolicyRejection` when the call site should hand the operation to
 * the existing `makeRejection` pattern (5th use-site of that mechanism,
 * matching write-path violations / interactive commands / orchestrator
 * port / bare-install skip).
 *
 * Pure module-level helper — no LangGraph state, no `ToolExecutionContext`
 * imports. The call site owns the rejection plumbing.
 */

import { isDepManifestPath } from './invalidationScope';
import {
  scanWorkspaceDepPins,
  detectPinViolations,
  detectInstallPinViolations,
  extractInstallVersionTargets,
  type PinWriteViolation,
  type PinInstallViolation,
} from './workspaceDepPins';
import { splitOnShellOperators, tokenizeShellSegment } from '../../../../core/utils/shellParser';

export interface PinPolicyRejection {
  /**
   * Human-readable rejection body (the call site prepends `[Policy]`
   * via `makeRejection`). Multi-line, deterministic, lists every
   * conflicting library so the LLM has a clear menu of fixes.
   */
  display: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Write-path enforcement (editFile / createFile)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Enforce the workspace pin policy for a manifest write. Fast-path:
 * non-manifest paths return null immediately, no scan performed.
 *
 * For `package.json` writes the new content is parsed and compared
 * against the workspace snapshot; the manifest itself is excluded from
 * its own conflict check (re-saving with the same spec stays a no-op).
 *
 * Currently active for `package.json` only; other manifest kinds (Cargo,
 * pyproject, go.mod) flow through the `null` return because the
 * scanner's dispatch table has no row for them yet. Adding a row in
 * `workspaceDepPins.ts` automatically activates the policy here without
 * any change at this level.
 */
export async function enforceManifestPinPolicyForWrite(
  targetPath: string,
  newContent: string,
  featureRootPath: string,
  manifestRelPath: string,
): Promise<PinPolicyRejection | null> {
  if (!isDepManifestPath(targetPath)) return null;
  if (!targetPath.toLowerCase().endsWith('package.json')) return null;

  const newDeps = parsePackageJsonDeps(newContent);
  if (!newDeps) return null;
  if (Object.keys(newDeps).length === 0) return null;

  const snap = await scanWorkspaceDepPins(featureRootPath);
  if (snap.pins.size === 0) return null;

  const violations = detectPinViolations(manifestRelPath, newDeps, snap);
  if (violations.length === 0) return null;

  return { display: renderWriteRejection(manifestRelPath, violations) };
}

function parsePackageJsonDeps(content: string): Record<string, string> | null {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
  } catch {
    return null;
  }
}

function renderWriteRejection(
  manifestRelPath: string,
  violations: PinWriteViolation[],
): string {
  const lines: string[] = [];
  lines.push(`❌ DEPENDENCY VERSION CONFLICT in ${manifestRelPath}`);
  lines.push('');
  lines.push('The following libraries are already pinned elsewhere in this workspace:');
  for (const v of violations) {
    lines.push(`  - ${v.name}: pinned to ${v.pinnedSpec} in ${v.pinnedIn.join(', ')}`);
  }
  lines.push('');
  lines.push('You declared:');
  for (const v of violations) {
    lines.push(`  - ${v.name}: ${v.declaredHere}`);
  }
  lines.push('');
  lines.push('Reuse the pinned spec verbatim, or remove this dependency from the manifest if the workspace pin is wrong.');
  lines.push('Do NOT pick a different version. Do NOT upgrade. Do NOT "normalize".');
  return lines.join('\n');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Install-path enforcement (runCommand)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Enforce the workspace pin policy for an install command. Reuses
 * `extractInstallVersionTargets` (shellParser-driven) so no new regex
 * is introduced at this layer. Returns null when:
 *   - the command has no recognised add verb,
 *   - the command has no explicit `name@spec` targets (bare install →
 *     post-install lockfile resolution decides the new pin),
 *   - the snapshot is empty.
 */
export async function enforceManifestPinPolicyForInstall(
  command: string,
  featureRootPath: string,
): Promise<PinPolicyRejection | null> {
  const targets = extractInstallVersionTargets(command, splitOnShellOperators, tokenizeShellSegment);
  if (targets.length === 0) return null;

  const snap = await scanWorkspaceDepPins(featureRootPath);
  if (snap.pins.size === 0) return null;

  const violations = detectInstallPinViolations(targets, snap);
  if (violations.length === 0) return null;

  return { display: renderInstallRejection(command, violations) };
}

function renderInstallRejection(command: string, violations: PinInstallViolation[]): string {
  const lines: string[] = [];
  lines.push(`❌ DEPENDENCY VERSION CONFLICT in install command: ${command}`);
  lines.push('');
  lines.push('The following libraries are already pinned elsewhere in this workspace:');
  for (const v of violations) {
    lines.push(`  - ${v.name}: pinned to ${v.pinnedSpec} in ${v.pinnedIn.join(', ')}`);
  }
  lines.push('');
  lines.push('You requested:');
  for (const v of violations) {
    lines.push(`  - ${v.name}@${v.requestedSpec}`);
  }
  lines.push('');
  lines.push('Reuse the pinned spec verbatim (e.g. add the package without an explicit version, or use the existing spec).');
  lines.push('Do NOT pick a different version. Do NOT upgrade. The install command was rejected before execution.');
  return lines.join('\n');
}
