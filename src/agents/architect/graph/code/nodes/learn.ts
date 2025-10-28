import * as fs from "fs";
import * as path from "path";
import { ArchitectGraphState } from "../state";

/**
 * Learn node - Complete workflow finalization:
 * 1. Extract learnings from execution
 * 2. Save generated files to repository
 * 3. Chunk and store learnings to memory
 * 
 * This is the final node that performs all side effects.
 * Depends on ChunkPort (injected via deps) - follows hexagonal architecture.
 */
export async function learn(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // 1. Extract learnings
  const learnings = extractCodeLearnings(state);
  
  // 2. Save files to repository
  const gitPort = state.gitPort || state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for file saving");
  }
  
  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  await gitPort.createBranch(branch, state.context.config.branchBase);
  
  const repoRoot = await gitPort.getRepoRoot();
  let filesWritten = 0;
  
  for (const f of state.files) {
    const fullPath = path.join(repoRoot, f.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, f.content, "utf8");
    filesWritten++;
    console.log(`✏️  Modified: ${f.path}`);
  }
  
  // 3. Chunk and store learnings to memory
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
        timestamp: new Date().toISOString()
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
  if (state.codebaseProfile) {
    sections.push(`\n## Codebase Profile`);
    sections.push(`**Language**: ${state.codebaseProfile.language}`);
    sections.push(`**Framework**: ${state.codebaseProfile.framework || 'N/A'}`);
    if (state.codebaseProfile.version) {
      sections.push(`**Version**: ${state.codebaseProfile.version}`);
    }
    if (state.codebaseProfile.packageManager) {
      sections.push(`**Package Manager**: ${state.codebaseProfile.packageManager}`);
    }
    if (state.codebaseProfile.conventions) {
      sections.push(`**Conventions**: ${JSON.stringify(state.codebaseProfile.conventions)}`);
    }
  }
  
  // 3. Implementation Plan
  if (state.planText) {
    sections.push(`\n## Implementation Plan`);
    sections.push(state.planText);
  }
  
  // 4. Design Context
  if (state.latestDesign) {
    sections.push(`\n## Design Reference`);
    const designSummary = state.latestDesign.substring(0, 500);
    sections.push(designSummary + (state.latestDesign.length > 500 ? '...' : ''));
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
  const creates = state.files.filter(f => !state.originalFilesBlock.includes(f.path));
  const modifies = state.files.filter(f => state.originalFilesBlock.includes(f.path));
  
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
  if (state.codebaseProfile?.conventions) {
    const convs = state.codebaseProfile.conventions;
    if (convs.naming) {
      patterns.push(`- **Naming Convention**: ${convs.naming}`);
    }
    if (convs.imports) {
      patterns.push(`- **Import Style**: ${convs.imports}`);
    }
  }
  
  return patterns.join('\n');
}

