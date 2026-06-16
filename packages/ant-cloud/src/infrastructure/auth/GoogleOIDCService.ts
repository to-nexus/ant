/**
 * Google OIDC Service
 * 
 * Handles Google OpenID Connect authentication flow
 * - Authorization URL generation (with CSRF state parameter)
 * - Token exchange
 * - ID Token verification
 * - User profile extraction
 */

import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { logger } from '../../../../ant-cli/src/utils/logger';

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

export class GoogleOIDCService {
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
   * 
   * @param state - CSRF protection state parameter (stored server-side for verification)
   */
  getAuthorizationUrl(state: string): string {
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'openid',
        'email',
        'profile'
      ],
      prompt: 'consent',
      state,
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
      logger.error('[GoogleOIDC] Authentication error', { component: 'GoogleOIDC' }, error);
      throw new Error(`Google authentication failed: ${error.message}`);
    }
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
}
