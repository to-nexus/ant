/**
 * CommandExecutionHandler - Handles command execution notifications in job workers
 * 
 * Manages command start/stream/complete operations with real-time updates.
 */

import type { SessionStore } from './SessionStore';
import type { MessageBroadcaster } from '../chat/MessageBroadcaster';
import type { ContentMerger } from '../chat/ContentMerger';
import type { MessageContent, ChatSession } from '../chat/types';
import type { CommandExecutionPhase } from './types';
import { logger } from '../../utils/logger';

export class CommandExecutionHandler {
  private activeCommands: Map<string, number> = new Map();  // command -> contentIndex

  constructor(
    private sessionStore: SessionStore,
    private broadcaster: MessageBroadcaster,
    private contentMerger?: ContentMerger
  ) {}

  /**
   * Start command execution (loading card)
   * Returns the content index for merging
   */
  async startCommand(command: string): Promise<number> {
    return this.addCommandExecution(command, 'running', {});
  }

  /**
   * Stream command output (real-time)
   */
  async streamCommandOutput(command: string, output: string): Promise<void> {
    await this.addCommandExecution(command, 'streaming', { output });
  }

  /**
   * Complete command execution (final state, collapsible)
   */
  async completeCommand(command: string, output: string, exitCode: number): Promise<void> {
    await this.addCommandExecution(command, 'complete', { output, exitCode });
  }

  /**
   * Core method: Add command execution notification
   */
  private async addCommandExecution(
    command: string,
    phase: CommandExecutionPhase,
    options: {
      output?: string;
      exitCode?: number;
    }
  ): Promise<number> {
    const session = this.sessionStore.getSession();
    const ctx = this.sessionStore.getContext();

    if (!session || !session.currentMessage) {
      logger.warn(`No active message for command execution`, { 
        component: 'CommandExecutionHandler',
        projectId: ctx.projectId,
        featureName: ctx.featureName
      });
      return -1;
    }

    // Try to update existing in-progress command
    const existingIndex = this.activeCommands.get(command);
    
    if (existingIndex !== undefined && existingIndex !== -1) {
      // Update existing content
      const existingContent = session.currentMessage.contents[existingIndex];
      
      if (existingContent) {
        const newType = this.determineContentType(phase);
        const oldOutput = existingContent.content || '';
        const newOutput = options.output !== undefined ? options.output : oldOutput;
        
        session.currentMessage.contents[existingIndex] = {
          type: newType,
          content: newOutput,
          metadata: {
            command,
            exitCode: options.exitCode,
            timestamp: new Date().toISOString()
          }
        };
        
        // Broadcast incremental update for streaming phase
        if (phase === 'streaming' && options.output !== undefined && oldOutput !== newOutput) {
          const delta = newOutput.startsWith(oldOutput) ? newOutput.substring(oldOutput.length) : newOutput;
          
          this.broadcaster.broadcast(ctx.projectId, ctx.featureName, {
            type: 'content_append',
            messageId: session.currentMessage.id,
            contentIndex: existingIndex,
            delta: delta
          }, ctx.userContext);
        } else {
          // Full content update
          this.broadcaster.broadcastContentUpdate(
            ctx.projectId,
            ctx.featureName,
            session.currentMessage.id,
            existingIndex,
            session.currentMessage.contents[existingIndex],
            ctx.userContext
          );
        }
        
        // Clean up tracking on complete
        if (phase === 'complete') {
          this.activeCommands.delete(command);
        }
        
        // Update Redis asynchronously
        this.sessionStore.updateCurrentMessage().catch(err => {
          logger.warn(`Failed to update current message in Redis`, { 
            component: 'CommandExecutionHandler' 
          }, err);
        });
        
        return existingIndex;
      }
    }
    
    // Add new command content
    return this.addNewCommand(session, command, phase, options);
  }

  /**
   * Add new command execution content
   */
  private addNewCommand(
    session: ChatSession,
    command: string,
    phase: CommandExecutionPhase,
    options: {
      output?: string;
      exitCode?: number;
    }
  ): number {
    const ctx = this.sessionStore.getContext();
    const type = this.determineContentType(phase);

    const messageContent: MessageContent = {
      type,
      content: options.output || '',
      metadata: {
        command,
        exitCode: options.exitCode,
        timestamp: new Date().toISOString()
      }
    };

    // Use ContentMerger to properly handle placeholder removal.
    // Without this, placeholders injected by startMessage() persist alongside command cards.
    let contentIndex: number;
    if (this.contentMerger) {
      contentIndex = this.contentMerger.addContent(
        ctx.projectId, ctx.featureName, session, messageContent
      );
    } else {
      // Fallback: direct push (should not happen in normal flow)
      contentIndex = session.currentMessage!.contents.length;
      session.currentMessage!.contents.push(messageContent);
      this.broadcaster.broadcastContentAdd(
        ctx.projectId,
        ctx.featureName,
        session.currentMessage!.id,
        messageContent,
        ctx.userContext
      );
    }

    // Track for streaming updates
    if (phase !== 'complete') {
      this.activeCommands.set(command, contentIndex);
    }
    
    // Update Redis asynchronously
    this.sessionStore.updateCurrentMessage().catch(err => {
      logger.warn(`Failed to update current message in Redis`, { 
        component: 'CommandExecutionHandler' 
      }, err);
    });

    return contentIndex;
  }

  /**
   * Determine content type based on phase
   */
  private determineContentType(phase: CommandExecutionPhase): MessageContent['type'] {
    switch (phase) {
      case 'running':
        return 'command_running';
      case 'streaming':
        return 'command_streaming';
      case 'complete':
        return 'command';
      default:
        return 'command';
    }
  }
}
