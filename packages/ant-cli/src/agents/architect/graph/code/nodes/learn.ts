import * as path from "path";
import { ArchitectGraphState } from "../state";
import { SessionTurn } from "../../../../../core/types";
import { errorStatsCollector, formatStatistics } from "./diagnostics/errorStats";
import { getChatAPIClient } from "../../../../../core/adapters/ChatAPIClient";

/**
 * ✅ Global queue for async lesson storage tasks to prevent memory explosion
 * Limits concurrent lesson operations to 2 at a time
 */
class LessonQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private readonly maxConcurrent = 2;

  async add(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          await task();
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processNext();
        }
      };

      this.queue.push(wrappedTask);
      this.processNext();
    });
  }

  private processNext(): void {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (task) {
      this.running++;
      task().catch(() => {}); // Errors are handled in wrappedTask
    }
  }

  getStats() {
    return {
      queued: this.queue.length,
      running: this.running,
      total: this.queue.length + this.running
    };
  }
}

const lessonQueue = new LessonQueue();

/**
 * Learn node - Incremental lesson extraction after each task completion:
 * 1. Extract lessons from completed task
 * 2. Store lessons to vector DB (ASYNC - non-blocking)
 * 3. Save turn to session file (for context continuity)
 * 4. Route to next task or end
 * 
 * ✅ NEW: Called after EVERY task completion (not just at the end)
 * ✅ NEW: Async lesson storage - doesn't block workflow progression
 * 
 * NOTE: File saving happens in writeFiles node (before validation)
 * This node focuses purely on lesson extraction/metadata artifacts.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for branch management (not fs directly)
 * - Uses SessionPort for session persistence
 * - Uses ChunkPort for chunking operations
 * - Uses MemoryPort for vector DB storage
 * - No direct infrastructure dependencies
 */
