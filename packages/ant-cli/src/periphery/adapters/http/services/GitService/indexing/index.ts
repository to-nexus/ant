import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../core/config/WorkspacePathResolver';
import { isVectorDbEnabled } from '../../../../../../core/config/vectorDbCapability';
import { UserContext } from '../../../../../../core/types/user';
import { ChatService } from '../../ChatService';
import { GitHelper } from '../helper/GitHelper';
import { logger } from '../../../../../../utils/logger';

/**
 * IndexService
 * 
 * Handles Git repository indexing for AI/LLM context
 */
export class IndexService {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly chatService?: ChatService;
  
  constructor(
    workspaceResolver: WorkspaceResolver,
    chatService?: ChatService
  ) {
    this.workspaceResolver = workspaceResolver;
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
    if (!isVectorDbEnabled()) {
      logger.info(
        `Skipping codebase indexing (ANT_VECTOR_DB_ENABLED=false)`,
        { component: 'GitIndexService', organizationId: userContext.organizationId, userId: userContext.userId, projectId }
      );
      return;
    }

    try {
      logger.info(`Starting codebase indexing`, { component: 'GitIndexService', organizationId: userContext.organizationId, userId: userContext.userId, projectId });

      // chat-SSOT §5: chat feedback for git push indexing has been
      // removed. The legacy `addContentToCurrentMessage` path required
      // a job-bound currentMessage scratchpad that no longer exists,
      // and indexing runs outside any user_turn so we cannot anchor a
      // chat_status line in chat.jsonl. Surfacing index progress to
      // the UI is being redesigned alongside the Phase 11 git-status
      // notification work; until then, indexing happens silently.
      void featureName;

      const { CodebaseIndexer } = await import('../../../../../../core/codebase/CodebaseIndexer');
      const { AdapterFactory } = await import('../../../../../../infrastructure/adapters/AdapterFactory');

      const git = AdapterFactory.createGitAdapter(codebasePath, projectId);
      const vectorDB = AdapterFactory.createMemoryAdapter();
      const chunk = AdapterFactory.createChunkAdapter();

      const indexer = new CodebaseIndexer();
      const stats = await indexer.index(
        { git, vectorDB, chunk },
        {
          project: projectId,
          workingDir: codebasePath,
        }
      );

      logger.info(
        `Codebase indexed successfully (files=${stats.filesIndexed}, chunks=${stats.chunksCreated}, tokens~=${stats.estimatedTokens}, durationSec=${(stats.duration / 1000).toFixed(1)})`,
        { component: 'GitIndexService', organizationId: userContext.organizationId, userId: userContext.userId, projectId }
      );
    } catch (error) {
      logger.warn(
        `Failed to index codebase (non-blocking): ${error instanceof Error ? error.message : String(error)}`,
        { component: 'GitIndexService', organizationId: userContext.organizationId, userId: userContext.userId, projectId },
        error
      );
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

