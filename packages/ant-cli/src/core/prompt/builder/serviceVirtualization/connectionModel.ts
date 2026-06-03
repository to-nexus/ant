/**
 * Service Virtualization connection model — the single runtime SSOT for
 * `@connection` annotation parsing, mock-toggle naming, and the bounded
 * workspace scan radius. Consumed by the resolve-time detector
 * (`prompt/builder/serviceVirtualization/snapshot.ts`), the parity verifier
 * (`verify/parity/loadConnections.ts`), the preview ConnectionDetector, and
 * the preview ProcessSpawner mock-toggle injector.
 *
 * Runtime helpers live here (not in `@ant/shared`, which is types-only). The
 * human/LLM-facing framework→prefix naming table is documented once in
 * `templates/jobs/shared/injections/sv-toggle-naming.md` and mirrors the
 * `frameworkAwareToggleVars` logic below.
 *
 * See `docs/internals/38-service-virtualization.md` §3.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

export type ConnectionCategory = 'business' | 'infrastructure';

/** Frontend bundler family that determines the client-visible toggle prefix. */
export type DeployFramework = 'next' | 'vite' | 'cra' | 'other';

export interface AnnotationMatch {
  category: ConnectionCategory;
  name: string;
  /** Resolution token(s) after the name (`self`, `ant-project:…`), verbatim. */
  modifier?: string;
}

/**
 * Single `@connection` annotation grammar — a faithful superset of the three
 * former regexes (resolve snapshot / parity / preview): optional leading
 * whitespace, both categories, the name token, and an optional trailing
 * resolution modifier. Anchored per-line; callers split the file into lines.
 */
export const CONNECTION_ANNOTATION_RE =
  /^\s*#\s*@connection\s+(business|infrastructure)\s+(\S+)(?:\s+(.+?))?\s*$/;

export function parseAnnotationLine(line: string): AnnotationMatch | null {
  const m = line.match(CONNECTION_ANNOTATION_RE);
  if (!m) return null;
  return { category: m[1] as ConnectionCategory, name: m[2], modifier: m[3] };
}

/** Bare per-connection toggle env var: `USE_MOCK_<UPPER_SNAKE_NAME>`. */
export function deriveToggleVar(name: string): string {
  return `USE_MOCK_${name.replace(/-/g, '_').toUpperCase()}`;
}

const MASTER_TOGGLE = 'USE_MOCK';

/** Client-bundle visibility prefix for the given framework (bare when none). */
export function frameworkTogglePrefix(framework: DeployFramework | undefined): string {
  switch (framework) {
    case 'next':
      return 'NEXT_PUBLIC_';
    case 'vite':
      return 'VITE_';
    case 'cra':
      return 'REACT_APP_';
    default:
      return '';
  }
}

export interface FrameworkAwareToggles {
  /** Per-connection toggle env var names to set (bare + framework-prefixed). */
  toggles: string[];
  /** Master broadcast names (bare + framework-prefixed). */
  masters: string[];
}

/**
 * The framework-correct toggle env var name(s) for a connection. A bundled
 * client reads only its own prefix, so we emit the bare form (server/RSC) AND
 * the framework-prefixed form (client) defensively — extra names are inert in
 * runtimes that don't read them. The runtime codification of the naming table
 * in `sv-toggle-naming.md`.
 */
export function frameworkAwareToggleVars(
  name: string,
  framework: DeployFramework | undefined,
): FrameworkAwareToggles {
  const bare = deriveToggleVar(name);
  const prefix = frameworkTogglePrefix(framework);
  return {
    toggles: prefix ? [bare, `${prefix}${bare}`] : [bare],
    masters: prefix ? [MASTER_TOGGLE, `${prefix}${MASTER_TOGGLE}`] : [MASTER_TOGGLE],
  };
}

/** Per-connection toggle > master broadcast > false. */
export function resolveActivation(
  toggleEnvVar: string,
  envMap: Map<string, string>,
): boolean {
  const per = envMap.get(toggleEnvVar);
  if (per !== undefined) return per === 'true';
  return envMap.get(MASTER_TOGGLE) === 'true';
}

// ── bounded root + depth-2 monorepo scan (one shared radius) ──────────────

const skip = (n: string): boolean => n.startsWith('.') || n === 'node_modules';

/** Root, depth-1 children, depth-2 grandchildren (apps/* / packages/*). */
async function scanDirs(codebaseRoot: string): Promise<string[]> {
  const dirs = [codebaseRoot];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(codebaseRoot);
  } catch {
    return dirs;
  }
  for (const name of entries) {
    if (skip(name)) continue;
    const child = path.join(codebaseRoot, name);
    try {
      if (!(await fs.stat(child)).isDirectory()) continue;
    } catch {
      continue;
    }
    dirs.push(child);
    let nested: string[] = [];
    try {
      nested = await fs.readdir(child);
    } catch {
      continue;
    }
    for (const nestedName of nested) {
      if (skip(nestedName)) continue;
      const grand = path.join(child, nestedName);
      try {
        if (!(await fs.stat(grand)).isDirectory()) continue;
      } catch {
        continue;
      }
      dirs.push(grand);
    }
  }
  return dirs;
}

/** True on the first directory for which `check` resolves true. */
export async function anyInScanRadius(
  codebaseRoot: string,
  check: (dir: string) => Promise<boolean>,
): Promise<boolean> {
  for (const dir of await scanDirs(codebaseRoot)) {
    if (await check(dir)) return true;
  }
  return false;
}

/** Concatenate `collect(dir)` across the scan radius (root first). */
export async function collectInScanRadius<T>(
  codebaseRoot: string,
  collect: (dir: string) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (const dir of await scanDirs(codebaseRoot)) {
    out.push(...(await collect(dir)));
  }
  return out;
}
