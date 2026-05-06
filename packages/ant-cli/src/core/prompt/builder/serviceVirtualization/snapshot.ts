import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Service Virtualization snapshot detector (resolve-time).
 *
 * Phase-2 introduces `state.virtualizationSnapshot.hasBusinessConnection`
 * as the single boolean gate that drives the three SV partials. Resolve
 * runs once per job entry, BEFORE the preview process is up, so we cannot
 * read PreviewService's runtime registry. Instead we observe the same
 * SSOT that `business` `@connection` annotations are written to — the
 * project's `.env.example` (and `config.example.toml` for TOML projects).
 *
 * The detection is intentionally lightweight (no full ConnectionDetector
 * pipeline, no docker-compose enrichment): we only need a yes/no answer
 * to "is there at least one business external dependency declared?" The
 * full connection metadata still lives in PreviewService and is consumed
 * by Phase 3 (Diagnostics + UI toggle) and Phase 4 (parity check).
 *
 * Annotation grammar (preview-env-contract §4 / Phase 1):
 *   `# @connection business {name} [resolution-token]`
 *
 * SSOT for the gate predicate: this file. Callers must read
 * `state.virtualizationSnapshot.hasBusinessConnection` rather than re-
 * scanning the workspace.
 */

const ENV_FILES = ['.env.example'];
const TOML_FILES = ['config.example.toml'];
// `# @connection business` (case-insensitive on the keyword); a name token
// must follow but its specific value is not needed for the gate.
const BUSINESS_RE_ENV = /^\s*#\s*@connection\s+business\s+\S+/m;
const BUSINESS_RE_TOML = /^\s*#\s*@connection\s+business\s+\S+/m;

async function fileHasBusinessAnnotation(
  filePath: string,
  pattern: RegExp,
): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return pattern.test(content);
  } catch {
    return false;
  }
}

async function scanCodebaseRoot(codebaseRoot: string): Promise<boolean> {
  for (const f of ENV_FILES) {
    if (await fileHasBusinessAnnotation(path.join(codebaseRoot, f), BUSINESS_RE_ENV)) {
      return true;
    }
  }
  for (const f of TOML_FILES) {
    if (await fileHasBusinessAnnotation(path.join(codebaseRoot, f), BUSINESS_RE_TOML)) {
      return true;
    }
  }
  return false;
}

/**
 * Walks the immediate children of `codebaseRoot` looking for monorepo
 * package roots that themselves carry `.env.example` / `config.example.toml`.
 * Capped at depth = 1 to keep this bounded; the gate only needs ONE hit
 * to flip true.
 */
async function scanMonorepoChildren(codebaseRoot: string): Promise<boolean> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(codebaseRoot);
  } catch {
    return false;
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const child = path.join(codebaseRoot, name);
    let stat;
    try {
      stat = await fs.stat(child);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (await scanCodebaseRoot(child)) return true;
    // One additional level for common monorepo layouts (apps/* / packages/*).
    let nested: string[] = [];
    try {
      nested = await fs.readdir(child);
    } catch {
      continue;
    }
    for (const nestedName of nested) {
      if (nestedName.startsWith('.') || nestedName === 'node_modules') continue;
      const nestedDir = path.join(child, nestedName);
      let nestedStat;
      try {
        nestedStat = await fs.stat(nestedDir);
      } catch {
        continue;
      }
      if (!nestedStat.isDirectory()) continue;
      if (await scanCodebaseRoot(nestedDir)) return true;
    }
  }
  return false;
}

/**
 * Detect whether the project under `featurePath/codebase/` declares any
 * `business` `@connection` annotation.
 *
 * @param featurePath  Absolute workspace feature path. May be undefined
 *                     during unit tests / before workspace validation;
 *                     the function returns `false` in that case.
 */
export async function detectHasBusinessConnection(
  featurePath: string | undefined,
): Promise<boolean> {
  if (!featurePath) return false;
  const codebaseRoot = path.join(featurePath, 'codebase');
  if (await scanCodebaseRoot(codebaseRoot)) return true;
  return scanMonorepoChildren(codebaseRoot);
}

/**
 * Build the `virtualizationSnapshot` channel value. Kept separate from
 * the predicate so resolve can return `{ virtualizationSnapshot: ... }`
 * directly without re-deriving the boolean elsewhere.
 */
export async function buildVirtualizationSnapshot(
  featurePath: string | undefined,
): Promise<{ hasBusinessConnection: boolean }> {
  const hasBusinessConnection = await detectHasBusinessConnection(featurePath);
  return { hasBusinessConnection };
}
