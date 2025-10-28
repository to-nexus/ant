import * as fs from "fs";
import * as path from "path";
import { DesignGraphState } from "../state";

/**
 * Learn node - Complete workflow finalization:
 * 1. Extract learnings from design
 * 2. Save design document to file
 * 3. Chunk and store learnings to memory
 * 
 * This is the final node that performs all side effects.
 * Depends on ChunkPort (injected via deps) - follows hexagonal architecture.
 */
export async function learn(state: DesignGraphState): Promise<DesignGraphState> {
  // 1. Extract learnings
  const learnings = extractDesignLearnings(state);
  
  // 2. Save design document to file
  const designDir = path.join(
    state.context.workingDir,
    "projects",
    state.context.project,
    state.context.featureFolder || "default",
    "generated",
    "design"
  );
  fs.mkdirSync(designDir, { recursive: true });
  
  const designFilePath = path.join(
    designDir, 
    `design-${state.context.project}-${Date.now()}.md`
  );
  fs.writeFileSync(designFilePath, state.designMarkdown, "utf8");
  console.log(`📝 Design saved: ${designFilePath}`);
  
  // 3. Chunk and store learnings to memory
  if (state.context.memory && state.deps?.chunk) {
    // Process through chunking pipeline (via ChunkPort)
    const result = await state.deps.chunk.process({
      source: 'design-learning',
      sourceType: 'text',
      content: learnings,
      metadata: {
        type: 'learning',
        task: 'design',
        project: state.context.project,
        feature: state.context.featureFolder || 'default',
        timestamp: new Date().toISOString()
      }
    });
    
    console.log(`📚 Chunked into ${result.chunks.length} pieces (avg ${result.stats.avgTokens} tokens)`);
    
    // Store each chunk to memory
    const memory = state.context.memory as any;
    for (const chunk of result.chunks) {
      await memory.store([
        {
          content: chunk.text,
          metadata: chunk.metadata
        }
      ], state.context.project);
    }
    
    console.log(`✅ ${result.chunks.length} learning chunks stored to memory`);
  }
  
  return { ...state, designFilePath, learnings };
}

/**
 * Extract structured learnings from design generation
 */
function extractDesignLearnings(state: DesignGraphState): string {
  const sections: string[] = [];
  
  // 1. Context
  sections.push(`## Design Session`);
  sections.push(`**Project**: ${state.context.project}`);
  sections.push(`**Feature**: ${state.context.featureFolder || 'main'}`);
  sections.push(`**Timestamp**: ${new Date().toISOString()}`);
  
  // 2. Design Plan
  if (state.planText) {
    sections.push(`\n## Design Approach`);
    sections.push(state.planText);
  }
  
  // 3. Previous Design Context
  if (state.previousDesign) {
    sections.push(`\n## Previous Design Reference`);
    const summary = state.previousDesign.substring(0, 500);
    sections.push(summary + (state.previousDesign.length > 500 ? '...' : ''));
  }
  
  // 4. Directive Applied
  if (state.directive) {
    sections.push(`\n## Directive Applied`);
    sections.push(state.directive);
  }
  
  // 5. Design Summary
  sections.push(`\n## Design Document Summary`);
  const lines = state.designMarkdown.split('\n').length;
  sections.push(`**Length**: ${lines} lines`);
  
  // Extract key sections from markdown
  const headings = state.designMarkdown.match(/^#{1,3}\s+(.+)$/gm);
  if (headings && headings.length > 0) {
    sections.push(`\n**Key Sections**:`);
    for (const heading of headings.slice(0, 10)) {
      sections.push(`- ${heading}`);
    }
  }
  
  // 6. Key Design Decisions
  sections.push(`\n## Key Design Decisions`);
  sections.push(extractDesignDecisions(state));
  
  return sections.join('\n');
}

/**
 * Extract key design decisions from the markdown
 */
function extractDesignDecisions(state: DesignGraphState): string {
  const decisions: string[] = [];
  
  // Look for common design decision patterns
  const markdown = state.designMarkdown;
  
  // Technology stack
  const techMatch = markdown.match(/(?:technology|tech stack|framework|language)[\s:]+([^\n]+)/i);
  if (techMatch) {
    decisions.push(`- **Technology**: ${techMatch[1].trim()}`);
  }
  
  // Architecture pattern
  const archMatch = markdown.match(/(?:architecture|pattern)[\s:]+([^\n]+)/i);
  if (archMatch) {
    decisions.push(`- **Architecture**: ${archMatch[1].trim()}`);
  }
  
  // Database
  const dbMatch = markdown.match(/(?:database|storage)[\s:]+([^\n]+)/i);
  if (dbMatch) {
    decisions.push(`- **Database**: ${dbMatch[1].trim()}`);
  }
  
  if (decisions.length === 0) {
    decisions.push(`- Design approach documented in ${state.designMarkdown.split('\n').length} lines`);
  }
  
  return decisions.join('\n');
}

