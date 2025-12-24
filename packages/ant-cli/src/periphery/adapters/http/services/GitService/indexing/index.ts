import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../core/types/user';
import { SSEService } from '../../SSEService';
import { ChatService } from '../../ChatService';
import { GitHelper } from '../helper/GitHelper';

/**
 * IndexService
 * 
 * Handles Git repository indexing for AI/LLM context
 */
export class IndexService {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly sseService?: SSEService;
  private readonly chatService?: ChatService;
  
  constructor(
    workspaceResolver: WorkspaceResolver,
    sseService?: SSEService,
    chatService?: ChatService
  ) {
    this.workspaceResolver = workspaceResolver;
    this.sseService = sseService;
    this.chatService = chatService;
  }
  
  /**
   * Auto-index new branch
   * TODO: Move implementation from ProjectService.ts line 2312-2456
   */
  private async autoIndexNewBranch(
    projectId: string,
    codebasePath: string,
    branchName: string,
    baseBranch: string,
    userContext: UserContext,
    featureName: string
  ): Promise<void> {
    throw new Error('Not implemented yet - to be migrated');
  }
  
  /**
   * Auto-index codebase
   * 
   * Indexes the entire codebase for AI/LLM context.
   * - If featureName is provided, sends status to chat UI
   * - If featureName is undefined, sends status via SSE project broadcast
   * 
   * @param projectId - Project identifier
   * @param codebasePath - Path to codebase directory
   * @param userContext - User context
   * @param featureName - Optional feature name for chat feedback
   */
  async autoIndexCodebase(
    projectId: string,
    codebasePath: string,
    userContext: UserContext,
    featureName?: string
  ): Promise<void> {
    // ✅ Prepare chat message for UI feedback
    let messageId: string | undefined;
    
    try {
      console.log(`\n📇 [GitIndexService] Starting codebase indexing for ${projectId}...`);
      
      // ✅ Send indexing status to chat UI (if chat service and feature available)
      if (this.chatService && featureName) {
        // Create assistant message for indexing feedback
        messageId = this.chatService.startAssistantMessage(projectId, featureName, 'push-index-' + Date.now(), userContext);
      }
      
      // Import dependencies
      const { CodebaseIndexer } = await import('../../../../../../core/codebase/CodebaseIndexer');
      const { AdapterFactory } = await import('../../../../../../infrastructure/adapters/AdapterFactory');
      
      // Initialize adapters using factory
      const git = AdapterFactory.createGitAdapter(codebasePath, projectId);
      const vectorDB = AdapterFactory.createMemoryAdapter();
      const chunk = AdapterFactory.createChunkAdapter();
      
      // Get branch and commit info for status message
      const branch = await git.getCurrentBranch();
      const commitHash = await git.getCurrentCommit();
      const commit = commitHash.substring(0, 8);
      
      // ✅ Send "indexing" status to UI
      if (this.chatService && featureName) {
        this.chatService.addContentToCurrentMessage(projectId, featureName, {
          type: 'indexing',
          content: '',
          metadata: {
            message: `${projectId} • ${branch}`,
            repoName: projectId,
            branch,
            commit
          }
        });
      } else if (this.sseService) {
        // ✅ CRITICAL: For git init/clone (no feature context), send project-level notification
        this.sseService.broadcastToProject(projectId, {
          type: 'indexing_status',
          status: 'in_progress',
          data: {
            projectId,
            branch,
            commit,
            message: `Indexing ${projectId} • ${branch}`
          }
        });
      }
      
      // Run indexer
      const indexer = new CodebaseIndexer();
      const stats = await indexer.index(
        { git, vectorDB, chunk },
        {
          project: projectId,
          workingDir: codebasePath
        }
      );
      
      console.log(`✅ [GitIndexService] Codebase indexed successfully!`);
      console.log(`   Files: ${stats.filesIndexed}, Chunks: ${stats.chunksCreated}, Tokens: ~${stats.estimatedTokens}`);
      console.log(`   Duration: ${(stats.duration / 1000).toFixed(1)}s\n`);
      
      // ✅ Send "indexed" success status to UI
      if (this.chatService && featureName) {
        this.chatService.addContentToCurrentMessage(projectId, featureName, {
          type: 'indexed',
          content: `Codebase indexed`, // ✅ Add content for ResultCard header
          metadata: {
            filesIndexed: stats.filesIndexed,
            chunks: stats.chunksCreated,
            tokens: stats.estimatedTokens,
            duration: stats.duration,
            repoName: projectId,
            branch,
            commit
          }
        });
        
        // ✅ Complete the message
        this.chatService.finalizeCurrentMessage(projectId, featureName);
      } else if (this.sseService) {
        // ✅ CRITICAL: For git init/clone (no feature context), send project-level notification
        this.sseService.broadcastToProject(projectId, {
          type: 'indexing_status',
          status: 'completed',
          data: {
            projectId,
            branch,
            commit,
            filesIndexed: stats.filesIndexed,
            chunks: stats.chunksCreated,
            tokens: stats.estimatedTokens,
            duration: stats.duration,
            message: `Indexed ${stats.filesIndexed} files (${stats.chunksCreated} chunks, ~${stats.estimatedTokens} tokens)`
          }
        });
      }
      
    } catch (error) {
      // ⚠️  Non-blocking: Operation was successful, but indexing failed
      console.error('⚠️  [GitIndexService] Failed to index codebase:', error instanceof Error ? error.message : error);
      console.log('   Operation was successful, but indexing failed. You can manually run: ant index ' + projectId + '\n');
      
      // ✅ Send "indexed" failure status to UI
      if (this.chatService && featureName) {
        this.chatService.addContentToCurrentMessage(projectId, featureName, {
          type: 'indexed',
          content: '',
          metadata: {
            filesIndexed: 0,
            chunks: 0,
            tokens: 0,
            duration: 0,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });
        
        // ✅ Complete the message
        this.chatService.finalizeCurrentMessage(projectId, featureName);
      } else if (this.sseService) {
        // ✅ Send failure notification via SSE
        this.sseService.broadcastToProject(projectId, {
          type: 'indexing_status',
          status: 'failed',
          data: {
            projectId,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    }
  }
  
  /**
   * Perform full indexing
   * TODO: Move implementation from ProjectService.ts line 2457-2509
   */
  private async performFullIndexing(
    projectId: string,
    codebasePath: string,
    userContext: UserContext
  ): Promise<void> {
    throw new Error('Not implemented yet - to be migrated');
  }
  
  /**
   * Perform fast copy
   * TODO: Move implementation from ProjectService.ts line 2510-2560
   */
  private async performFastCopy(
    projectId: string,
    sourceBranch: string,
    targetBranch: string,
    userContext: UserContext
  ): Promise<void> {
    throw new Error('Not implemented yet - to be migrated');
  }
  
  /**
   * Update base branch
   * TODO: Move implementation from ProjectService.ts line 2561-2604
   */
  private async updateBaseBranch(
    projectId: string,
    codebasePath: string,
    baseBranch: string,
    userContext: UserContext
  ): Promise<void> {
    throw new Error('Not implemented yet - to be migrated');
  }
}

