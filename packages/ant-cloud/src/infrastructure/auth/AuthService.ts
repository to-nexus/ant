/**
 * Authentication Service
 *
 * 1차 인증 / 조직 분류 책임.
 *
 * Org model: every cloud signup joins the shared `individual` org (see
 * `resolveOrgIdentity`). The team kind is a dormant seam.
 *
 * `user.id` (cloud) is the **full lowercased email** — required because the
 * shared `individual` org would collide on email-local-part (`bob@gmail.com`
 * vs `bob@naver.com` both → `bob`). The id is org-independent so a user
 * keeps the same identity when switching active org (individual ↔ team).
 * Local mode keeps `user.id = 'local'`.
 *
 * The email is the single ingress for `user.id`, so `assertColonFreeUserId`
 * here protects the `:`-delimited Redis/session-key namespace at one boundary.
 */

import { AuthPort, AuthCredentials, AuthContext } from '../../../../ant-cli/src/core/ports/auth';
import type { User, Organization } from '../../../../ant-cli/src/core/types/user';
import { resolveOrgIdentity } from '../../core/auth/resolveOrganizationId';

/**
 * Guard the `:`-delimited Redis/session-key namespace: a `userId` containing
 * a colon would silently mis-segment channel/session keys. The email
 * validation regex forbids colons, so this is a defense-in-depth assertion at
 * the identity boundary.
 */
export function assertColonFreeUserId(userId: string): void {
  if (userId.includes(':')) {
    throw new Error(`userId must not contain ':' (got "${userId}")`);
  }
}

export class AuthService implements AuthPort {
  /**
   * Email + (optional) userId → AuthContext.
   *
   * `credentials.email` 은 필수. 호출자가 OAuth `sub` 같은 stable
   * identifier 를 알면 `credentials.userId` 로 넘기되 — 이는 **오직
   * resolveOrganizationId 의 seed** 로만 사용된다 (consumer email
   * `personal-${seed}` 분기에서 더 신뢰성 있는 per-user tenant 격리).
   * `user.id` 자체는 항상 email-local-part 로 고정해 workspace 디렉토리
   * 이름이 안정적이도록 한다.
   */
  async authenticate(credentials: AuthCredentials): Promise<AuthContext> {
    if (!credentials.email) {
      throw new Error('Email required for authentication');
    }

    const email = credentials.email.trim().toLowerCase();

    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    const [username, domain] = email.split('@');

    if (!username || !domain) {
      throw new Error('Invalid email format');
    }

    const seed = (credentials as { userId?: string }).userId ?? username;
    const identity = resolveOrgIdentity(email, undefined, seed);

    // Cloud identity is the full email (org-independent, collision-free in
    // the shared individual org). Local mode is out of band here.
    const userId = email;
    assertColonFreeUserId(userId);

    const user: User = {
      id: userId,
      email,
      organizationId: identity.id,
    };

    const organization: Organization = {
      id: identity.id,
      name: identity.kind === 'individual' ? 'Individual' : identity.id,
      kind: identity.kind,
    };

    return {
      user,
      organization,
    };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
