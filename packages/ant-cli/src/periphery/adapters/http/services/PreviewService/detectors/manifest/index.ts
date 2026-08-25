/**
 * Manifest primitives — the single owner of "what does this directory's
 * manifests say it is".
 *
 * Pure + shallow + synchronous: reads only the manifest files sitting directly
 * in `dir`, never walks `src/`, never touches `node_modules`. This is what makes
 * read-time detection on every preview HTTP request cheap enough to need no
 * cache (see `ProjectProfileDetector`).
 *
 * Absorbed `ProjectStructureDetector.quickDetect`'s language + canStart tables;
 * `PackageDetector.detectFrameworkType` is now a narrowing projection over
 * `frameworkFromManifests`. `BuildRunner.detectFramework` intentionally stays
 * separate — it classifies build artifacts / env-var prefixes (`vite`,
 * `static`), a different axis.
 */

import * as fs from 'fs';
import * as path from 'path';
import { hasRunnableScript } from './scripts';
import {
  GO_FRAMEWORKS,
  JVM_FRAMEWORKS,
  NODE_META_FRAMEWORKS,
  NODE_SERVER_FRAMEWORKS,
  NODE_UI_LIBRARIES,
  PYTHON_FRAMEWORKS,
  RUNNABLE_MAKE_TARGETS,
  RUST_FRAMEWORKS,
  STATIC_DOC_ROOTS,
  STATIC_ENTRY_FILE,
} from './tables';

export interface ManifestSet {
  dir: string;
  /** Parsed root `package.json`, or undefined when absent/unparseable. */
  packageJson?: any;
  /** True when `package.json` exists but failed to parse (still a Node project). */
  packageJsonMalformed: boolean;
  hasPnpmWorkspaceYaml: boolean;
  goMod?: string;
  hasGoWork: boolean;
  pyRequirements?: string;
  pyProject?: string;
  hasSetupPy: boolean;
  hasManagePy: boolean;
  cargoToml?: string;
  pomXml?: string;
  buildGradle?: string;
  makefileTargets?: string[];
  /**
   * A servable static site: the doc root (relative to `dir`, `'.'` for the
   * directory itself) and the entry filename inside it (`index.html`, or the
   * lexicographically first non-dot `*.html` when no index exists). Present
   * whenever one is found — whether it ALONE identifies the project is
   * {@link isStaticWebProject}.
   */
  staticEntry?: { docRoot: string; entryFile: string };
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
}

function exists(file: string): boolean {
  return fs.existsSync(file);
}

/**
 * Read every recognized manifest in `dir`. Returns `null` when the directory
 * holds no recognized project manifest at all (greenfield / not a codebase).
 */
/**
 * Two-pass probe over {@link STATIC_DOC_ROOTS}. Pass 1: the first doc root
 * holding an `index.html` (an index in a LATER doc root beats a non-index
 * `*.html` in an earlier one, so no pre-existing project changes its answer).
 * Pass 2: the first doc root holding any non-dot depth-1 `*.html`; the
 * lexicographically first (plain code-unit sort — stable across pods,
 * snapshots and clones, unlike mtime) becomes the entry.
 *
 * The entry is decided HERE, from directory contents inside the fixed
 * allowlist — never from a request or a package field.
 */
function findStaticEntry(dir: string): { docRoot: string; entryFile: string } | undefined {
  for (const docRoot of STATIC_DOC_ROOTS) {
    if (exists(path.join(dir, docRoot, STATIC_ENTRY_FILE))) {
      return { docRoot, entryFile: STATIC_ENTRY_FILE };
    }
  }
  for (const docRoot of STATIC_DOC_ROOTS) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(dir, docRoot), { withFileTypes: true });
    } catch {
      continue;
    }
    const htmlFiles = entries
      .filter(e => e.isFile() && !e.name.startsWith('.') && e.name.toLowerCase().endsWith('.html'))
      .map(e => e.name)
      .sort();
    if (htmlFiles.length > 0) return { docRoot, entryFile: htmlFiles[0] };
  }
  return undefined;
}

