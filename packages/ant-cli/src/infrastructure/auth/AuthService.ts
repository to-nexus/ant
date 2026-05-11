/**
 * Authentication Service
 *
 * 1차 인증 / 조직 분류 책임.
 *
 * Phase 3 변경: 단일 도메인 (`to.nexus`) 화이트리스트를 제거하고
 * `resolveOrganizationId` SSOT 로 위임한다. consumer email (gmail 등) 은
 * `personal-${seed}` 로 분기되어 사용자별 격리 tenant 를 갖고,
 * business email 은 도메인 자체가 organizationId 가 된다.
 *
 * `user.id` 는 항상 email-local-part (workspace 토폴로지 BC) — 별도 stable
 * id (OAuth `sub`) 가 있어도 resolveOrganizationId 의 seed 로만 사용되고
 * `user.id` 를 덮어쓰지 않는다. 이는 `{workspaces}/{org}/{username}/` 의
 * 기존 디스크 트리와 `req.user.id = JWT.sub` 패턴을 보존하기 위함.
 */

import { AuthPort, AuthCredentials, AuthContext } from '../../core/ports/auth';
import type { User, Organization } from '../../core/types/user';
import { resolveOrganizationId } from '../../core/auth/resolveOrganizationId';

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
    const organizationId = resolveOrganizationId(email, undefined, seed);

    const user: User = {
      id: username,
      email,
      organizationId,
    };

    const organization: Organization = {
      id: organizationId,
      name: organizationId,
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
