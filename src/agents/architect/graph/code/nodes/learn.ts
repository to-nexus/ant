import * as path from "path";
import { ArchitectGraphState } from "../state";
import { SessionTurn } from "../../../../../core/types";

/**
 * Learn node - Learning artifacts finalization:
 * 1. Extract learnings from execution
 * 2. Store learnings to vector DB (for future retrieval)
 * 3. Save turn to session file (for context continuity)
 * 
 * NOTE: File saving happens in postProcess node (before dynamic validation)
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
  // 1. Extract learnings
  const learnings = extractCodeLearnings(state);
  
  // Note: Files are already written to disk in postProcess node
  // This node focuses on learning artifacts: vector DB + session storage
  
  const gitPort = state.gitPort || state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for branch management");
  }
  
  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  await gitPort.createBranch(branch, state.context.config.branchBase);
  
  // Log files that were written in postProcess
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
      state.context.featureFolder || 'default'
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
      turn
    );
    
    // Get the turnId that was assigned
    const updatedSession = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default'
    );
    turnId = updatedSession.turns[updatedSession.turns.length - 1]?.turnId;
    
    // Update artifacts and save state snapshot for resuming
    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder || 'default',
      {
        activeBranch: branch,
        // ✅ Save execution state snapshot for resuming after recursion limit
        state: {
          taskQueue: state.taskQueue?.getAll() || [],
          currentTask: state.currentTask,
          completedTasks: state.completedTasks || [],
          retries: state.retries,
          maxRetries: state.maxRetries,
          previousAttempts: state.previousAttempts || [],
          enforcementHistory: state.enforcementHistory || [],
          lastViolations: state.lastViolations || [],
          previousFileCount: state.previousFileCount,
          resolvedCategories: state.resolvedCategories || [],
        }
      }
    );
    
    console.log(`💾 Session turn saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/outputs/session.json`);
    if (state.taskQueue && !state.taskQueue.isEmpty()) {
      console.log(`💾 State snapshot saved: ${state.completedTasks?.length || 0} completed, ${state.taskQueue.size()} remaining`);
    }
  }
  
  // 4. Chunk and store learnings to memory with session tracking
  if (state.deps?.memory && state.deps?.chunk) {
    try {
      // Process through chunking pipeline (via ChunkPort)
      const result = await state.deps.chunk.process({
        source: 'code-learning',
        sourceType: 'text',
        content: learnings,
        metadata: {
          type: 'learning',
          task: 'code',
          project: state.context.project,
          feature: state.context.featureFolder || 'default',
          timestamp: new Date().toISOString(),
          // 🔗 Session tracking for traceability
          sessionId: sessionId,
          turnId: turnId
        }
      });
      
      console.log(`📚 Chunked into ${result.chunks.length} pieces (avg ${result.stats.avgTokens} tokens)`);
      
      // ✅ BATCH STORE: Convert all chunks to documents and store in ONE call
      const documents = result.chunks.map(chunk => ({
        content: chunk.text,
        metadata: chunk.metadata
      }));
      
      // Single batch store operation (reduces HTTP overhead and memory pressure)
      await state.deps.memory.store(documents, state.context.project);
      
      console.log(`✅ ${result.chunks.length} learning chunks stored to memory (batch)`);
      if (sessionId && turnId) {
        console.log(`🔗 Linked to session: ${sessionId}, turn: ${turnId}`);
      }
    } catch (error) {
      // Non-fatal: log error but don't fail the entire workflow
      console.error('⚠️  Failed to store learnings to memory:', error instanceof Error ? error.message : error);
      console.log('   Continuing without memory storage...');
    }
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

