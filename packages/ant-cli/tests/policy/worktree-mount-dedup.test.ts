/**
 * Worktree mount-dedup static guard.
 *
 * 27bdc2fe introduced `k8sWorktreeMounts.resolveK8sWorktreeMounts` as an
 * intentional mirror of `GitHelper.resolveWorktreeBindMounts`. Both contained
 * the same `.git` parsing + `mainGitDir` derivation. This plan extracted that
 * logic into `GitHelper.resolveWorktreeAbsPaths` so both call sites share a
 * single source of truth.
 *
 * This guard locks the consolidation — neither function may re-grow its own
 * `.git` parsing (no `gitdir:` regex, no `match[1].trim()`, no
 * `path.dirname(path.dirname(...))` derivation) inside the function body.
 * They MUST call `resolveWorktreeAbsPaths` and own only their format.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const K8S_PATH = path.resolve(
  __dirname,
  '../../src/infrastructure/ide/k8sWorktreeMounts.ts',
);
const HELPER_PATH = path.resolve(
  __dirname,
  '../../src/periphery/adapters/http/services/GitService/helper/GitHelper.ts',
);

/**
 * Slice the substring between two anchors in source. Used to scope the
 * forbidden-pattern checks to a specific function-ish region without
 * full TS parsing.
 */
function sliceBetween(source: string, startAnchor: string, endAnchor: string): string {
  const startIdx = source.indexOf(startAnchor);
  if (startIdx < 0) throw new Error(`Start anchor not found: ${startAnchor}`);
  const endIdx = source.indexOf(endAnchor, startIdx + startAnchor.length);
  if (endIdx < 0) throw new Error(`End anchor not found: ${endAnchor}`);
  return source.slice(startIdx, endIdx);
}

describe('worktree mount-dedup static guard', () => {
  it('k8sWorktreeMounts.resolveK8sWorktreeMounts MUST NOT contain own .git parsing', () => {
    const source = readFileSync(K8S_PATH, 'utf-8');
    // Scope: function declaration up to its return statement (heuristic close).
    const body = sliceBetween(source, 'export function resolveK8sWorktreeMounts', 'return mounts');
    // Forbidden patterns — these belong only in GitHelper.resolveWorktreeAbsPaths
    expect(body).not.toMatch(/match\(\/\^gitdir/);
    expect(body).not.toMatch(/readFileSync\([^)]*\.git/);
    expect(body).not.toMatch(/path\.dirname\(\s*worktreesDir/);
    // Required: must call the SSOT helper
    expect(body).toMatch(/GitHelper\.resolveWorktreeAbsPaths/);
  });

  it('GitHelper.resolveWorktreeBindMounts MUST NOT contain own .git parsing', () => {
    const source = readFileSync(HELPER_PATH, 'utf-8');
    const body = sliceBetween(source, 'static resolveWorktreeBindMounts', 'return binds');
    // Forbidden — belongs only in resolveWorktreeAbsPaths
    expect(body).not.toMatch(/match\(\/\^gitdir/);
    expect(body).not.toMatch(/path\.dirname\(\s*worktreesDir/);
    expect(body).not.toMatch(/readFileSync\(\s*gitPath/);
    // Required: must call the SSOT helper (in same class, unqualified call)
    expect(body).toMatch(/resolveWorktreeAbsPaths/);
  });

  it('GitHelper.resolveWorktreeAbsPaths is the single source of `.git` parsing', () => {
    const source = readFileSync(HELPER_PATH, 'utf-8');
    // Scope to the SSOT function. The body MUST contain the parsing logic.
    const body = sliceBetween(source, 'static resolveWorktreeAbsPaths', 'return { mainGitDir');
    expect(body).toMatch(/gitdir:/);
    expect(body).toMatch(/readFileSync\(/);
    expect(body).toMatch(/path\.dirname\(/);
  });
});
