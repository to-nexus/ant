/**
 * `cloud-ide.routes.start` worktree pre-check static guard.
 *
 * The race fix requires that POST /cloud-ide/start ALWAYS calls
 * `ensureGitRepository` (via the local `ensureWorktreeForIDE` helper) BEFORE
 * deriving workspacePath / starting the pod. Without this, a race between
 * the FE's createFeature and IDE start calls can leave the pod with only
 * the alias mount → IDE shows "Initialize Repository" forever.
 *
 * A full integration test would require mocking the entire dependency
 * graph (ideOrchestrator, k8s client, state store, gh auth). The structural
 * invariant is locked here as a source-level check — the route file MUST
 * contain the precheck call site BEFORE the workspacePath resolution and
 * the orchestrator.start call.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROUTE_PATH = path.resolve(
  __dirname,
  '../../src/periphery/adapters/http/routes/cloud-ide.routes.ts',
);

function readSource(): string {
  return readFileSync(ROUTE_PATH, 'utf-8');
}

/**
 * Locate the POST `/start` handler block by finding the start anchor and the
 * first occurrence of the catch-block close that wraps it. Robust to nested
 * `try/catch/await` blocks unlike a non-greedy regex.
 */
function getStartHandler(): string {
  const source = readSource();
  const startAnchor = source.indexOf("router.post('/start'");
  if (startAnchor < 0) throw new Error('POST /start handler not found in cloud-ide.routes.ts');
  // The next `router.post(...)` after `/start` marks the end of the /start block.
  const nextRouteAnchor = source.indexOf('router.post(', startAnchor + 1);
  const endRouterAnchor = source.indexOf('router.get(', startAnchor + 1);
  const cutoffs = [nextRouteAnchor, endRouterAnchor].filter(i => i > 0);
  const cutoff = cutoffs.length > 0 ? Math.min(...cutoffs) : source.length;
  return source.slice(startAnchor, cutoff);
}

describe('cloud-ide.routes POST /start — worktree precheck invariant', () => {
  it('MUST call ensureWorktreeForIDE for non-RESERVED features', () => {
    const handler = getStartHandler();
    expect(handler).toMatch(/ensureWorktreeForIDE\(\s*userContext,\s*projectId,\s*featureName\s*\)/);
  });

  it('precheck MUST run BEFORE workspacePath / ideOrchestrator.start', () => {
    const handler = getStartHandler();
    const ensureIdx = handler.indexOf('ensureWorktreeForIDE');
    const workspaceIdx = handler.indexOf('workspaceResolver.getCodebasePath');
    const startIdx = handler.indexOf('ideOrchestrator.start');
    expect(ensureIdx).toBeGreaterThan(0);
    expect(workspaceIdx).toBeGreaterThan(ensureIdx);
    expect(startIdx).toBeGreaterThan(workspaceIdx);
  });

  it('precheck MUST be gated on featureName being non-RESERVED', () => {
    const handler = getStartHandler();
    // The gate predicate uses RESERVED_FEATURE_NAME exclusion — the literal
    // identifier MUST appear in the gate region preceding the call.
    expect(handler).toMatch(/featureName\s*!==\s*RESERVED_FEATURE_NAME[\s\S]+ensureWorktreeForIDE/);
  });

  it('helper MUST delegate to ensureGitRepository (the SSOT, not a parallel implementation)', () => {
    const source = readSource();
    expect(source).toMatch(/import\s*\{\s*ensureGitRepository\s*\}/);
    // The helper body MUST call ensureGitRepository with worktreeService + featureBackup
    expect(source).toMatch(/ensureGitRepository\(\s*\{[\s\S]*worktreeService[\s\S]*featureBackup[\s\S]*\}\s*\)/);
  });
});
