/**
 * `'main'`-as-featureless sentinel sweep.
 *
 * Under the bare-anchor model (CLAUDE.md "Feature/Branch Strategy SSOT") a
 * project has NO codebase of its own — every codebase is a linked worktree at
 * `features/{slug}/codebase`, and branch == feature name. So `main` is an
 * ordinary feature name, and the one `CloneOperation` auto-creates for most
 * repos (it names the base feature after the remote HEAD branch).
 *
 * `PreviewServer.resolveWorkspacePath` nonetheless kept a pre-anchor fork:
 *
 *     if (feature && feature !== 'main') → features/{slug}/codebase
 *     else                               → {project}/codebase        // dead layout
 *
 * so a feature named `main` resolved to a nonexistent directory and preview
 * died with a misleading "No recognized project files found". The same literal
 * blocked deploy / deploy-stop / deploy-status / custom-domain with 400.
 *
 * Two invariants, swept over the preview + deploy source:
 *   1. no `'main'` comparison or default — no feature NAME is privileged;
 *   2. no hand-assembled `'features'` path segment — `WorkspacePathResolver`
 *      owns slugging, the single-segment backstop and `repoType:'local'`.
 *
 * Scope is deliberately preview/deploy only. `FeatureCrudService` /
 * `ProjectCrudService` legitimately build feature directories, and `'main'`
 * is a correct literal for git default-branch naming (`branchUtils`,
 * `branchBaseLifecycle`, `CloneOperation`) — sweeping those would be noise.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

const SWEPT_DIRS = ['src/infrastructure/preview', 'src/infrastructure/deploy'];

/** `=== 'main'`, `!== 'main'`, `|| 'main'`, `?? 'main'` — comparison or default. */
const MAIN_SENTINEL = /(?:[=!]==?|\|\||\?\?)\s*['"]main['"]/;

/** `path.join(…, 'features', …)` — bypasses `buildFeaturePath`. */
const HAND_JOINED_FEATURES = /['"]features['"]\s*,/;

function listTsFiles(dir: string, acc: string[] = []): string[] {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `feature-main-sentinel sweep: "${dir}" does not exist. Update SWEPT_DIRS — ` +
      `a silent skip would let the sentinel creep back in unobserved.`,
    );
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(rel, acc);
    else if (entry.isFile() && entry.name.endsWith('.ts')) acc.push(rel);
  }
  return acc;
}

/** Strip line + block comments so prose about the retired sentinel doesn't trip the gate. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sweep(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const dir of SWEPT_DIRS) {
    for (const rel of listTsFiles(dir)) {
      const lines = stripComments(
        fs.readFileSync(path.join(repoRoot, rel), 'utf-8'),
      ).split('\n');
      lines.forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return hits;
}

describe("'main' is an ordinary feature name", () => {
  it('preview + deploy never compare against or default to it', () => {
    expect(sweep(MAIN_SENTINEL)).toEqual([]);
  });

  it('preview + deploy never hand-assemble a feature path', () => {
    expect(sweep(HAND_JOINED_FEATURES)).toEqual([]);
  });
});
