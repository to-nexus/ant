/**
 * Authentication Service
 * 
 * 간단한 이메일 기반 인증 구현
 * username@organization.domain.com 형식에서 정보 추출
 */

import { AuthPort, AuthCredentials, AuthContext, User, Organization } from '../../core/ports/auth';

export class AuthService implements AuthPort {
  /**
   * 이메일에서 사용자/조직 정보 추출
   * 
   * @example
   * alice@nexus.ai → { userId: 'alice', organizationId: 'nexus' }
   */
  async authenticate(credentials: AuthCredentials): Promise<AuthContext> {
    if (!credentials.email) {
      throw new Error('Email required for authentication');
    }
    
    const email = credentials.email.trim().toLowerCase();
    
    // 이메일 형식 검증
    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }
    
    // username@organization.domain.com
    const [username, domain] = email.split('@');
    
    if (!username || !domain) {
      throw new Error('Invalid email format');
    }
    
    // 🚨 조직은 @ 뒤의 전체 호스트 (예: alice@to.nexus → to.nexus)
    const organizationId = domain;
    
    // 🚨 현재는 to.nexus 조직만 허용
    if (organizationId !== 'to.nexus') {
      throw new Error('Only to.nexus organization is currently supported');
    }
    
    const user: User = {
      id: username,
      email: email,
      organizationId: organizationId
    };
    
    const organization: Organization = {
      id: organizationId,
      name: organizationId  // Display name = organization ID
    };
    
    console.log(`[AuthService] Authenticated: ${username}@${organizationId}`);
    
    return {
      user,
      organization
    };
  }
  
  /**
   * 사용자 권한 확인
   * 
   * 초기 버전: 모든 권한 허용
   * 향후 확장: 조직별, 리소스별 권한 체계 구축
   */
  async authorize(user: User, resource: string, action: string): Promise<boolean> {
    // 🚨 초기 버전: 모든 권한 허용
    // TODO: 실제 권한 체계 구현
    return true;
  }
  
  // ========================================
  // Private Methods
  // ========================================
  
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

