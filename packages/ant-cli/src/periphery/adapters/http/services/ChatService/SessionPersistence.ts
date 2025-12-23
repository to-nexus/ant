/**
 * SessionPersistence - Handles chat session file I/O
 * 
 * Manages loading and saving chat sessions to disk
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import type { UserContext } from '../../../../../core/types/user';
import type { ChatSessionFile, ChatMessage } from './types';
import { BASE_BRANCH_NAMES } from './types';

export class SessionPersistence {
  constructor(
    private workspaceResolver?: WorkspaceResolver
  ) {}

  /**
   * Get chat file path for a project/feature
   */
  getChatFilePath(projectId: string, featureName: string, userContext?: UserContext): string {
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }
    
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    return path.join(featurePath, 'sessions', 'chat.json');
  }

  /**
   * Load chat session from file
   */
  loadSession(projectId: string, featureName: string, userContext?: UserContext): ChatSessionFile | null {
    const filePath = this.getChatFilePath(projectId, featureName, userContext);
    
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const sessionFile = JSON.parse(content) as ChatSessionFile;
      
      // Mark all loaded messages as complete (they're from file, not streaming)
      sessionFile.messages = sessionFile.messages.map(msg => ({
        ...msg,
        isComplete: true,
        isStreaming: undefined
      }));
      
      return sessionFile;
    } catch (error) {
      console.error(`❌ [SessionPersistence] Failed to load chat file for ${projectId}/${featureName}:`, error);
      return null;
    }
  }

  /**
   * Save chat session to file
   */
  saveSession(
    projectId: string, 
    featureName: string, 
    messages: ChatMessage[], 
    userContext?: UserContext
  ): void {
    // Skip saving chat for base branches (learning only, no chat history needed)
    if (BASE_BRANCH_NAMES.includes(featureName.toLowerCase())) {
      console.log(`[SessionPersistence] Skipping chat save for base branch: ${featureName}`);
      return;
    }
    
    const filePath = this.getChatFilePath(projectId, featureName, userContext);
    
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Load existing file to preserve createdAt
      let createdAt = new Date().toISOString();
      const existing = this.loadSession(projectId, featureName, userContext);
      if (existing) {
        createdAt = existing.createdAt;
      }

      const sessionFile: ChatSessionFile = {
        projectId,
        featureName,
        messages: messages.map(msg => ({
          ...msg,
          isStreaming: undefined // Don't persist streaming flag
        })),
        createdAt,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(filePath, JSON.stringify(sessionFile, null, 2), 'utf-8');
    } catch (error) {
      console.error(`❌ [SessionPersistence] Failed to save chat file for ${projectId}/${featureName}:`, error);
    }
  }

  /**
   * Delete chat session file
   */
  deleteSession(projectId: string, featureName: string, userContext?: UserContext): boolean {
    const filePath = this.getChatFilePath(projectId, featureName, userContext);
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️  [SessionPersistence] Deleted chat file for ${projectId}/${featureName}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ [SessionPersistence] Failed to delete chat file for ${projectId}/${featureName}:`, error);
      return false;
    }
  }

  /**
   * Check if session file exists
   */
  sessionExists(projectId: string, featureName: string, userContext?: UserContext): boolean {
    const filePath = this.getChatFilePath(projectId, featureName, userContext);
    return fs.existsSync(filePath);
  }
}

