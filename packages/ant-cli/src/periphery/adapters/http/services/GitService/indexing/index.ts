import { WorkspaceResolver } from '../../../../../../core/config/WorkspacePathResolver';
import { isVectorDbEnabled } from '../../../../../../core/config/vectorDbCapability';
import { UserContext } from '../../../../../../core/types/user';
import { ChatService } from '../../ChatService';
import { logger } from '../../../../../../utils/logger';

/**
 * IndexService — git-aware codebase indexing for AI/LLM context.
 *
 * Vector-DB capability gate: every public method short-circuits when
 * `isVectorDbEnabled()` is false (see `core/config/vectorDbCapability.ts`
 * for the SSOT).
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
}