export function readManifests(dir: string): ManifestSet | null {
  const pkgJsonPath = path.join(dir, 'package.json');
  const pkgRaw = readIfExists(pkgJsonPath);
  let packageJson: any | undefined;
  let packageJsonMalformed = false;
  if (pkgRaw !== undefined) {
    try {
      packageJson = JSON.parse(pkgRaw);
    } catch {
      packageJsonMalformed = true;
    }
  }

  const makefileRaw = readIfExists(path.join(dir, 'Makefile'));
  const makefileTargets = makefileRaw
    ? RUNNABLE_MAKE_TARGETS.filter(t => new RegExp(`^${t}:`, 'm').test(makefileRaw))
    : undefined;

  const staticEntry = findStaticEntry(dir);

  const set: ManifestSet = {
    dir,
    ...(packageJson ? { packageJson } : {}),
    packageJsonMalformed,
    hasPnpmWorkspaceYaml: exists(path.join(dir, 'pnpm-workspace.yaml')),
    goMod: readIfExists(path.join(dir, 'go.mod')),
    hasGoWork: exists(path.join(dir, 'go.work')),
    pyRequirements: readIfExists(path.join(dir, 'requirements.txt')),
    pyProject: readIfExists(path.join(dir, 'pyproject.toml')),
    hasSetupPy: exists(path.join(dir, 'setup.py')),
    hasManagePy: exists(path.join(dir, 'manage.py')),
    cargoToml: readIfExists(path.join(dir, 'Cargo.toml')),
    pomXml: readIfExists(path.join(dir, 'pom.xml')),
    buildGradle:
      readIfExists(path.join(dir, 'build.gradle')) ??
      readIfExists(path.join(dir, 'build.gradle.kts')),
    ...(makefileTargets ? { makefileTargets } : {}),
    ...(staticEntry ? { staticEntry } : {}),
  };

  return isRecognized(set) ? set : null;
}

function isRecognized(m: ManifestSet): boolean {
  return !!(
    m.packageJson ||
    m.packageJsonMalformed ||
    m.hasPnpmWorkspaceYaml ||
    m.goMod ||
    m.hasGoWork ||
    m.pyRequirements ||
    m.pyProject ||
    m.hasSetupPy ||
    m.cargoToml ||
    m.pomXml ||
    m.buildGradle ||
    m.makefileTargets ||
    m.staticEntry
  );
}

/**
 * Is a static entry (`index.html`, or any non-dot `*.html`) the ONLY thing
 * that identifies this directory?
 *
 * The static fallback is deliberately last-resort: a directory carrying any
 * build manifest — even one that cannot start (`package.json` without a dev
 * script, a `Makefile` with only `build:`) — keeps its own ecosystem's answer.
 * Serving such a project's raw sources would mask a real authoring defect, and
 * gating on "sole signal" is what makes the static rule unable to change any
 * currently-working project's detection result.
 *
 * Single owner for both the language and the `canStart` answer, so the two
 * cannot disagree.
 */
export function isStaticWebProject(m: ManifestSet): boolean {
  if (!m.staticEntry) return false;
  return !(
    m.packageJson ||
    m.packageJsonMalformed ||
    m.hasPnpmWorkspaceYaml ||
    m.goMod ||
    m.hasGoWork ||
    m.pyRequirements ||
    m.pyProject ||
    m.hasSetupPy ||
    m.cargoToml ||
    m.pomXml ||
    m.buildGradle ||
    m.makefileTargets
  );
}

/**
 * Language from manifests. `undefined` when only a Makefile identifies the
 * project — the caller must NOT substitute `'unknown'` (see `ProjectProfile`).
 *
 * Node wins over sibling manifests: a JS/TS repo with a helper `pyproject.toml`
 * is still a Node project, and `package.json` is the manifest the preview
 * spawner can actually act on.
 */
export function languageFromManifests(m: ManifestSet): string | undefined {
  if (m.packageJson || m.packageJsonMalformed || m.hasPnpmWorkspaceYaml) {
    return isTypescriptProject(m) ? 'typescript' : 'javascript';
  }
  if (m.goMod || m.hasGoWork) return 'go';
  if (m.cargoToml) return 'rust';
  if (m.pyRequirements || m.pyProject || m.hasSetupPy) return 'python';
  if (m.pomXml || m.buildGradle) return 'java';
  if (isStaticWebProject(m)) return 'html';
  return undefined;
}

/**
 * `quickDetect` reported every `package.json` project as `typescript`. Keep that
 * as the default (the tier system and the spawner treat them identically), but
 * report `javascript` when the project visibly has no TypeScript at all — a
 * `tsconfig.json` / `typescript` dep is the observable signal.
 */
function isTypescriptProject(m: ManifestSet): boolean {
  if (exists(path.join(m.dir, 'tsconfig.json'))) return true;
  if (m.packageJsonMalformed || !m.packageJson) return true;
  const deps = { ...m.packageJson.dependencies, ...m.packageJson.devDependencies };
  return !!(deps['typescript'] || deps['ts-node'] || deps['tsx'] || deps['@types/node']);
}

/**
 * Framework from manifests, direction-aware.
 *
 * `type` biases the Node lookup order toward that direction's own family,
 * because a package can legitimately carry both a server and a UI dependency: a
 * backend that also depends on `react` (SSR helpers, shared components) must
 * still report `nestjs`, and a frontend that pulls in `express` (a dev proxy)
 * must still report its UI library. A meta-framework always wins first — it
 * subsumes both.
 */
