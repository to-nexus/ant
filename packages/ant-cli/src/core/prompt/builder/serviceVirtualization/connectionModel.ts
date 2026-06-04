/**
 * Service Virtualization connection model — the single runtime SSOT for
 * `@connection` annotation parsing, mock-toggle naming, and the bounded
 * workspace scan radius. Consumed today by the resolve-time SV-partial-gate
 * detector (`prompt/builder/serviceVirtualization/snapshot.ts`) and the
 * preview ConnectionDetector (env + toml annotation parsers).
 *
 * Runtime helpers live here (not in `@ant/shared`, which is types-only).
 * `frameworkAwareToggleVars` codifies the framework→prefix naming rule for
 * the upcoming preview mock-toggle injection (Phase 5).
 *
 * See `docs/internals/38-service-virtualization.md` §3.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { DeployFramework as BuildFramework } from '@ant/shared';

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
 * former regexes (resolve snapshot / verification / preview): optional leading
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

/**
 * Client-bundle visibility prefix per framework. Single source for both the
 * per-framework lookup (`frameworkTogglePrefix`) and the prefix-agnostic
 * resolution set (`ALL_TOGGLE_PREFIXES`), so adding a bundler touches one place.
 */
const FRAMEWORK_TOGGLE_PREFIX: Record<DeployFramework, string> = {
  next: 'NEXT_PUBLIC_',
  vite: 'VITE_',
  cra: 'REACT_APP_',
  other: '',
};

/** Distinct prefixes a toggle may carry (bare `''` + each bundler prefix). */
const ALL_TOGGLE_PREFIXES = [...new Set(Object.values(FRAMEWORK_TOGGLE_PREFIX))];

/** Client-bundle visibility prefix for the given framework (bare when none). */
export function frameworkTogglePrefix(framework: DeployFramework | undefined): string {
  return framework ? FRAMEWORK_TOGGLE_PREFIX[framework] : '';
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

/**
 * Normalize the build/deploy framework enum (`@ant/shared`) to the SV
 * toggle-prefix enum. The two diverge (`nextjs`↔`next`, `static`/`unknown`↔
 * `other`); this is the single seam between `detectFramework` and the prefix
 * SSOT above, so the divergence is converted in exactly one place.
 */
export function toToggleFramework(f: BuildFramework | undefined): DeployFramework {
  switch (f) {
    case 'nextjs':
      return 'next';
    case 'vite':
      return 'vite';
    case 'cra':
      return 'cra';
    default:
      return 'other';
  }
}

/**
 * Resolve mock activation for a connection's bare toggle against an env map:
 * per-connection toggle > master broadcast > false.
 *
 * Framework-prefix-agnostic — checks the bare name AND every client prefix
 * (`NEXT_PUBLIC_` / `VITE_` / `REACT_APP_`), because a Next.js / Vite / CRA app
 * writes its toggle with the bundler prefix. A bare-only check silently
 * resolved every prefixed-toggle frontend to `false` (real); the `.env`-scanning
 * detector relies on this prefix-agnostic behavior.
 */
export function resolveActivation(
  bareToggle: string,
  envMap: Map<string, string>,
): boolean {
  for (const prefix of ALL_TOGGLE_PREFIXES) {
    const per = envMap.get(`${prefix}${bareToggle}`);
    if (per !== undefined) return per === 'true';
  }
  for (const prefix of ALL_TOGGLE_PREFIXES) {
    const master = envMap.get(`${prefix}${MASTER_TOGGLE}`);
    if (master !== undefined) return master === 'true';
  }
  return false;
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
