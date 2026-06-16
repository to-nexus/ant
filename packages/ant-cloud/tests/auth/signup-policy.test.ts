/**
 * Org-model signup-policy regression guard.
 *
 * Post-cutover model: every cloud signup joins the SHARED `individual` org
 * (id `'individual'`, kind `'individual'`), regardless of personal vs business
 * email. User identity is the FULL lowercased email (collision-free in the
 * shared org). The `userInput` branch is the dormant team seam.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  resolveOrgIdentity,
  resolveOrganizationId,
} from '../../src/core/auth/resolveOrganizationId';
import { slugify, InvalidOrganizationNameError, RESERVED_ORG_NAMES } from '../../src/core/auth/slugify';
import { AuthService, assertColonFreeUserId } from '../../src/infrastructure/auth/AuthService';
import { INDIVIDUAL_ORG_ID } from '@ant/shared';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');

describe('Org-model signup policy', () => {
  it('contains no hardcoded `to.nexus` allowlist branch in AuthService or auth.routes', () => {
    const authSvc = fs.readFileSync(
      path.join(repoRoot, 'src/infrastructure/auth/AuthService.ts'),
      'utf-8',
    );
    const authRoutes = fs.readFileSync(
      path.join(repoRoot, 'src/routes/auth.routes.ts'),
      'utf-8',
    );
    const liveGuard = /['"]to\.nexus['"]/;
    expect(authSvc).not.toMatch(liveGuard);
    expect(authRoutes).not.toMatch(liveGuard);
  });

  it('every cloud signup resolves to the shared individual org (personal AND business)', () => {
    const consumer = resolveOrgIdentity('foo@gmail.com', undefined, 'user-1');
    const business = resolveOrgIdentity('alice@acme.io', undefined, 'user-a');
    expect(consumer).toEqual({ id: INDIVIDUAL_ORG_ID, kind: 'individual' });
    expect(business).toEqual({ id: INDIVIDUAL_ORG_ID, kind: 'individual' });
  });

  it('no more `personal-` per-user ids on the signup path', () => {
    expect(resolveOrganizationId('foo@gmail.com', undefined, 'user-1')).toBe(INDIVIDUAL_ORG_ID);
    expect(resolveOrganizationId('bar@gmail.com', undefined, 'user-2')).toBe(INDIVIDUAL_ORG_ID);
  });

  it('explicit org name input is the dormant team seam (kind=team)', () => {
    expect(resolveOrgIdentity('foo@gmail.com', 'Acme Team', 'user-1')).toEqual({
      id: 'acme-team',
      kind: 'team',
    });
  });

  it('`individual` is a reserved org name (cannot be a team slug)', () => {
    expect(RESERVED_ORG_NAMES.has('individual')).toBe(true);
    expect(() => slugify('individual')).toThrow(InvalidOrganizationNameError);
  });

  it('AuthService: user.id is the full lowercased email, org is individual', async () => {
    const svc = new AuthService();
    const a = await svc.authenticate({ email: 'Foo@Gmail.com', userId: 'oauth-sub-1' });
    expect(a.user.id).toBe('foo@gmail.com');
    expect(a.organization.id).toBe(INDIVIDUAL_ORG_ID);
    expect(a.organization.kind).toBe('individual');
  });

  it('collision fix: same local-part, different domains → DIFFERENT user.id', async () => {
    // The headline bug this refactor fixes: in a shared org, both would
    // otherwise collapse to `bob`.
    const svc = new AuthService();
    const gmail = await svc.authenticate({ email: 'bob@gmail.com', userId: 's1' });
    const naver = await svc.authenticate({ email: 'bob@naver.com', userId: 's2' });
    expect(gmail.user.id).toBe('bob@gmail.com');
    expect(naver.user.id).toBe('bob@naver.com');
    expect(gmail.user.id).not.toBe(naver.user.id);
    // Both share the one individual org.
    expect(gmail.organization.id).toBe(naver.organization.id);
  });

  it('assertColonFreeUserId rejects a colon (protects `:`-delimited keys)', () => {
    expect(() => assertColonFreeUserId('bob@gmail.com')).not.toThrow();
    expect(() => assertColonFreeUserId('bad:id@x.com')).toThrow();
  });
});
