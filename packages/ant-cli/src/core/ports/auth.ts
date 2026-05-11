/**
 * Authentication Port
 * 
 * 사용자 인증 및 인가를 위한 Port 인터페이스
 */

import type { User, Organization } from '../types/user';

export interface AuthPort {
  authenticate(credentials: AuthCredentials): Promise<AuthContext>;
}

// ========================================
// Auth-specific Types
// ========================================

export interface AuthCredentials {
  email?: string;
  token?: string;
  /**
   * Stable user identifier (e.g. OAuth `sub`). When present, downstream
   * `resolveOrganizationId` seeds the consumer-email `personal-${...}`
   * fallback with this id instead of the email, which is durable across
   * email rotations.
   */
  userId?: string;
}

export interface AuthContext {
  user: User;
  organization: Organization;
}

