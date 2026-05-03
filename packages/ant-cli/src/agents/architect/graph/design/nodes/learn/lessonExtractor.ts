import { DesignGraphState } from '../../state';
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';

type DesignOutputFile = { path: string; content: string };

const PRIMARY_DESIGN_MATCHERS: Array<(path: string) => boolean> = [
  // Canonical architecture/system outputs
  (path) => /(?:^|\/)(?:fe-system-|be-system-|api-contract-).+\.md$/i.test(path),
  (path) => /(?:^|\/)design\.md$/i.test(path),
  // Architecture spec markdown (e.g. architecture/spec/*-spec.md)
  (path) => /(?:^|\/)architecture\/spec\/.+\.md$/i.test(path),
  // Additional markdown design artifacts under architecture/system
  (path) => /(?:^|\/)architecture\/system\/.+\.md$/i.test(path),
  // UI design JSON artifacts from ANT design outputs
  (path) => /(?:^|\/)visual\/ui\/ant\/.+\.json$/i.test(path),
  // Last-resort fallbacks
  (path) => /\.md$/i.test(path),
  (path) => /\.json$/i.test(path),
];

function pickPrimaryDesignFile(files: DesignOutputFile[] | undefined): DesignOutputFile | undefined {
  if (!files || files.length === 0) return undefined;
  for (const match of PRIMARY_DESIGN_MATCHERS) {
    const hit = files.find((file) => match(file.path));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Store lessons to vector memory with chunking
 */
export async function storeLessonsToMemory(
  state: DesignGraphState,
  lessons: string,
  sessionId: string | undefined,
  runId: number | undefined
): Promise<void> {
  if (!state.deps?.chunk || !state.deps?.memory) return;
  
  try {
    const result = await state.deps.chunk.process({
      source: 'design-lesson',
      sourceType: 'text',
      content: lessons,
      metadata: {
        type: 'lesson',
        job: 'design',
        project: state.context.project,
        feature: state.context.featureFolder || 'default',
        timestamp: new Date().toISOString(),
        sessionId: sessionId,
        runId: runId
      }
    });
    
    console.log(`📚 Chunked into ${result.chunks.length} pieces (avg ${result.stats.avgTokens} tokens)`);
    
    const documents = result.chunks.map(chunk => ({
      content: chunk.text,
      metadata: chunk.metadata
    }));
    
    const memory = state.deps.memory;
    if (!memory || typeof memory.store !== 'function') {
      throw new Error(`Memory adapter is not properly configured. Has store method: ${typeof memory?.store}`);
    }
    
    await memory.store(documents, state.context.project);
    
    console.log(`✅ ${result.chunks.length} lesson chunks stored to memory (batch)`);
    if (sessionId && runId) {
      console.log(`🔗 Linked to session: ${sessionId}, run: ${runId}`);
    }
  } catch (error) {
    console.error('⚠️  Failed to store lessons to memory:', error instanceof Error ? error.message : error);
    console.log('   Continuing without memory storage...');
  }
}

/**
 * Extract structured lessons from design generation
 */
export function extractDesignLessons(state: DesignGraphState): string {
  const sections: string[] = [];
  
  sections.push(`## Design Session`);
  sections.push(`**Project**: ${state.context.project}`);
  sections.push(`**Feature**: ${state.context.featureFolder || 'main'}`);
  sections.push(`**Timestamp**: ${new Date().toISOString()}`);
  
  if (state.planText) {
    sections.push(`\n## Design Approach Summary`);
    const thinkingMatch = state.planText.match(/=== THINKING ===([\s\S]*?)=== END THINKING ===/);
    if (thinkingMatch) {
      const thinking = thinkingMatch[1].trim();
      sections.push(thinking.substring(0, 1500) + (thinking.length > 1500 ? '...' : ''));
    } else {
      sections.push(state.planText.substring(0, 1000) + (state.planText.length > 1000 ? '...' : ''));
    }
  }
  
  const designContent = new ArtifactPoolView(state.artifacts || []).firstDesignContent();
  if (designContent) {
    sections.push(`\n## Previous Design Reference`);
    const summary = designContent.substring(0, 300);
    sections.push(summary + (designContent.length > 300 ? '...\n[Full previous design available in session artifacts]' : ''));
  }
  
  if (state.directive) {
    sections.push(`\n## Directive Applied`);
    if (state.directive.length > 2000) {
      sections.push(state.directive.substring(0, 2000) + '\n...\n[Full directive available in session artifacts]');
    } else {
      sections.push(state.directive);
    }
  }
  
  sections.push(`\n## Design Document Summary`);
  
  const primaryDesign = pickPrimaryDesignFile(state.files as DesignOutputFile[] | undefined);

  if (primaryDesign) {
    const lines = primaryDesign.content.split('\n').length;
    sections.push(`**File**: ${primaryDesign.path}`);
    sections.push(`**Length**: ${lines} lines`);
    
    const headings = primaryDesign.content.match(/^#{1,3}\s+(.+)$/gm);
    if (headings && headings.length > 0) {
      sections.push(`\n**Key Sections**:`);
      for (const heading of headings.slice(0, 10)) {
        sections.push(`- ${heading}`);
      }
    }
  } else {
    sections.push(`**No design document generated**`);
  }
  
  sections.push(`\n## Key Design Decisions`);
  sections.push(extractDesignDecisions(state));
  
  return sections.join('\n');
}

/**
 * Extract key design decisions from the design document
 */
export function extractDesignDecisions(state: DesignGraphState): string {
  const decisions: string[] = [];
  
  const primaryDesign = pickPrimaryDesignFile(state.files as DesignOutputFile[] | undefined);
  
  if (!primaryDesign) {
    return '- No design document available for analysis';
  }
  
  const markdown = primaryDesign.content;
  
  const techMatch = markdown.match(/(?:technology|tech stack|framework|language)[\s:]+([^\n]+)/i);
  if (techMatch) {
    decisions.push(`- **Technology**: ${techMatch[1].trim()}`);
  }
  
  const archMatch = markdown.match(/(?:architecture|pattern)[\s:]+([^\n]+)/i);
  if (archMatch) {
    decisions.push(`- **Architecture**: ${archMatch[1].trim()}`);
  }
  
  const dbMatch = markdown.match(/(?:database|storage)[\s:]+([^\n]+)/i);
  if (dbMatch) {
    decisions.push(`- **Database**: ${dbMatch[1].trim()}`);
  }
  
  if (decisions.length === 0) {
    decisions.push(`- Design approach documented in ${markdown.split('\n').length} lines`);
  }
  
  return decisions.join('\n');
}

/**
 * Strip _meta field from JSON content
 * _meta is used for chapter tracking during generation, not needed in final output
 */
export function stripMetaFromContent(filename: string, content: string): string {
  const isJsonFile = filename.endsWith('.json');
  
  if (isJsonFile) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && '_meta' in parsed) {
        const { _meta, ...rest } = parsed;
        return JSON.stringify(rest, null, 2);
      }
    } catch {
      // Parse error, return as-is
    }
  }
  
  return content;
}
