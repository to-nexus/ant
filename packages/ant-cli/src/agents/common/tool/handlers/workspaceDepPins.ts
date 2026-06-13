/**
 * workspaceDepPins — workspace-wide dependency pin observation.
 *
 * Sibling of `invalidationScope.ts` (both are codebase-disk SSOT helpers).
 * Scans every dependency manifest under the feature's `codebase/` and
 * builds a snapshot of declared specs + resolved versions, plus a list
 * of cross-package conflicts (same library declared with different
 * specs in different manifests).
 *
 * The snapshot drives two surfaces:
 *
 *   - Prompt injection (`workspace-dep-snapshot.md` partial) — tells
 *     downstream setup/feature/ui/error/design-system/test-code tasks
 *     which libraries are already pinned so they reuse the spec verbatim.
 *   - Hard-reject policy guard (`manifestPinPolicy.ts`) — rejects
 *     `editFile`/`createFile` writes and `pnpm add X@Y` install commands
 *     that would introduce a conflicting spec.
 *
 * Manifest-type-dispatch shape: the implementation is a single dispatch
 * table keyed by manifest basename. Phase 1 implements the
 * `package.json` row only; future Cargo/pyproject/go.mod rows can be
 * added without touching call sites.
 *
 * NOT a state-channel surface — pure module-level helpers, no LangGraph
 * imports, callable from both architect-graph hooks and common tool
 * handlers.
 */

import * as path from 'path';
import * as fs from 'fs';
import { enumeratePackageJsonManifests } from '../../../../utils/workspacePackages';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ManifestKind = 'package.json' /* | 'cargo.toml' | 'pyproject.toml' | 'go.mod' */;

export interface DepPin {
  /** Package/crate/module name as written in the manifest. */
  name: string;
  /** The spec verbatim from the manifest (e.g. `"^18.3.0"`, `"workspace:*"`). */
  declaredSpec: string;
  /** Resolved version from `node_modules/<name>/package.json::version` when present. */
  resolvedVersion?: string;
  /** Codebase-relative paths of every manifest that declared this name (first-seen first). */
  declaredIn: string[];
  manifestKind: ManifestKind;
}

