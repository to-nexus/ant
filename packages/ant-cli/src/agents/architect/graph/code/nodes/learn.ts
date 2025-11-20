import * as path from "path";
import { ArchitectGraphState } from "../state";
import { SessionTurn } from "../../../../../core/types";
import { errorStatsCollector, formatStatistics } from "./diagnostics/errorStats";

/**
 * ✅ Global queue for async learning tasks to prevent memory explosion
 * Limits concurrent learning operations to 2 at a time
 */
class LearningQueue {
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

const learningQueue = new LearningQueue();

/**
 * Learn node - Incremental learning after each task completion:
 * 1. Extract learnings from completed task
 * 2. Store learnings to vector DB (ASYNC - non-blocking)
 * 3. Save turn to session file (for context continuity)
 * 4. Route to next task or end
 * 
 * ✅ NEW: Called after EVERY task completion (not just at the end)
 * ✅ NEW: Async learning - doesn't block workflow progression
 * 
 * NOTE: File saving happens in writeFiles node (before validation)
 * This node focuses purely on learning/metadata artifacts.
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
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // 0. Generate quality evaluation report (optional, if files were generated)
  if (state.files && state.files.length > 0) {
    try {
      const gitPort = state.gitPort || state.deps?.git;
      if (gitPort) {
        const { generateQualityReport } = await import('./utils/qualityReport');
        const report = await generateQualityReport(state, gitPort);
        if (report) {
          state.evaluationReport = report;
        }
      }
    } catch (error) {
      console.warn('⚠️  Quality report generation failed:', error);
    }
  }
  
  // 1. Extract learnings
  const learnings = extractCodeLearnings(state);
  
  // Note: Files are already written to disk in writeFiles node
  // This node focuses on learning artifacts: vector DB + session storage
  
  const gitPort = state.gitPort || state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for branch management");
  }
  
  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  
  const branchBase = state.context.branchBase || 'main';
  await gitPort.createBranch(branch, branchBase);
  
  // Log files that were written in writeFiles
  console.log(`\n📌 Branch '${branch}' ready with ${state.files.length} files`);
  for (const f of state.files) {
    console.log(`✏️  Modified: ${f.path}`);
  }
  
  const filesWritten = state.files.length;
  
  // 3. Save turn to session file first (to get sessionId and turnId)
  let sessionId: string | undefined;
  let turnId: number | undefined;
  
  if (state.deps?.session) {
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
      : `Spec: ${state.spec.substring(0, 150)}...`;
    
    const turn: SessionTurn = {
      turnId: 0, // Will be set by adapter
      task: 'code',
      timestamp: new Date().toISOString(),
      input: {
        type: 'design',
        source: state.design ? 'outputs/design/[latest]' : 'directive',
        summary: inputSummary.substring(0, 200),
        size: state.design?.length || state.spec.length,
      },
      output: {
        branch: branch,
        filesWritten: filesWritten,
        files: state.files.map(f => f.path),
        modifications: state.codeHead ? state.files.map(f => f.path) : []
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
    
    // ✨ Mark job as completed
    const completedJobTiming = (state as any).jobTiming ? {
      ...(state as any).jobTiming,
      completedAt: new Date().toISOString()
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
          directives: directivesArray,  // ✅ Save directives array (newest first)
          overrideDirective: state.overrideDirective,  // ✅ Save chat-initiated directive
          chatSource: state.chatSource  // ✅ Save chat source flag
        }
      }
    );
    
    console.log(`💾 Session turn saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/code.json`);
    if (state.taskQueue && !state.taskQueue.isEmpty()) {
      console.log(`💾 State snapshot saved: ${state.completedTasks?.length || 0} completed, ${state.taskQueue.size()} remaining`);
    }
  }
  
  // 4. 🚀 ASYNC learning - Store to vector DB without blocking workflow
  // This allows the agent to move to the next task immediately while learning happens in background
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
    // Queue limits concurrent learning operations to prevent memory explosion
    const queueStats = learningQueue.getStats();
    console.log(`\n🎓 [Async Learning] Queuing learning task for: ${taskName}`);
    console.log(`   Queue status: ${queueStats.running} running, ${queueStats.queued} queued`);
    
    learningQueue.add(async () => {
      try {
        console.log(`\n🎓 [Async Learning] Processing task: ${taskName}`);
        
        // Process through chunking pipeline (via ChunkPort)
        const result = await deps.chunk.process({
          source: 'code-learning',
          sourceType: 'text',
          content: learnings,
          metadata: {
            type: 'learning',
            task: 'code',
            project: contextData.project,
            feature: contextData.feature,
            timestamp: new Date().toISOString(),
            taskName: taskName,
            // 🔗 Session tracking for traceability
            sessionId: sessionId,
            turnId: turnId
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
        
        console.log(`✅ [Async Learning] ${result.chunks.length} learning chunks stored to memory (batch)`);
        if (sessionId && turnId) {
          console.log(`🔗 [Async Learning] Linked to session: ${sessionId}, turn: ${turnId}`);
        }
      } catch (error) {
        // Non-fatal: log error but don't fail the entire workflow
        console.error('⚠️  [Async Learning] Failed to store learnings to memory:', error instanceof Error ? error.message : error);
        console.log('   Workflow continues without memory storage...');
      }
    }).catch(() => {
      // Queue already handles errors, this is just to prevent unhandled rejection
    });
    
    // ✅ Don't wait - continue to next task immediately
    console.log(`🚀 [Learn] Background learning queued, continuing workflow...\n`);
  } else {
    console.log(`ℹ️  [Learn] Memory/Chunk ports not available, skipping learning storage\n`);
  }
  
  // ✅ Workflow instrumentation: Exit node (success path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'learn');
  }
  
  return { ...state, learnings, branch, filesWritten };
}

/**
 * Extract structured learnings from code generation state
 */
function extractCodeLearnings(state: ArchitectGraphState): string {
  const sections: string[] = [];
  
  // 1. Context
  sections.push(`## Code Generation Session`);
  sections.push(`**Project**: ${state.context.project}`);
  sections.push(`**Feature**: ${state.context.featureFolder || 'main'}`);
  sections.push(`**Mode**: ${state.codeMode || 'auto'}`);
  sections.push(`**Timestamp**: ${new Date().toISOString()}`);
  
  // 2. Codebase Profile
  if (state.profile) {
    sections.push(`\n## Codebase Profile`);
    sections.push(`**Language**: ${state.profile.language}`);
    sections.push(`**Framework**: ${state.profile.framework || 'N/A'}`);
    if (state.profile.version) {
      sections.push(`**Version**: ${state.profile.version}`);
    }
    if (state.profile.packageManager) {
      sections.push(`**Package Manager**: ${state.profile.packageManager}`);
    }
    if (state.profile.conventions) {
      sections.push(`**Conventions**: ${JSON.stringify(state.profile.conventions)}`);
    }
  }
  
  // 3. Implementation Plan (summarized to reduce memory)
  if (state.planText) {
    sections.push(`\n## Implementation Plan Summary`);
    // Extract key points from plan (first 1000 chars or THINKING section only)
    const thinkingMatch = state.planText.match(/=== THINKING ===([\s\S]*?)=== END THINKING ===/);
    if (thinkingMatch) {
      const thinking = thinkingMatch[1].trim();
      sections.push(thinking.substring(0, 1500) + (thinking.length > 1500 ? '...' : ''));
    } else {
      sections.push(state.planText.substring(0, 1000) + (state.planText.length > 1000 ? '...' : ''));
    }
  }
  
  // 4. Design Context (keep minimal reference)
  if (state.design) {
    sections.push(`\n## Design Reference`);
    const designSummary = state.design.substring(0, 300);
    sections.push(designSummary + (state.design.length > 300 ? '...\n[Full design available in session artifacts]' : ''));
  }
  
  // 5. Directive Applied (summarized if too long)
  if (state.directive) {
    sections.push(`\n## Directive Applied`);
    if (state.directive.length > 2000) {
      sections.push(state.directive.substring(0, 2000) + '\n...\n[Full directive available in session artifacts]');
    } else {
      sections.push(state.directive);
    }
  }
  
  // 6. Files Generated
  sections.push(`\n## Generated Files (${state.files.length})`);
  for (const f of state.files) {
    const lines = f.content.split('\n').length;
    sections.push(`- \`${f.path}\` (${lines} lines)`);
  }
  
  if (state.filesToDelete.length > 0) {
    sections.push(`\n## Deleted Files (${state.filesToDelete.length})`);
    for (const path of state.filesToDelete) {
      sections.push(`- \`${path}\``);
    }
  }
  
  // 7. Quality & Violations
  if (state.violations && state.violations.length > 0) {
    sections.push(`\n## Quality Issues Encountered`);
    for (const v of state.violations) {
      // Handle structured Violation objects
      const violationText = typeof v === 'string' 
        ? v 
        : `[${v.severity}] ${v.type}: ${v.message}${v.file ? ` (${v.file})` : ''}`;
      sections.push(`- ${violationText}`);
    }
    sections.push(`\n**Retries**: ${state.retries}/${state.maxRetries}`);
    if (state.retries > 0) {
      sections.push(`**Outcome**: Issues were ${state.violations.length === 0 ? 'resolved' : 'partially resolved'} through enforcement`);
    }
  } else {
    sections.push(`\n## Quality Check`);
    sections.push(`✅ All guardrails passed on first attempt`);
  }
  
  // 8. Key Patterns Applied
  sections.push(`\n## Key Patterns`);
  sections.push(extractPatterns(state));
  
  // 9. Integration Requirements
  if (state.requiredIntegrations.length > 0) {
    sections.push(`\n## Required Integrations`);
    for (const integration of state.requiredIntegrations) {
      sections.push(`- ${integration.name}`);
    }
  }
  
  return sections.join('\n');
}

/**
 * Extract key patterns from the execution
 */
function extractPatterns(state: ArchitectGraphState): string {
  const patterns: string[] = [];
  
  // Pattern 1: Code mode
  if (state.codeMode) {
    patterns.push(`- **Generation Mode**: ${state.codeMode}`);
  }
  
  // Pattern 2: File operations
  // Note: Without tracking original file list, assume all are modifications if codeHead exists
  const creates = state.codeHead ? [] : state.files;
  const modifies = state.codeHead ? state.files : [];
  
  if (creates.length > 0) {
    patterns.push(`- **New Files**: ${creates.length} created`);
  }
  if (modifies.length > 0) {
    patterns.push(`- **Modified Files**: ${modifies.length} updated`);
  }
  if (state.filesToDelete.length > 0) {
    patterns.push(`- **Deleted Files**: ${state.filesToDelete.length} removed`);
  }
  
  // Pattern 3: Codebase conventions
  if (state.profile?.conventions) {
    const convs = state.profile.conventions;
    if (convs.naming) {
      patterns.push(`- **Naming Convention**: ${convs.naming}`);
    }
    if (convs.imports) {
      patterns.push(`- **Import Style**: ${convs.imports}`);
    }
  }
  
  return patterns.join('\n');
}

