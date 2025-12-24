/**
 * CommandExecutionHandler - Handles command execution notifications
 * 
 * Manages command execution status and output streaming
 */

import type { CommandExecutionPhase, MessageContent } from './types';
import type { MessageManager } from './MessageManager';

export class CommandExecutionHandler {
  constructor(private messageManager: MessageManager) {}

  /**
   * Add command execution notification
   */
  addCommandExecution(
    projectId: string,
    featureName: string,
    command: string,
    output?: string,
    exitCode?: number,
    phase?: CommandExecutionPhase,
    _mergeIndex?: number
  ): number {
    // Determine content type based on phase
    let type: MessageContent['type'];
    
    if (phase === 'running') {
      type = 'command_running';
    } else if (phase === 'streaming') {
      type = 'command_streaming';
    } else {
      // phase === 'complete' or legacy (no phase)
      type = 'command';
    }

    return this.messageManager.addContentToCurrentMessage(projectId, featureName, {
      type,
      content: output || '',
      metadata: {
        command,
        exitCode,
        timestamp: new Date().toISOString(),
        _mergeIndex
      }
    });
  }
}