export interface WorkspaceDepSnapshot {
  /** First-seen pin per name (winner of the cross-package contest). */
  pins: Map<string, DepPin>;
  /**
   * Cross-package conflicts: same name declared with different specs in
   * different manifests. Each entry carries every observed pin so the
   * caller can render a deterministic diff.
   */
  conflicts: Array<{ name: string; pins: DepPin[] }>;
  /** Codebase-relative paths of every manifest scanned. */
  manifestPaths: string[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Manifest-type dispatch
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ManifestDispatch {
  basename: string;
  /**
   * Read declared dependency name→spec pairs from the given manifest's
   * absolute path. Returns null when the manifest is unreadable / malformed
   * (callers should treat null as "no contribution from this manifest").
   */
  readDeps(absPath: string): Promise<Array<{ name: string; spec: string }> | null>;
  /**
   * Best-effort resolved-version lookup. Manifest-local-first (pnpm symlink
   * / yarn-classic nested) then root-fallback (npm 7+ workspaces hoisted /
   * pnpm top-level). When `declaringDir` is omitted or equals the codebase
   * root, only the root is checked. Returns undefined when not installed.
   */
  readResolvedVersion(
    codebasePath: string,
    name: string,
    declaringDir?: string,
  ): Promise<string | undefined>;
  /**
   * Enumerate every manifest of this kind under the codebase root.
   * Returns absolute paths. Empty array when nothing matches.
   */
  enumerateWorkspace(codebasePath: string): Promise<string[]>;
}

const PACKAGE_JSON_DISPATCH: ManifestDispatch = {
  basename: 'package.json',
  async readDeps(absPath) {
    try {
      const raw = await fs.promises.readFile(absPath, 'utf-8');
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const merged: Record<string, string> = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      return Object.entries(merged).map(([name, spec]) => ({ name, spec }));
    } catch {
      return null;
    }
  },
  async readResolvedVersion(codebasePath, name, declaringDir) {
    const modDir = await resolveModulePath(codebasePath, name, declaringDir);
    if (!modDir) return undefined;
    try {
      const raw = await fs.promises.readFile(path.join(modDir, 'package.json'), 'utf-8');
      const depPkg = JSON.parse(raw) as { version?: unknown };
      return typeof depPkg.version === 'string' ? depPkg.version : undefined;
    } catch {
      return undefined;
    }
  },
  async enumerateWorkspace(codebasePath) {
    return enumeratePackageJsonManifests(codebasePath);
  },
};

const DISPATCH: Record<ManifestKind, ManifestDispatch> = {
  'package.json': PACKAGE_JSON_DISPATCH,
};

/**
 * Resolve where a dependency's `node_modules` directory actually lives.
 *
 * Manifest-local-first → root-fallback covers all three workspace
 * topologies: pnpm symlinks each dep into the declaring member's own
 * `node_modules/`, yarn-classic nests them likewise, and npm 7+ workspaces
 * hoist to the root `codebase/node_modules/`. Without manifest-local-first
 * a hoisted root-only check would miss pnpm members and silently report
 * "not installed" for symlinked members.
 *
 * Returns the absolute path to the dep's `node_modules/<name>/` directory
 * when present, or undefined when neither location resolves. Used by both
 * `areDepsInstalled` (install-status SSOT) and `readResolvedVersion`
 * (pin-snapshot SSOT) so the two surfaces never disagree on whether a dep
 * is installed.
 */
export async function resolveModulePath(
  codebasePath: string,
  name: string,
  declaringDir?: string,
): Promise<string | undefined> {
  const segments = name.split('/');

  if (declaringDir && declaringDir !== codebasePath) {
    const localPath = path.join(declaringDir, 'node_modules', ...segments);
    try {
      await fs.promises.stat(localPath);
      return localPath;
    } catch {
      // fall through to root-fallback
    }
  }

  const rootPath = path.join(codebasePath, 'node_modules', ...segments);
  try {
    await fs.promises.stat(rootPath);
    return rootPath;
  } catch {
    return undefined;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Spec gating
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NON_VERSION_SPEC_PREFIX = /^(?:workspace:|link:|file:|portal:|patch:|catalog:|git\+|git:|https?:|npm:)/;

/**
 * A spec is "comparable" when it represents a version-like constraint
 * the policy guard can meaningfully reject on. Internal-protocol specs
 * (workspace:, link:, file:, …) are tolerated as-is and treated as a
 * single equivalence class — two `workspace:*` declarations of the same
 * name are not a conflict, but `workspace:*` vs `^1.2.3` is.
 */
function isComparableSpec(spec: string): boolean {
  return !NON_VERSION_SPEC_PREFIX.test(spec.trim());
}

function specsEqual(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Snapshot
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Scan every supported manifest under `<featureRoot>/codebase/` and
 * return a snapshot of declared pins + cross-package conflicts.
 *
 * Returns an empty snapshot when the codebase directory does not exist
 * or contains no manifests.
 */
export async function scanWorkspaceDepPins(featureRootPath: string): Promise<WorkspaceDepSnapshot> {
  const codebasePath = path.join(featureRootPath, 'codebase');
  const pins = new Map<string, DepPin>();
  const conflicts = new Map<string, DepPin[]>();
  const manifestPaths: string[] = [];

  for (const kind of Object.keys(DISPATCH) as ManifestKind[]) {
    const dispatch = DISPATCH[kind];
    const absManifests = await dispatch.enumerateWorkspace(codebasePath);
    for (const absPath of absManifests) {
      const rel = toCodebaseRelative(featureRootPath, absPath);
      manifestPaths.push(rel);
      const deps = await dispatch.readDeps(absPath);
      if (!deps) continue;
      const declaringDir = path.dirname(absPath);
      for (const { name, spec } of deps) {
        const existing = pins.get(name);
        if (!existing) {
          const resolvedVersion = await dispatch.readResolvedVersion(
            codebasePath,
            name,
            declaringDir,
          );
          pins.set(name, {
            name,
            declaredSpec: spec,
            resolvedVersion,
            declaredIn: [rel],
            manifestKind: kind,
          });
          continue;
        }
        existing.declaredIn.push(rel);
        if (
          isComparableSpec(existing.declaredSpec) &&
          isComparableSpec(spec) &&
          !specsEqual(existing.declaredSpec, spec)
        ) {
          const bucket = conflicts.get(name) ?? [];
          if (bucket.length === 0) bucket.push(existing);
          bucket.push({
            name,
            declaredSpec: spec,
            resolvedVersion: existing.resolvedVersion,
            declaredIn: [rel],
            manifestKind: kind,
          });
          conflicts.set(name, bucket);
        }
      }
    }
  }

  return {
    pins,
    conflicts: Array.from(conflicts.entries()).map(([name, pinList]) => ({ name, pins: pinList })),
    manifestPaths,
  };
}

function toCodebaseRelative(featureRootPath: string, absManifestPath: string): string {
  const rel = path.relative(featureRootPath, absManifestPath);
  return rel.split(path.sep).join('/');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Prompt rendering
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Render the snapshot for prompt injection. Returns "" when there are
 * no pins (the partial template's `{{#if hasWorkspaceDepSnapshot}}`
 * gate hides the entire section in that case).
 *
 * Manifest-agnostic phrasing — no "package.json" / "pnpm" vocabulary in
 * fixed copy. Only the per-pin lines display the manifest path, which
 * naturally surfaces the manifest type without baking it into the
 * partial's prose.
 */
export function renderSnapshotForPrompt(snap: WorkspaceDepSnapshot): string {
  if (snap.pins.size === 0) return '';
  const lines: string[] = [];
  const sortedNames = Array.from(snap.pins.keys()).sort();
  for (const name of sortedNames) {
    const pin = snap.pins.get(name)!;
    const resolved = pin.resolvedVersion ? ` (installed: ${pin.resolvedVersion})` : '';
    const where = pin.declaredIn.join(', ');
    lines.push(`- \`${name}\` → \`${pin.declaredSpec}\`${resolved} — declared in: ${where}`);
  }
  if (snap.conflicts.length > 0) {
    lines.push('');
    lines.push('### Existing Conflicts (resolve before adding more declarations)');
    for (const conflict of snap.conflicts.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- \`${conflict.name}\`:`);
      for (const p of conflict.pins) {
        lines.push(`  - \`${p.declaredSpec}\` in ${p.declaredIn.join(', ')}`);
      }
    }
  }
  return lines.join('\n');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Violation detection (write path)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface PinWriteViolation {
  name: string;
  declaredHere: string;
  pinnedSpec: string;
  pinnedIn: string[];
}

/**
 * Check whether an incoming `name → spec` set (from a `package.json`
 * write) conflicts with the workspace snapshot. The manifest itself
 * is excluded from the comparison (rewriting your own manifest with
 * the same spec stays a no-op).
 */
export function detectPinViolations(
  manifestRelPath: string,
  newDeps: Record<string, string>,
  snap: WorkspaceDepSnapshot,
): PinWriteViolation[] {
  const violations: PinWriteViolation[] = [];
  for (const [name, declaredHere] of Object.entries(newDeps)) {
    if (!isComparableSpec(declaredHere)) continue;
    const pin = snap.pins.get(name);
    if (!pin) continue;
    if (!isComparableSpec(pin.declaredSpec)) continue;
    if (specsEqual(pin.declaredSpec, declaredHere)) continue;
    const pinnedElsewhere = pin.declaredIn.filter(p => p !== manifestRelPath);
    if (pinnedElsewhere.length === 0) continue;
    violations.push({
      name,
      declaredHere,
      pinnedSpec: pin.declaredSpec,
      pinnedIn: pinnedElsewhere,
    });
  }
  return violations;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Violation detection (install path)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface PinInstallViolation {
  name: string;
  requestedSpec: string;
  pinnedSpec: string;
  pinnedIn: string[];
}

/**
 * Check whether explicit install targets (`name@spec` pairs) conflict
 * with the snapshot.
 */
export function detectInstallPinViolations(
  targets: Array<{ name: string; spec: string }>,
  snap: WorkspaceDepSnapshot,
): PinInstallViolation[] {
  const violations: PinInstallViolation[] = [];
  for (const { name, spec } of targets) {
    if (!isComparableSpec(spec)) continue;
    const pin = snap.pins.get(name);
    if (!pin) continue;
    if (!isComparableSpec(pin.declaredSpec)) continue;
    if (specsEqual(pin.declaredSpec, spec)) continue;
    violations.push({
      name,
      requestedSpec: spec,
      pinnedSpec: pin.declaredSpec,
      pinnedIn: pin.declaredIn,
    });
  }
  return violations;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Install command parsing (shellParser-driven)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Recognise `pnpm add` / `npm install` / `npm i` / `yarn add` verbs and
 * return the segment slice positioned after the verb. Other install
 * commands (e.g. `pnpm install` without targets, `cargo build`) are
 * outside scope — the policy guard only acts on commands that can carry
 * an explicit `name@spec` target.
 */
const ADD_VERB_PATTERNS: RegExp[] = [
  /\bpnpm\s+add\b/i,
  /\bnpm\s+(?:install|i)\b/i,
  /\byarn\s+add\b/i,
];

/**
 * Parse a shell command and pull out every `name@spec` install target
 * across all add-verb segments. Reuses the existing `shellParser`
 * (`splitOnShellOperators` + `tokenizeShellSegment`) so flag handling
 * (single/double quotes, escapes, redirects) stays consistent with the
 * rest of the runCommand pipeline.
 *
 * Returns an empty array when no add verb appears, when no target has
 * an explicit spec, or when the command is malformed.
 */
export function extractInstallVersionTargets(
  command: string,
  splitSegments: (cmd: string) => string[],
  tokenize: (segment: string) => string[],
): Array<{ name: string; spec: string }> {
  const targets: Array<{ name: string; spec: string }> = [];
  for (const segment of splitSegments(command)) {
    let verbMatch: RegExpExecArray | null = null;
    let matchedVerb: RegExp | null = null;
    for (const verb of ADD_VERB_PATTERNS) {
      const m = verb.exec(segment);
      if (m) {
        verbMatch = m;
        matchedVerb = verb;
        break;
      }
    }
    if (!verbMatch || !matchedVerb) continue;
    const afterVerb = segment.slice(verbMatch.index + verbMatch[0].length);
    for (const rawToken of tokenize(afterVerb)) {
      if (!rawToken) continue;
      if (rawToken.startsWith('-')) continue;
      const token = stripQuotes(rawToken);
      const parsed = parseNameAtSpec(token);
      if (parsed) targets.push(parsed);
    }
  }
  return targets;
}

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

/**
 * Parse a `name[@spec]` install token. Scoped packages (`@scope/name@spec`)
 * are handled by anchoring the `@` separator past the leading `@`.
 * Returns null when the token has no explicit spec.
 */
function parseNameAtSpec(token: string): { name: string; spec: string } | null {
  if (!token) return null;
  if (token.startsWith('@')) {
    const sep = token.indexOf('@', 1);
    if (sep === -1) return null;
    const name = token.slice(0, sep);
    const spec = token.slice(sep + 1);
    if (!spec) return null;
    return { name, spec };
  }
  const sep = token.indexOf('@');
  if (sep === -1) return null;
  const name = token.slice(0, sep);
  const spec = token.slice(sep + 1);
  if (!name || !spec) return null;
  return { name, spec };
}
