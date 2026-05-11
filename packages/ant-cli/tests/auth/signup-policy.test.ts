/**
 * Phase 3 signup-policy regression guard.
 *
 * Covers the SSOT (no `to.nexus` whitelist), consumer/business
 * classification, slugify rules, reserved-name rejection, and
 * `suggestOrganizationName` prefill behavior.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  resolveOrganizationId,
  suggestOrganizationName,
} from '../../src/core/auth/resolveOrganizationId';
import { slugify, InvalidOrganizationNameError, RESERVED_ORG_NAMES } from '../../src/core/auth/slugify';
import { isConsumerDomain, CONSUMER_EMAIL_DOMAINS } from '../../src/core/auth/consumerDomains';
import { AuthService } from '../../src/infrastructure/auth/AuthService';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');

describe('Phase 3 signup policy', () => {
  it('contains no hardcoded `to.nexus` allowlist branch in AuthService or auth.routes', () => {
    // The historical guard was `if (domain !== 'to.nexus')` / `if (organizationId !== 'to.nexus')`
    // throwing `Only to.nexus organization is currently supported`. Both
    // surfaces now delegate to `resolveOrganizationId`. Comments may still
    // reference the legacy name for context — we only forbid the LIVE
    // string-equality guard (a quoted 'to.nexus' or "to.nexus").
    const authSvc = fs.readFileSync(
      path.join(repoRoot, 'src/infrastructure/auth/AuthService.ts'),
      'utf-8',
    );
    const authRoutes = fs.readFileSync(
      path.join(repoRoot, 'src/periphery/adapters/http/routes/auth.routes.ts'),
      'utf-8',
    );

    const liveGuard = /['"]to\.nexus['"]/;
    expect(authSvc).not.toMatch(liveGuard);
    expect(authRoutes).not.toMatch(liveGuard);
    expect(authSvc).not.toMatch(/Only to\.nexus organization is currently supported/);
    expect(authRoutes).not.toMatch(/Only to\.nexus organization is currently supported/);
  });

  it('consumer emails get DIFFERENT personal- ids (gmail collapse bug fix)', () => {
    const a = resolveOrganizationId('foo@gmail.com', undefined, 'user-1');
    const b = resolveOrganizationId('bar@gmail.com', undefined, 'user-2');
    expect(a).toMatch(/^personal-/);
    expect(b).toMatch(/^personal-/);
    expect(a).not.toBe(b);
  });

  it('business emails join the bare domain (auto-handshake)', () => {
    const a = resolveOrganizationId('alice@acme.io', undefined, 'user-a');
    const b = resolveOrganizationId('bob@acme.io', undefined, 'user-b');
    expect(a).toBe('acme.io');
    expect(b).toBe('acme.io');
  });

  it('explicit organizationName input wins over email-derived id (slugified)', () => {
    expect(resolveOrganizationId('foo@gmail.com', 'Acme Team', 'user-1')).toBe('acme-team');
    expect(resolveOrganizationId('alice@acme.io', 'My Org', 'user-a')).toBe('my-org');
  });

  it('reserved org names are rejected with InvalidOrganizationNameError', () => {
    for (const reserved of RESERVED_ORG_NAMES) {
      expect(() => slugify(reserved)).toThrow(InvalidOrganizationNameError);
    }
  });

  it('slugify normalizes whitespace / casing / special chars', () => {
    expect(slugify('Acme Team')).toBe('acme-team');
    expect(slugify('Foo Bar 123')).toBe('foo-bar-123');
    expect(slugify('  Spaced  Out  ')).toBe('spaced-out');
    expect(slugify('Dots.And-Dashes_All')).toBe('dots-and-dashes-all');
  });

  it('slugify rejects empty / whitespace-only / pure-symbol input', () => {
    expect(() => slugify('')).toThrow(InvalidOrganizationNameError);
    expect(() => slugify('   ')).toThrow(InvalidOrganizationNameError);
    expect(() => slugify('!!!')).toThrow(InvalidOrganizationNameError);
  });

  it('slugify clamps length to 64', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBe(64);
  });

  it('"acme-team" by two members converges on the same id (handshake / free join)', () => {
    const a = resolveOrganizationId('alice@gmail.com', 'acme-team', 'user-a');
    const b = resolveOrganizationId('bob@gmail.com', 'Acme Team', 'user-b');
    expect(a).toBe('acme-team');
    expect(b).toBe('acme-team');
    expect(a).toBe(b);
  });

  it('consumer domain SSOT covers gmail + naver + outlook + icloud + protonmail + kakao', () => {
    expect(isConsumerDomain('gmail.com')).toBe(true);
    expect(isConsumerDomain('Naver.COM')).toBe(true); // case-insensitive
    expect(isConsumerDomain('outlook.com')).toBe(true);
    expect(isConsumerDomain('icloud.com')).toBe(true);
    expect(isConsumerDomain('protonmail.com')).toBe(true);
    expect(isConsumerDomain('kakao.com')).toBe(true);
    // business / unknown
    expect(isConsumerDomain('acme.io')).toBe(false);
    expect(isConsumerDomain('mycompany.com')).toBe(false);
    expect(CONSUMER_EMAIL_DOMAINS.size).toBeGreaterThanOrEqual(20);
  });

  it('suggestOrganizationName: business email → second-level domain', () => {
    expect(suggestOrganizationName('bob@acme.io')).toBe('acme');
    expect(suggestOrganizationName('bob@mycompany.com')).toBe('mycompany');
  });

  it('suggestOrganizationName: subdomain business email → second-level domain', () => {
    expect(suggestOrganizationName('bob@sub.acme.io')).toBe('acme');
    expect(suggestOrganizationName('alice@team.eng.bigcorp.io')).toBe('bigcorp');
  });

  it('suggestOrganizationName: consumer email → null (no prefill)', () => {
    expect(suggestOrganizationName('foo@gmail.com')).toBeNull();
    expect(suggestOrganizationName('bar@naver.com')).toBeNull();
    expect(suggestOrganizationName('baz@outlook.com')).toBeNull();
  });

  it('AuthService.authenticate uses resolveOrganizationId (no to.nexus block)', async () => {
    const svc = new AuthService();
    const consumer = await svc.authenticate({ email: 'foo@gmail.com', userId: 'oauth-sub-1' });
    expect(consumer.organization.id).toMatch(/^personal-/);

    const business = await svc.authenticate({ email: 'alice@acme.io', userId: 'oauth-sub-2' });
    expect(business.organization.id).toBe('acme.io');
  });

  it('AuthService.authenticate falls back to email seed when userId is absent', async () => {
    const svc = new AuthService();
    const first = await svc.authenticate({ email: 'foo@gmail.com' });
    const second = await svc.authenticate({ email: 'bar@gmail.com' });
    expect(first.organization.id).not.toBe(second.organization.id);
  });

  it('AuthService.authenticate ALWAYS uses email-local-part as user.id (workspace topology BC)', async () => {
    // Critical invariant — `user.id` becomes `JWT.sub` becomes
    // `req.user.id` becomes `userContext.userId` becomes the workspace
    // directory name. If `credentials.userId` (an OAuth `sub`) leaked
    // into `user.id`, every existing on-disk workspace at
    // `{org}/{username}/` would orphan after a re-OAuth.
    const svc = new AuthService();

    const noUserId = await svc.authenticate({ email: 'probe@to.nexus' });
    expect(noUserId.user.id).toBe('probe');

    // Even when an OAuth `sub` is supplied as `userId`, `user.id` MUST
    // stay as the email-local-part. The supplied id only seeds
    // resolveOrganizationId's `personal-${seed}` fallback for consumer
    // emails.
    const withOAuthSub = await svc.authenticate({
      email: 'probe@to.nexus',
      userId: '112233445566778899000', // simulated Google sub
    });
    expect(withOAuthSub.user.id).toBe('probe');
    expect(withOAuthSub.user.id).not.toBe('112233445566778899000');
  });

  it('consumer email userId seed differentiates orgs even when usernames collide', async () => {
    // Two emails with the same local-part but different domains and
    // different OAuth `sub`s — consumer-domain seed isolation prevents
    // the gmail-collapse bug even at the AuthService layer.
    const svc = new AuthService();
    const fooGmail = await svc.authenticate({ email: 'foo@gmail.com', userId: 'oauth-sub-1' });
    const fooYahoo = await svc.authenticate({ email: 'foo@yahoo.com', userId: 'oauth-sub-2' });
    expect(fooGmail.organization.id).not.toBe(fooYahoo.organization.id);
    // Both retain `user.id = 'foo'` — they only differ on org.
    expect(fooGmail.user.id).toBe('foo');
    expect(fooYahoo.user.id).toBe('foo');
  });
});
