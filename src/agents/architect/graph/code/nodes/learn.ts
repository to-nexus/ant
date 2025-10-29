import * as path from "path";
import { ArchitectGraphState } from "../state";
import { SessionTurn } from "../../../../../core/types";

/**
 * Learn node - Complete workflow finalization:
 * 1. Extract learnings from execution
 * 2. Save generated files to repository
 * 3. Chunk and store learnings to memory
 * 4. Save turn to session file
 * 
 * This is the final node that performs all side effects.
 * Depends on GitPort, ChunkPort, and SessionPort (injected via deps) - follows hexagonal architecture.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations (not fs directly)
 * - Uses SessionPort for session persistence
 * - Uses ChunkPort for chunking operations
 * - No direct infrastructure dependencies
 */
export async function learn(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // 1. Extract learnings
  const learnings = extractCodeLearnings(state);
  
  // 2. Save files to repository via GitPort (Hexagonal Architecture)
  const gitPort = state.gitPort || state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for file saving");
  }
  
  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  await gitPort.createBranch(branch, state.context.config.branchBase);
  
  let filesWritten = 0;
  
  // Use GitPort.writeFile() instead of fs (Hexagonal Architecture)
  for (const f of state.files) {
    await gitPort.writeFile(f.path, f.content);
    filesWritten++;
    console.log(`✏️  Modified: ${f.path}`);
  }
  
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
    
    // Update artifacts
    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder || 'default',
      {
        activeBranch: branch
      }
    );
    
    console.log(`💾 Session turn saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/outputs/session.json`);
  }
  
  // 4. Chunk and store learnings to memory with session tracking
  if (state.deps?.memory && state.deps?.chunk) {
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
    
    // Store each chunk to memory
    for (const chunk of result.chunks) {
      await state.deps.memory.store([
        {
          content: chunk.text,
          metadata: chunk.metadata
        }
      ], state.context.project);
    }
    
    console.log(`✅ ${result.chunks.length} learning chunks stored to memory`);
    if (sessionId && turnId) {
      console.log(`🔗 Linked to session: ${sessionId}, turn: ${turnId}`);
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
  
  // 3. Implementation Plan
  if (state.planText) {
    sections.push(`\n## Implementation Plan`);
    sections.push(state.planText);
  }
  
  // 4. Design Context
  if (state.design) {
    sections.push(`\n## Design Reference`);
    const designSummary = state.design.substring(0, 500);
    sections.push(designSummary + (state.design.length > 500 ? '...' : ''));
  }
  
  // 5. Directive Applied
  if (state.directive) {
    sections.push(`\n## Directive Applied`);
    sections.push(state.directive);
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
      sections.push(`- ${v}`);
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

