/**
 * Tenant path isolation — `UnifiedWorkspaceResolver` (C8).
 *
 * Cloud-mode multi-tenancy rests on the workspace path being scoped by BOTH
 * the organization AND the user, in that order:
 *
 *   workspaces/<organizationId>/<userId>/<project>/features/<feature>/...
 *
 * Both segments are derived authoritatively from the signature-verified JWT
 * (`extractUserContext` → `req.organization.id` / `req.user.id`). An attacker
 * cannot mint a JWT with a forged `org` claim without the signing secret; this
 * suite locks the structural half of that guarantee — that org is always the
 * first segment, so a context for one org can never resolve INTO another org's
 * subtree. If org scoping were ever dropped (regression), tenant data of every
 * org would collapse into a shared tree and these assertions would fail.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { RESERVED_FEATURE_NAME } from '../../src/core/utils/branchUtils';
import type { UserContext } from '../../src/core/types/user';

const BASE = '/mnt/workspaces';
const resolver = new UnifiedWorkspaceResolver(BASE);

const ctx = (organizationId: string, userId: string): UserContext => ({
  organizationId,
  userId,
});

describe('UnifiedWorkspaceResolver — org + user scoping', () => {
  const victim = ctx('victim-org', 'victim-user');

  it('places organizationId then userId as ordered path segments', () => {
    expect(resolver.getWorkspacePath(victim)).toBe(
      path.join(BASE, 'victim-org', 'victim-user'),
    );
    expect(resolver.getProjectPath(victim, 'proj')).toBe(
      path.join(BASE, 'victim-org', 'victim-user', 'proj'),
    );
    expect(resolver.getFeaturePath(victim, 'proj', 'login')).toBe(
      path.join(BASE, 'victim-org', 'victim-user', 'proj', 'features', 'login'),
    );
  });

  it('codebase path stays inside the org/user subtree (base + feature branch)', () => {
    expect(resolver.getCodebasePath(victim, 'proj')).toBe(
      path.join(BASE, 'victim-org', 'victim-user', 'proj', 'codebase'),
    );
    expect(resolver.getCodebasePath(victim, 'proj', RESERVED_FEATURE_NAME)).toBe(
      path.join(BASE, 'victim-org', 'victim-user', 'proj', 'codebase'),
    );
    expect(resolver.getCodebasePath(victim, 'proj', 'login')).toBe(
      path.join(BASE, 'victim-org', 'victim-user', 'proj', 'features', 'login', 'codebase'),
    );
  });
});

describe('UnifiedWorkspaceResolver — JWT org-forgery isolation (regression)', () => {
  const orgA = ctx('org-a', 'shared-user');
  const orgB = ctx('org-b', 'shared-user');

  it('same user under a different org resolves to a disjoint subtree', () => {
    // Identical project + feature + user; only the org claim differs. The two
    // paths must not collide, and neither may fall inside the other's org tree.
    const a = resolver.getFeaturePath(orgA, 'proj', 'login');
    const b = resolver.getFeaturePath(orgB, 'proj', 'login');

    expect(a).not.toBe(b);
    expect(a.startsWith(path.join(BASE, 'org-a') + path.sep)).toBe(true);
    expect(b.startsWith(path.join(BASE, 'org-b') + path.sep)).toBe(true);
    // org-b context can never reach into org-a's subtree.
    expect(b.startsWith(path.join(BASE, 'org-a') + path.sep)).toBe(false);
  });

  it('a context for org-b never produces a path under org-a, for any method', () => {
    const orgARoot = path.join(BASE, 'org-a') + path.sep;
    for (const p of [
      resolver.getWorkspacePath(orgB),
      resolver.getProjectPath(orgB, 'proj'),
      resolver.getFeaturePath(orgB, 'proj', 'login'),
      resolver.getCodebasePath(orgB, 'proj'),
      resolver.getCodebasePath(orgB, 'proj', 'login'),
    ]) {
      expect(p.startsWith(orgARoot)).toBe(false);
    }
  });

  it('different users within the same org are isolated from each other', () => {
    const u1 = resolver.getProjectPath(ctx('org-a', 'alice'), 'proj');
    const u2 = resolver.getProjectPath(ctx('org-a', 'bob'), 'proj');
    expect(u1).not.toBe(u2);
    expect(u1.startsWith(path.join(BASE, 'org-a', 'alice') + path.sep)).toBe(true);
    expect(u2.startsWith(path.join(BASE, 'org-a', 'bob') + path.sep)).toBe(true);
  });
});
