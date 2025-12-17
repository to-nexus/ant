/**
 * Integrations Store
 * 
 * User-level 통합 설정을 저장/관리합니다.
 * 인증 정보를 제외한 각 서비스의 설정값들을 관리합니다.
 * 
 * 파일 위치: workspaces/{org}/{user}/.ant/integrations.json
 * 암호화: 불필요 (평문 저장)
 * 권한: 0o644 (owner 읽기/쓰기, 타인 읽기)
 */

import * as fs from 'fs';
import * as path from 'path';
import { UserContext } from '../../core/types/user';
import {
  UserIntegrations,
  GitHubIntegration,
  FigmaIntegration,
  LinearIntegration,
  SlackIntegration,
  ServiceType
} from './types';

export class IntegrationsStore {
  private readonly workspaceRoot: string;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }
  
  /**
   * Get all integrations for user
   */
  async getAll(userContext: UserContext): Promise<UserIntegrations> {
    const integrationsPath = this.getIntegrationsPath(userContext);
    
    if (!fs.existsSync(integrationsPath)) {
      return this.getDefaults();
    }
    
    try {
      const content = await fs.promises.readFile(integrationsPath, 'utf-8');
      const stored = JSON.parse(content);
      return { ...this.getDefaults(), ...stored };
    } catch (error) {
      console.error('[IntegrationsStore] Error reading integrations:', error);
      return this.getDefaults();
    }
  }
  
  /**
   * Get integration settings for specific service
   */
  async get<T extends GitHubIntegration | FigmaIntegration | LinearIntegration | SlackIntegration>(
    userContext: UserContext,
    service: ServiceType
  ): Promise<T> {
    const all = await this.getAll(userContext);
    return (all[service] || this.getServiceDefaults(service)) as T;
  }
  
  /**
   * Set integration settings for specific service
   */
  async set<T extends GitHubIntegration | FigmaIntegration | LinearIntegration | SlackIntegration>(
    userContext: UserContext,
    service: ServiceType,
    settings: Partial<T>
  ): Promise<void> {
    const all = await this.getAll(userContext);
    const current = all[service] || this.getServiceDefaults(service);
    
    all[service] = { ...current, ...settings } as any;
    
    await this.saveAll(userContext, all);
    console.log(`[IntegrationsStore] ✅ ${service} integration settings updated`);
  }
  
  /**
   * Delete integration settings for specific service
   */
  async delete(userContext: UserContext, service: ServiceType): Promise<void> {
    const all = await this.getAll(userContext);
    delete all[service];
    await this.saveAll(userContext, all);
    console.log(`[IntegrationsStore] ✅ ${service} integration settings deleted`);
  }
  
  /**
   * Reset all integrations to defaults
   */
  async reset(userContext: UserContext): Promise<void> {
    const integrationsPath = this.getIntegrationsPath(userContext);
    
    if (fs.existsSync(integrationsPath)) {
      await fs.promises.unlink(integrationsPath);
      console.log('[IntegrationsStore] ✅ All integration settings reset');
    }
  }
  
  /**
   * Enable/disable service integration
   */
  async setEnabled(userContext: UserContext, service: ServiceType, enabled: boolean): Promise<void> {
    const current = await this.get(userContext, service);
    await this.set(userContext, service, { ...current, enabled });
  }
  
  /**
   * Check if service is enabled
   */
  async isEnabled(userContext: UserContext, service: ServiceType): Promise<boolean> {
    const settings = await this.get(userContext, service);
    return settings.enabled;
  }
  
  /**
   * Save all integrations
   */
  private async saveAll(userContext: UserContext, integrations: UserIntegrations): Promise<void> {
    const integrationsPath = this.getIntegrationsPath(userContext);
    
    // Create directory if not exists
    await fs.promises.mkdir(path.dirname(integrationsPath), { recursive: true });
    
    // Save as formatted JSON
    await fs.promises.writeFile(
      integrationsPath,
      JSON.stringify(integrations, null, 2),
      { mode: 0o644 }
    );
  }
  
  /**
   * Get integrations file path
   */
  private getIntegrationsPath(userContext: UserContext): string {
    return path.join(
      this.workspaceRoot,
      userContext.organizationId,
      userContext.userId,
      '.ant',
      'integrations.json'
    );
  }
  
  /**
   * Get default integrations settings
   */
  private getDefaults(): UserIntegrations {
    return {
      github: this.getServiceDefaults('github') as GitHubIntegration,
      figma: this.getServiceDefaults('figma') as FigmaIntegration,
      linear: this.getServiceDefaults('linear') as LinearIntegration,
      slack: this.getServiceDefaults('slack') as SlackIntegration
    };
  }
  
  /**
   * Get default settings for specific service
   */
  private getServiceDefaults(service: ServiceType): any {
    const defaults: Record<ServiceType, any> = {
      github: {
        enabled: false,
        defaultVisibility: 'private',
        autoCreateRepo: false,
        autoSync: false,
        syncInterval: 5
      },
      figma: {
        enabled: false,
        serverUrl: 'https://figma-mcp.figma.com',
        serverType: 'remote',
        defaultFileFormat: 'svg',
        autoExtractTokens: false,
        autoGenerateCode: false
      },
      linear: {
        enabled: false,
        autoCreateIssues: false,
        syncLabels: false
      },
      slack: {
        enabled: false,
        notifyOnJobStart: false,
        notifyOnJobComplete: true,
        notifyOnError: true
      }
    };
    
    return defaults[service];
  }
}

