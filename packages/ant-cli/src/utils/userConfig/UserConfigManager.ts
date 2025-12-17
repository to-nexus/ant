/**
 * User Config Manager
 * 
 * User-level 설정을 통합 관리하는 Facade 클래스입니다.
 * credentials, integrations, preferences를 한 곳에서 관리합니다.
 * 
 * 사용 예:
 * ```typescript
 * const userConfig = new UserConfigManager(workspaceRoot);
 * 
 * // Credentials
 * await userConfig.credentials.set(userContext, 'github', { token: 'ghp_...' });
 * const githubCreds = await userConfig.credentials.get(userContext, 'github');
 * 
 * // Integrations
 * await userConfig.integrations.set(userContext, 'figma', { enabled: true, serverUrl: '...' });
 * 
 * // Preferences
 * await userConfig.preferences.update(userContext, { theme: 'dark' });
 * ```
 */

import { UserContext } from '../../core/types/user';
import { CredentialsStore } from './CredentialsStore';
import { IntegrationsStore } from './IntegrationsStore';
import { PreferencesStore } from './PreferencesStore';
import {
  UserCredentials,
  UserIntegrations,
  UserPreferences,
  ServiceType,
  GitHubCredentials,
  FigmaCredentials,
  GitHubIntegration,
  FigmaIntegration
} from './types';

export class UserConfigManager {
  public readonly credentials: CredentialsStore;
  public readonly integrations: IntegrationsStore;
  public readonly preferences: PreferencesStore;
  
  constructor(workspaceRoot: string) {
    this.credentials = new CredentialsStore(workspaceRoot);
    this.integrations = new IntegrationsStore(workspaceRoot);
    this.preferences = new PreferencesStore(workspaceRoot);
  }
  
  /**
   * Get complete user configuration
   */
  async getAll(userContext: UserContext): Promise<{
    credentials: UserCredentials;
    integrations: UserIntegrations;
    preferences: UserPreferences;
  }> {
    const [credentials, integrations, preferences] = await Promise.all([
      this.credentials.getAll(userContext),
      this.integrations.getAll(userContext),
      this.preferences.get(userContext)
    ]);
    
    return { credentials, integrations, preferences };
  }
  
  /**
   * Reset all user configuration
   */
  async resetAll(userContext: UserContext): Promise<void> {
    await Promise.all([
      this.credentials.deleteAll(userContext),
      this.integrations.reset(userContext),
      this.preferences.reset(userContext)
    ]);
    
    console.log('[UserConfigManager] ✅ All user configuration reset');
  }
  
  /**
   * Configure service (credentials + integration settings)
   */
  async configureService<
    C extends GitHubCredentials | FigmaCredentials,
    I extends GitHubIntegration | FigmaIntegration
  >(
    userContext: UserContext,
    service: ServiceType,
    credentials: Omit<C, 'updatedAt'>,
    integrationSettings: Partial<I>
  ): Promise<void> {
    await Promise.all([
      this.credentials.set(userContext, service, credentials),
      this.integrations.set(userContext, service, integrationSettings)
    ]);
    
    // Update enabled integrations in preferences
    const prefs = await this.preferences.get(userContext);
    const enabledIntegrations = prefs.enabledIntegrations || [];
    
    if (!enabledIntegrations.includes(service)) {
      await this.preferences.update(userContext, {
        enabledIntegrations: [...enabledIntegrations, service]
      });
    }
    
    console.log(`[UserConfigManager] ✅ ${service} configured successfully`);
  }
  
  /**
   * Remove service completely (credentials + integration settings)
   */
  async removeService(userContext: UserContext, service: ServiceType): Promise<void> {
    await Promise.all([
      this.credentials.delete(userContext, service),
      this.integrations.delete(userContext, service)
    ]);
    
    // Remove from enabled integrations in preferences
    const prefs = await this.preferences.get(userContext);
    const enabledIntegrations = prefs.enabledIntegrations || [];
    
    await this.preferences.update(userContext, {
      enabledIntegrations: enabledIntegrations.filter(s => s !== service)
    });
    
    console.log(`[UserConfigManager] ✅ ${service} removed completely`);
  }
  
  /**
   * Check if service is fully configured
   */
  async isServiceConfigured(userContext: UserContext, service: ServiceType): Promise<boolean> {
    const [hasCredentials, integrationSettings] = await Promise.all([
      this.credentials.has(userContext, service),
      this.integrations.get(userContext, service)
    ]);
    
    return hasCredentials && integrationSettings.enabled;
  }
  
  /**
   * Get service status summary
   */
  async getServiceStatus(userContext: UserContext, service: ServiceType): Promise<{
    configured: boolean;
    hasCredentials: boolean;
    enabled: boolean;
    settings: any;
  }> {
    const [hasCredentials, integrationSettings] = await Promise.all([
      this.credentials.has(userContext, service),
      this.integrations.get(userContext, service)
    ]);
    
    return {
      configured: hasCredentials && integrationSettings.enabled,
      hasCredentials,
      enabled: integrationSettings.enabled,
      settings: integrationSettings
    };
  }
  
  /**
   * List all configured services
   */
  async listConfiguredServices(userContext: UserContext): Promise<ServiceType[]> {
    const credentialServices = await this.credentials.list(userContext);
    const prefs = await this.preferences.get(userContext);
    const enabledIntegrations = prefs.enabledIntegrations || [];
    
    // Return services that have both credentials and are enabled
    return credentialServices.filter(service => enabledIntegrations.includes(service));
  }
}

