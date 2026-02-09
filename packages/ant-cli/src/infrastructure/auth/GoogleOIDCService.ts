/**
 * Google OIDC Service
 * 
 * Handles Google OpenID Connect authentication flow
 * - Authorization URL generation
 * - Token exchange
 * - ID Token verification
 * - User profile extraction
 */

import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { AuthPort, AuthCredentials, AuthContext } from '../../core/ports/auth';
import type { User, Organization } from '../../core/types/user';

export interface GoogleOIDCConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OIDCUser {
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  sub: string; // Google user ID
}

export class GoogleOIDCService implements AuthPort {
  private oauth2Client: OAuth2Client;
  private config: GoogleOIDCConfig;
  
  constructor(config: GoogleOIDCConfig) {
    this.config = config;
    this.oauth2Client = new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );
  }
  
  /**
   * Generate Google OAuth2 authorization URL
   * User will be redirected to this URL to sign in with Google
   */
  getAuthorizationUrl(): string {
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'openid',
        'email',
        'profile'
      ],
      prompt: 'consent'
    });
    
    return url;
  }
  
  /**
   * Exchange authorization code for tokens
   * Extract user information from ID token
   */
  async authenticateWithCode(code: string): Promise<OIDCUser> {
    try {
      // Exchange code for tokens
      const { tokens } = await this.oauth2Client.getToken(code);
      
      if (!tokens.id_token) {
        throw new Error('No ID token received from Google');
      }
      
      // Verify and decode ID token
      const ticket = await this.oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.clientId
      });
      
      const payload = ticket.getPayload();
      
      if (!payload) {
        throw new Error('Invalid ID token payload');
      }
      
      return this.extractUserFromPayload(payload);
    } catch (error: any) {
      console.error('[GoogleOIDC] Authentication error:', error);
      throw new Error(`Google authentication failed: ${error.message}`);
    }
  }
  
  /**
   * Authenticate with email (fallback)
   */
  async authenticate(credentials: AuthCredentials): Promise<AuthContext> {
    if (credentials.email) {
      // Legacy email-based authentication
      return this.authenticateWithEmail(credentials.email);
    }
    
    throw new Error('Authentication requires email or authorization code');
  }
  
  /**
   * Authorize user access to resources
   * Initial version: all authenticated users have full access
   */
  async authorize(user: User, resource: string, action: string): Promise<boolean> {
    // TODO: Implement role-based access control
    return true;
  }
  
  // ========================================
  // Private Methods
  // ========================================
  
  /**
   * Extract user information from OIDC token payload
   */
  private extractUserFromPayload(payload: TokenPayload): OIDCUser {
    if (!payload.email) {
      throw new Error('Email not provided by Google');
    }
    
    return {
      email: payload.email,
      emailVerified: payload.email_verified || false,
      name: payload.name,
      picture: payload.picture,
      sub: payload.sub
    };
  }
  
  /**
   * Email-based authentication
   */
  private async authenticateWithEmail(email: string): Promise<AuthContext> {
    const normalizedEmail = email.trim().toLowerCase();
    
    if (!this.isValidEmail(normalizedEmail)) {
      throw new Error('Invalid email format');
    }
    
    const [username, domain] = normalizedEmail.split('@');
    
    if (!username || !domain) {
      throw new Error('Invalid email format');
    }
    
    // Organization is the full domain (e.g., gmail.com, company.com)
    const organizationId = domain;
    
    const user: User = {
      id: username,
      email: normalizedEmail,
      organizationId: organizationId
    };
    
    const organization: Organization = {
      id: organizationId,
      name: organizationId
    };
    
    return {
      user,
      organization
    };
  }
  
  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