export function frameworkFromManifests(
  m: ManifestSet,
  type?: 'frontend' | 'backend' | 'other',
): string | undefined {
  if (m.packageJson) {
    const deps = { ...m.packageJson.dependencies, ...m.packageJson.devDependencies };
    const order =
      type === 'backend'
        ? [NODE_SERVER_FRAMEWORKS, NODE_META_FRAMEWORKS, NODE_UI_LIBRARIES]
        : type === 'frontend'
          ? [NODE_META_FRAMEWORKS, NODE_UI_LIBRARIES, NODE_SERVER_FRAMEWORKS]
          : [NODE_META_FRAMEWORKS, NODE_SERVER_FRAMEWORKS, NODE_UI_LIBRARIES];
    for (const table of order) {
      const hit = table.find(([dep]) => deps[dep]);
      if (hit) return hit[1];
    }
    return undefined;
  }

  if (m.goMod) return matchSubstring(m.goMod, GO_FRAMEWORKS);
  if (m.cargoToml) return matchSubstring(m.cargoToml, RUST_FRAMEWORKS);
  if (m.pyRequirements || m.pyProject || m.hasSetupPy) {
    const haystack = `${m.pyRequirements ?? ''}\n${m.pyProject ?? ''}`.toLowerCase();
    // `manage.py` is Django's own entry point — a stronger signal than a
    // transitively-pinned dependency name.
    if (m.hasManagePy) return 'django';
    return matchSubstring(haystack, PYTHON_FRAMEWORKS);
  }
  if (m.pomXml || m.buildGradle) {
    const haystack = `${m.pomXml ?? ''}\n${m.buildGradle ?? ''}`.toLowerCase();
    return matchSubstring(haystack, JVM_FRAMEWORKS);
  }
  return undefined;
}

function matchSubstring(
  haystack: string,
  table: ReadonlyArray<readonly [string, string]>,
): string | undefined {
  const lower = haystack.toLowerCase();
  return table.find(([needle]) => lower.includes(needle.toLowerCase()))?.[1];
}

/**
 * Can a preview be started from this directory?
 *
 * Verbatim port of `ProjectStructureDetector.quickDetect`'s rules — Node needs a
 * declared dev-server script (or a runnable workspace member), other ecosystems
 * are assumed startable, a Makefile-only project needs a `dev`/`run`/`serve`
 * target. `ProjectStructureDetector.detect()` cannot answer this: it falls
 * through to `singlePackage(root)` for a script-less Node repo, which would flip
 * `canStart` to true. Locked by `projectProfileCanStartParity.test.ts`.
 *
 * The static rule is the last one consulted and only fires when a static entry
 * is the sole signal ({@link isStaticWebProject}) — a script-less Node repo
 * stays `false` so "Missing script: dev" remains the diagnostic.
 */
export function canStartFromManifests(
  m: ManifestSet,
  probeWorkspaces?: (dir: string) => boolean,
): boolean {
  if (m.packageJson || m.packageJsonMalformed || m.hasPnpmWorkspaceYaml) {
    if (m.packageJsonMalformed) return false;
    const hasDevScript = hasRunnableScript(m.packageJson);
    if (hasDevScript) return true;
    return isNodeWorkspaceRoot(m) ? !!probeWorkspaces?.(m.dir) : false;
  }
  if (m.hasGoWork || m.goMod) return true;
  if (m.cargoToml) return true;
  if (m.pyRequirements || m.pyProject || m.hasSetupPy) return true;
  if (m.pomXml || m.buildGradle) return true;
  if (m.makefileTargets) return m.makefileTargets.length > 0;
  if (isStaticWebProject(m)) return true;
  return false;
}

/**
 * Absolute doc root to serve for a static web project, or `undefined` when this
 * directory is not one. The single accessor for "where do the files live" —
 * shared by the preview spawner and the deploy build-output resolver so neither
 * can invent its own answer.
 */
export function staticDocRoot(dir: string): string | undefined {
  const m = readManifests(dir);
  if (!m || !isStaticWebProject(m) || !m.staticEntry) return undefined;
  return path.resolve(dir, m.staticEntry.docRoot);
}

/**
 * Entry filename (relative to the doc root) for a static web project, or
 * `undefined` when this directory is not one. Same SSOT contract as
 * {@link staticDocRoot}: consumers re-derive at use time instead of carrying
 * the value, so the served entry can never drift from the detected one.
 */
export function staticEntryFile(dir: string): string | undefined {
  const m = readManifests(dir);
  if (!m || !isStaticWebProject(m) || !m.staticEntry) return undefined;
  return m.staticEntry.entryFile;
}

/** Node workspace root: `package.json.workspaces` or `pnpm-workspace.yaml`. */
export function isNodeWorkspaceRoot(m: ManifestSet): boolean {
  return !!(m.packageJson?.workspaces || m.hasPnpmWorkspaceYaml);
}

export * from './tables';
export * from './scripts';
