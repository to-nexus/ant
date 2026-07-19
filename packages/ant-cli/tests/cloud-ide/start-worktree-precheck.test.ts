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
  it('MUST call ensureWorktreeForIDE for the (required) feature', () => {
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

  it('featureName is REQUIRED (400) and the precheck runs UNCONDITIONALLY — no RESERVED gating', () => {
    const handler = getStartHandler();
    // New model: a project without a feature has no codebase — the route
    // rejects a missing featureName with 400 BEFORE the precheck.
    const rejectIdx = handler.search(/if\s*\(!featureName\)/);
    const ensureIdx = handler.indexOf('ensureWorktreeForIDE');
    expect(rejectIdx).toBeGreaterThan(0);
    expect(ensureIdx).toBeGreaterThan(rejectIdx);
    expect(handler).toMatch(/featureName is required/);
    // `_base` sentinel is gone — the precheck must NOT be gated on a
    // reserved-name exclusion; it runs for every (required) feature.
    const source = readSource();
    expect(source).not.toContain('RESERVED_FEATURE_NAME');
    expect(handler).not.toMatch(/featureName\s*!==/);
  });

  it('helper MUST delegate to ensureGitRepository (the SSOT, not a parallel implementation)', () => {
    const source = readSource();
    expect(source).toMatch(/import\s*\{\s*ensureGitRepository\s*\}/);
    // The helper body MUST call ensureGitRepository with the new input shape:
    // { workspaceResolver, projectId, userContext, featureName, operationName,
    //   worktreeService } — gitBootstrap / featureBackup are retired.
    expect(source).toMatch(
      /ensureGitRepository\(\s*\{\s*workspaceResolver,\s*projectId,\s*userContext,\s*featureName,\s*operationName:\s*'CloudIDEStart',\s*worktreeService,\s*\}\s*\)/,
    );
    expect(source).not.toContain('featureBackup');
    expect(source).not.toContain('gitBootstrap');
  });
});
