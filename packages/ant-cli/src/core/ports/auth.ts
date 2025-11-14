/**
 * Authentication Port
 * 
 * 사용자 인증 및 인가를 위한 Port 인터페이스
 */

export interface AuthPort {
  /**
   * 인증 정보에서 사용자/조직 추출
   */
  authenticate(credentials: AuthCredentials): Promise<AuthContext>;
  
  /**
   * 사용자 권한 확인
   */
  authorize(user: User, resource: string, action: string): Promise<boolean>;
}

// ========================================
// Types
// ========================================

export interface AuthCredentials {
  email?: string;
  token?: string;
}

export interface AuthContext {
  user: User;
  organization: Organization;
}

export interface User {
  id: string;
  email: string;
  organizationId: string;
}

export interface Organization {
  id: string;
  name: string;
}

