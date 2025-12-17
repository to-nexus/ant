/**
 * Preferences Store
 * 
 * User-level UI 개인 설정을 저장/관리합니다.
 * 
 * 파일 위치: workspaces/{org}/{user}/.ant/preferences.json
 * 암호화: 불필요 (평문 저장)
 * 권한: 0o644 (owner 읽기/쓰기, 타인 읽기)
 */

import * as fs from 'fs';
import * as path from 'path';
import { UserContext } from '../../core/types/user';
import { UserPreferences } from './types';

export class PreferencesStore {
  private readonly workspaceRoot: string;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }
  
  /**
   * Get user preferences (with defaults)
   */
  async get(userContext: UserContext): Promise<UserPreferences> {
    const preferencesPath = this.getPreferencesPath(userContext);
    
    if (!fs.existsSync(preferencesPath)) {
      return this.getDefaults();
    }
    
    try {
      const content = await fs.promises.readFile(preferencesPath, 'utf-8');
      const stored = JSON.parse(content);
      return { ...this.getDefaults(), ...stored };
    } catch (error) {
      console.error('[PreferencesStore] Error reading preferences:', error);
      return this.getDefaults();
    }
  }
  
  /**
   * Update user preferences (partial update)
   */
  async update(
    userContext: UserContext,
    updates: Partial<UserPreferences>
  ): Promise<void> {
    const current = await this.get(userContext);
    
    const updated: UserPreferences = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    await this.save(userContext, updated);
    console.log('[PreferencesStore] ✅ Preferences updated');
  }
  
  /**
   * Reset preferences to defaults
   */
  async reset(userContext: UserContext): Promise<void> {
    const preferencesPath = this.getPreferencesPath(userContext);
    
    if (fs.existsSync(preferencesPath)) {
      await fs.promises.unlink(preferencesPath);
      console.log('[PreferencesStore] ✅ Preferences reset to defaults');
    }
  }
  
  /**
   * Save user preferences
   */
  private async save(userContext: UserContext, preferences: UserPreferences): Promise<void> {
    const preferencesPath = this.getPreferencesPath(userContext);
    
    // Create directory if not exists
    await fs.promises.mkdir(path.dirname(preferencesPath), { recursive: true });
    
    // Save as formatted JSON
    await fs.promises.writeFile(
      preferencesPath,
      JSON.stringify(preferences, null, 2),
      { mode: 0o644 }
    );
  }
  
  /**
   * Get preferences file path
   */
  private getPreferencesPath(userContext: UserContext): string {
    return path.join(
      this.workspaceRoot,
      userContext.organizationId,
      userContext.userId,
      '.ant',
      'preferences.json'
    );
  }
  
  /**
   * Get default preferences
   */
  private getDefaults(): UserPreferences {
    return {
      // UI Settings
      theme: 'system',
      language: 'en',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      
      // Editor Settings
      editorFontSize: 14,
      editorFontFamily: 'Monaco, Menlo, "Courier New", monospace',
      editorTheme: 'vs-dark',
      editorTabSize: 2,
      editorWordWrap: true,
      
      // Workflow Settings
      defaultAgent: 'architect',
      defaultTask: 'code',
      autoSaveInterval: 5000,
      
      // Notification Settings
      enableNotifications: true,
      notificationSound: false,
      desktopNotifications: false,
      
      // Integration Toggles
      enabledIntegrations: [],
      
      // Advanced
      betaFeatures: false,
      telemetry: true,
      
      // Metadata
      updatedAt: new Date().toISOString()
    };
  }
}