export async function learn(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ CRITICAL: Clean up running servers before completing
  if (state.runningServers && state.runningServers.length > 0) {
    console.log(`\n🧹 [Learn] Cleaning up ${state.runningServers.length} running server(s)...`);
    
    for (const server of state.runningServers) {
      try {
        // Try to kill the entire process tree/group (shell wrappers can leave child servers orphaned)
        if (process.platform === 'win32') {
          try {
            const { spawn } = await import('child_process');
            await new Promise<void>((resolve) => {
              const child = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true
              });
              child.on('exit', () => resolve());
              child.on('error', () => resolve());
            });
          } catch {
            process.kill(server.pid, 'SIGTERM');
          }
        } else {
          // POSIX: first try process group (requires detached=true at spawn)
          try {
            process.kill(-server.pid, 'SIGTERM');
          } catch {
            process.kill(server.pid, 'SIGTERM');
          }
        }
        console.log(`   ✅ Killed: ${server.command} (PID ${server.pid})`);
        
        // Give it a moment to terminate
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check if still running, escalate to SIGKILL
        try {
          process.kill(server.pid, 0);  // Check if process exists
          console.log(`   ⚠️  Process still running, escalating to SIGKILL...`);
          if (process.platform === 'win32') {
            try {
              const { spawn } = await import('child_process');
              await new Promise<void>((resolve) => {
                const child = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
                  stdio: 'ignore',
                  windowsHide: true
                });
                child.on('exit', () => resolve());
                child.on('error', () => resolve());
              });
            } catch {
              process.kill(server.pid, 'SIGKILL');
            }
          } else {
            try {
              process.kill(-server.pid, 'SIGKILL');
            } catch {
              process.kill(server.pid, 'SIGKILL');
            }
          }
        } catch (e) {
          // Process already terminated
        }
      } catch (e: any) {
        if (e.code === 'ESRCH') {
          console.log(`   ℹ️  Already stopped: ${server.command} (PID ${server.pid})`);
        } else {
          console.log(`   ⚠️  Failed to kill ${server.command} (PID ${server.pid}): ${e.message}`);
        }
      }
    }
    
    // Clear the list
    state.runningServers = [];
    console.log(`   ✅ Server cleanup complete\n`);
  }
  
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 
      'learn', 
      (state as any).workerId ?? 0,
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // 0. Generate quality evaluation report (optional, if files were generated)
  const files = state.projectCodeContext?.files || [];
  if (files.length > 0) {
    try {
      const gitPort = state.gitPort || state.deps?.git;
      const fileSystem = state.deps?.fileSystem;
      if (gitPort && fileSystem) {
        const { generateQualityReport } = await import('./utils/qualityReport');
        const report = await generateQualityReport(state, gitPort, fileSystem);
        if (report) {
          state.evaluationReport = report;
        }
      }
    } catch (error) {
      console.warn('⚠️  Quality report generation failed:', error);
    }
  }
  
  // 1. Extract lessons
  const lessons = extractCodeLessons(state);
  
  // Note: Files are already written to disk in writeFiles node
  // This node focuses on lesson artifacts: vector DB + session storage
  
  const gitPort = state.gitPort || state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for branch management");
  }
  
  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  
  // ✅ Enhanced metadata for lesson storage
  const lessonMetadata = {
    relatedFiles: files.map(f => f.path),
    tags: extractTags(lessons, state.directive || ''),
    directive: state.directive,
    taskType: state.currentTask?.type,
    branch: branch
  };
  
  // ✅ Branch is already created by ProjectService.createFeature() when feature is initialized
  // learn node only handles lesson extraction and metadata storage
  
  // Log files that were written in writeFiles
  if (files.length > 0) {
    console.log(`\n✏️  ${files.length} files modified:`);
    for (const f of files) {
      console.log(`   - ${f.path}`);
    }
  }
  
  const filesWritten = files.length;
  
  // 3. Save turn to session file first (to get sessionId and turnId)
  // Skip turn recording in worker context (only main orchestrator should record)
  const _workerId = (state as any).workerId;
  const isWorkerContext = _workerId !== undefined && _workerId !== null;
  
  let sessionId: string | undefined;
  let turnId: number | undefined;
  
  if (state.deps?.session && !isWorkerContext) {
    // Load session to get sessionId
    const session = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'  // ✅ Specify job type
    );
    sessionId = session.sessionId;
    
    // Create input summary (design doc reference)
    const inputSummary = state.design 
      ? `Design: ${state.design.substring(0, 150)}...`
      : `Directive: ${(state.directive || '').substring(0, 150)}...`;
    
    const turn: SessionTurn = {
      turnId: 0, // Will be set by adapter
      job: 'code',
      timestamp: new Date().toISOString(),
      input: {
        type: 'design',
        source: state.design ? 'outputs/design/[latest]' : 'directive',
        summary: inputSummary.substring(0, 200),
        size: state.design?.length || (state.directive || '').length,
      },
      output: {
        branch: branch,
        filesWritten: filesWritten,
        files: files.map(f => f.path),
        modifications: files.length > 0 ? files.map(f => f.path) : []
      }
    };
    
    await state.deps.session.addTurn(
      state.context.project,
      state.context.featureFolder || 'default',
      'code',  // ✅ Specify job type
      turn
    );
    
    // Get the turnId that was assigned
    const updatedSession = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'  // ✅ Specify job type
    );
    turnId = updatedSession.turns[updatedSession.turns.length - 1]?.turnId;
    
    // ✅ Get error statistics
    const errorStats = errorStatsCollector.getStatistics();
    console.log('\n' + formatStatistics(errorStats) + '\n');
    
    // ✅ Load existing session to preserve interruption details
    const existingSession = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'  // ✅ Specify job type
    );
    
    // ✨ Mark job as completed — ONLY set completedAt on the LAST task.
    // Setting it after every task contaminates the session, causing SSE reconnects
    // to serve stale completedAt → frontend isRunning=false → badge freezes.
    const isLastTask = !state.taskQueue || state.taskQueue.isEmpty();
    const completedJobTiming = (state as any).jobTiming ? {
      ...(state as any).jobTiming,
      ...(isLastTask && { completedAt: new Date().toISOString() })
    } : undefined;
    
    // ✅ Build directives array from state.directive (split by separator)
    let directivesArray: string[] = [];
    if (state.directive) {
      if (state.directive.includes('\n\n---\n\n')) {
        directivesArray = state.directive.split('\n\n---\n\n').filter(d => d.trim());
      } else {
        directivesArray = [state.directive];
      }
    }
    
    // Update artifacts and save state snapshot for resuming
    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder || 'default',
      'code',  // ✅ Specify job type
      {
        activeBranch: branch,
        // ✅ Save error statistics
        errorStatistics: errorStats,
        // ✅ Save execution state snapshot for resuming after recursion limit
        state: {
          taskQueue: state.taskQueue?.getAll() || [],
          currentTask: state.currentTask,
          completedTasks: state.completedTasks || [],
          completedTasksDetails: state.completedTasksDetails || [],  // ✅ CRITICAL: Preserve completed task details
          retries: state.retries,
          maxRetries: state.maxRetries,
          previousAttempts: state.previousAttempts || [],
          enforcementHistory: state.enforcementHistory || [],
          lastViolations: state.lastViolations || [],
          previousFileCount: state.previousFileCount,
          resolvedCategories: state.resolvedCategories || [],
          recursionCount: state.recursionCount,  // ✅ Preserve recursion tracking
          recursionLimit: state.recursionLimit,
          interruption: existingSession.state?.interruption || (state as any).interruption,  // ✅ CRITICAL: Preserve interruption details!
          jobId: (state as any).jobId,  // ✨ Preserve jobId
          jobTiming: completedJobTiming,  // ✨ Mark as completed
          tokenUsage: (state as any).tokenUsage,  // ✅ Preserve token usage
          directives: directivesArray,  // ✅ Save directives array (newest first)
          overrideDirective: state.overrideDirective,  // ✅ Save chat-initiated directive
          chatSource: state.chatSource,  // ✅ Save chat source flag
          referenceRequests: state.referenceRequests || [],  // ✅ Save reference repositories for analysis
          // ✅ CRITICAL: Save detectionReport for resume (required for tool calling in codeGen)
          // Without this, codeGen disables tool calling on resume → XML tags rendered as text
          detectionReport: state.detectionReport,
          // ✅ projectCodeContext is NOT saved to checkpoint
          // Plan node always regenerates it via RAG - no need to persist
        }
      }
    );
    
    console.log(`💾 Session turn saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/architect/code.json`);
    if (state.taskQueue && !state.taskQueue.isEmpty()) {
      console.log(`💾 State snapshot saved: ${state.completedTasks?.length || 0} completed, ${state.taskQueue.size()} remaining`);
    }
  }
  
  // 4. 🚀 ASYNC lesson storage - Store to vector DB without blocking workflow
  // This allows the agent to move to the next task immediately while lesson extraction happens in background
  if (state.deps?.memory && state.deps?.chunk) {
    // ✅ Capture dependencies in closure to avoid holding onto entire state
    const deps = {
      chunk: state.deps.chunk,
      memory: state.deps.memory
    };
    const taskName = state.currentTask?.name || 'unknown';
    const contextData = {
      project: state.context.project,
      feature: state.context.featureFolder || 'default'
    };
    
    // ✅ Add to queue instead of firing immediately
    // Queue limits concurrent lesson operations to prevent memory explosion
    const queueStats = lessonQueue.getStats();
    console.log(`\n🎓 [Async Lesson] Queuing lesson storage for: ${taskName}`);
    console.log(`   Queue status: ${queueStats.running} running, ${queueStats.queued} queued`);
    
    lessonQueue.add(async () => {
      try {
        console.log(`\n🎓 [Async Learning] Processing task: ${taskName}`);
        
        // Process through chunking pipeline (via ChunkPort)
        const result = await deps.chunk.process({
          source: 'code-lesson',  // ✅ Changed from 'code-learning'
          sourceType: 'text',
          content: lessons,
          metadata: {
            type: 'lesson',
            job: 'code',
            project: contextData.project,
            feature: contextData.feature,
            timestamp: new Date().toISOString(),
            taskName: taskName,
            // 🔗 Session tracking for traceability
            sessionId: sessionId,
            turnId: turnId,
            // ✅ Enhanced metadata (arrays converted to strings for ChromaDB)
            relatedFiles: (lessonMetadata.relatedFiles || []).join(','),  // ✅ Convert array to string
            tags: (lessonMetadata.tags || []).join(','),                    // ✅ Convert array to string
            directive: lessonMetadata.directive,
            taskType: lessonMetadata.taskType,
            branch: lessonMetadata.branch
          }
        });
        
        console.log(`📚 [Async Learning] Chunked into ${result.chunks.length} pieces (avg ${result.stats.avgTokens} tokens)`);
        
        // ✅ BATCH STORE: Convert all chunks to documents and store in ONE call
        const documents = result.chunks.map(chunk => ({
          content: chunk.text,
          metadata: chunk.metadata
        }));
        
        // Single batch store operation (reduces HTTP overhead and memory pressure)
        if (!deps.memory) {
          throw new Error('Memory adapter not available');
        }
        if (typeof deps.memory.store !== 'function') {
          throw new Error(`Memory adapter store is not a function. Type: ${typeof deps.memory.store}`);
        }
        await deps.memory.store(documents, contextData.project);
        
        console.log(`✅ [Async Lesson] ${result.chunks.length} lesson chunks stored to memory (batch)`);
        if (sessionId && turnId) {
          console.log(`🔗 [Async Learning] Linked to session: ${sessionId}, turn: ${turnId}`);
        }
      } catch (error) {
        // Non-fatal: log error but don't fail the entire workflow
        console.error('⚠️  [Async Lesson] Failed to store lessons to memory:', error instanceof Error ? error.message : error);
        console.log('   Workflow continues without memory storage...');
      }
    }).catch(() => {
      // Queue already handles errors, this is just to prevent unhandled rejection
    });
    
    // ✅ Don't wait - continue to next task immediately
    console.log(`🚀 [Learn] Background lesson storage queued, continuing workflow...\n`);
  } else {
    console.log(`ℹ️  [Learn] Memory/Chunk ports not available, skipping lesson storage\n`);
  }
  
  // ✅ Chat UI: Show learning → learned status (must be consecutive for proper merge!)
  // NOTE: This node extracts/stores "lessons" (vector DB), not full codebase indexing.
  const chatAPI = getChatAPIClient();
  
  try {
    // ✅ Send learning first and get index
    const learningIndex = await chatAPI.showChatStatus('learning', {
      taskName: state.currentTask?.name || 'Unknown task',
      filesWritten: 0,  // ✅ Initialize with 0 for progress
      branch: null
    });
    
    // Then send learned with _mergeIndex
    await chatAPI.showChatStatus('learned', {
      filesWritten: filesWritten,
      branch: branch,
      content: `Lessons learned!`,
      _mergeIndex: learningIndex
    });
    console.log(`   ✅ Chat UI update successful (learning → learned)\n`);
  } catch (error: any) {
    console.error(`   ❌ Chat UI update FAILED:`, error.message);
    // Continue execution even if chat update fails
  }
  
  // ✅ Workflow instrumentation: Exit node (success path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'learn', (state as any).workerId ?? 0);
  }
  
  // ✅ CRITICAL: Update Kanban when transitioning to learn (all tasks completed)
  // This clears the live snapshot and ensures UI shows completed state
  // Skip in worker context — orchestrator handles kanban for parallel mode
  const _learnWorkerId = (state as any).workerId;
  const _isLearnWorkerContext = _learnWorkerId !== undefined && _learnWorkerId !== null;
  if (!_isLearnWorkerContext && state.deps?.kanbanUpdate && state._httpJobId) {
    console.log(`\n📋 [Learn] Updating Kanban → All tasks completed`);
    console.log(`   Completed: ${state.completedTasksDetails?.length || 0} tasks`);
    console.log(`   Queue: 0 (all done)\n`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      null,  // No current task (all done)
      [],    // Empty queue (all done)
      state.completedTasksDetails || [],
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // Note: lessons string is used for session/vector DB storage, not returned in state
  // State.lessons is for structured lesson objects (different type)
  return { ...state, branch, filesWritten };
}

/**
 * Extract tags from lessons and directive
 */
function extractTags(lessons: string, directive: string = ''): string[] {
  const text = (lessons + ' ' + directive).toLowerCase();
  
  const keywords = [
    'auth', 'authentication', 'login', 'jwt', 'bcrypt', 'session',
    'api', 'endpoint', 'rest', 'graphql', 'http',
    'database', 'sql', 'orm', 'prisma', 'mongodb',
    'react', 'component', 'hook', 'state', 'redux',
    'async', 'await', 'promise', 'callback',
    'error', 'validation', 'security', 'encryption',
    'test', 'testing', 'jest', 'unit-test',
    'performance', 'optimization', 'cache',
    'ui', 'ux', 'design', 'css', 'style',
    'typescript', 'javascript', 'python', 'go',
    'docker', 'kubernetes', 'deploy', 'ci/cd',
    'git', 'github', 'version-control',
    'refactor', 'clean-code', 'architecture'
  ];
  
  return keywords.filter(k => text.includes(k));
}

/**
 * Extract structured lessons from code generation state
 * 
 * ✅ NEW FORMAT: Problem-Solution-Outcome
 * - Focus on actionable knowledge
 * - Reference documents, don't include full content
 * - Keep under 1KB to prevent OOM
 */
function extractCodeLessons(state: ArchitectGraphState): string {
  // Extract components
  const problem = extractProblem(state);
  const solution = extractSolution(state);
  const outcome = extractOutcome(state);
  const patterns = extractPatterns(state);
  const antipatterns = extractAntipatterns(state);
  const relatedFiles = extractRelatedFiles(state);
  const references = extractReferences(state);
  const tags = extractTags(problem + solution, state.directive || '');
  
  // Build structured lesson
  return `
## Lesson: ${state.currentTask?.name || 'Unknown Task'}

### Problem
${problem}

### Solution
${solution}

### Outcome
${outcome}

### Patterns Applied
${patterns.length > 0 ? patterns.map(p => `- ${p}`).join('\n') : '- None'}

### Mistakes Avoided
${antipatterns.length > 0 ? antipatterns.map(a => `- ${a}`).join('\n') : '- None'}

### Related Files
${relatedFiles.length > 0 ? relatedFiles.map(f => `- ${f}`).join('\n') : '- None'}

### References
${references.map(r => `- ${r}`).join('\n')}

### Tags
${tags.join(', ')}

### Context
- **Project**: ${state.context.project}
- **Feature**: ${state.context.featureFolder || 'main'}
- **Mode**: ${state.detectionReport?.jobMode || 'auto'}
- **Language**: ${state.profile?.language || 'unknown'}
- **Framework**: ${state.profile?.framework || 'N/A'}
- **Timestamp**: ${new Date().toISOString()}
  `.trim();
}

/**
 * Extract problem description from state
 */
function extractProblem(state: ArchitectGraphState): string {
  // Use directive as problem description (max 300 chars)
  const directive = state.directive || state.currentTask?.description || 'No problem description';
  return directive.substring(0, 300) + (directive.length > 300 ? '...' : '');
}

/**
 * Extract solution description from state
 */
function extractSolution(state: ArchitectGraphState): string {
  const parts: string[] = [];
  const files = state.projectCodeContext?.files || [];
  
  // File operations
  const filesToDelete = state.filesToDelete || [];
  if (files.length > 0) {
    parts.push(`Generated ${files.length} file(s)`);
  }
  if (filesToDelete.length > 0) {
    parts.push(`deleted ${filesToDelete.length} file(s)`);
  }
  
  // Mode applied
  parts.push(`using ${state.detectionReport?.jobMode || 'generate'} mode`);
  
  // Profile info
  if (state.profile) {
    parts.push(`with ${state.profile.language}${state.profile.framework ? ` + ${state.profile.framework}` : ''}`);
  }
  
  return parts.join(', ') + '.';
}

/**
 * Extract outcome from state
 */
function extractOutcome(state: ArchitectGraphState): string {
  const violations = state.violations || [];
  if (violations.length === 0 && state.retries === 0) {
    return '✅ **Success** - All quality checks passed on first attempt';
  } else if (state.retries > 0 && violations.length === 0) {
    return `✅ **Success** - Issues resolved after ${state.retries} retry(ies)`;
  } else if (state.retries > 0 && violations.length > 0) {
    return `⚠️ **Partial** - ${violations.length} issue(s) remain after ${state.retries} retry(ies)`;
  } else {
    return `❌ **Issues** - ${violations.length} unresolved issue(s)`;
  }
}

/**
 * Extract anti-patterns (mistakes avoided) from violations
 */
function extractAntipatterns(state: ArchitectGraphState): string[] {
  const antipatterns: string[] = [];
  const violations: any[] = state.violations || [];
  
  // Extract from violations (max 3)
  for (const v of violations.slice(0, 3)) {
    if (typeof v === 'string') {
      const text: string = v;
      antipatterns.push(text.substring(0, 80) + (text.length > 80 ? '...' : ''));
    } else if (v && typeof v === 'object') {
      // v is Violation object
      const msg = `${v.type}: ${v.message}`.substring(0, 80);
      antipatterns.push(msg + (msg.length >= 80 ? '...' : ''));
    }
  }
  
  return antipatterns;
}

/**
 * Extract related files (max 5)
 */
function extractRelatedFiles(state: ArchitectGraphState): string[] {
  const files = state.projectCodeContext?.files || [];
  return files.slice(0, 5).map(f => f.path);
}

/**
 * Extract references to documents
 */
function extractReferences(state: ArchitectGraphState): string[] {
  const refs: string[] = [];
  
  // Design document reference
  if (state.design) {
    const designTitle = extractDesignTitle(state.design);
    refs.push(`Design: ${designTitle}`);
  }
  
  // Directive reference
  if (state.directive) {
    const directiveId = extractDirectiveId(state);
    refs.push(`Directive: ${directiveId}`);
  }
  
  // PRD reference
  if (state.prd) {
    refs.push(`PRD: Available in documents collection`);
  }
  
  return refs.length > 0 ? refs : ['No references'];
}

/**
 * Extract design document title from content
 */
function extractDesignTitle(designContent: string): string {
  // Try to extract title from markdown h1
  const titleMatch = designContent.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    return titleMatch[1].substring(0, 50);
  }
  return 'Design Document';
}

/**
 * Extract directive ID from state
 */
function extractDirectiveId(state: ArchitectGraphState): string {
  // Generate directive ID from session
  const sessionId = (state as any).sessionId || 'unknown';
  const turnId = (state as any).turnId || 0;
  return `${sessionId.substring(0, 8)}-turn-${turnId}`;
}

/**
 * Extract patterns from state
 */
function extractPatterns(state: ArchitectGraphState): string[] {
  const patterns: string[] = [];
  
  // Infer patterns from profile and files
  if (state.profile?.framework) {
    patterns.push(state.profile.framework);
  }
  
  if (state.detectionReport?.jobMode) {
    patterns.push(state.detectionReport.jobMode);
  }
  
  // Infer from file structures
  const files = state.projectCodeContext?.files || [];
  const hasTests = files.some(f => f.path.includes('test') || f.path.includes('spec'));
  if (hasTests) {
    patterns.push('test-driven-development');
  }
  
  const hasComponents = files.some(f => f.path.includes('component'));
  if (hasComponents) {
    patterns.push('component-based-architecture');
  }
  
  return patterns.length > 0 ? patterns : ['general-implementation'];
}


