/**
 * Authentication Port
 * 
 * 사용자 인증 및 인가를 위한 Port 인터페이스
 */

import type { User, Organization } from '../types/user';

export interface AuthPort {
  authenticate(credentials: AuthCredentials): Promise<AuthContext>;
  authorize(user: User, resource: string, action: string): Promise<boolean>;
}

// ========================================
// Auth-specific Types
// ========================================

export interface AuthCredentials {
  email?: string;
  token?: string;
}

export interface AuthContext {
  user: User;
  organization: Organization;
}

