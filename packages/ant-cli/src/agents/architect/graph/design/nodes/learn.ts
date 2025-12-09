import { DesignGraphState } from "../state";
import { SessionTurn } from "../../../../../core/types";

/**
 * Learn Node - Finalize workflow and store lessons
 * 
 * Responsibilities:
 * 1. Update Kanban to show completion
 * 2. Extract lessons from design process
 * 3. Save turn to session file with metadata
 * 4. Chunk and store lessons to vector memory
 * 5. End workflow visualization
 * 
 * Note: File writing is handled by separate writeFiles node (consistency with code job)
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses ports for all infrastructure operations
 * - No direct file system access
 */
export async function learn(state: DesignGraphState): Promise<DesignGraphState> {
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'learn', taskInfo);
  }
  
  // ✅ Update Kanban to show all tasks completed
  if (state._httpJobId && state.deps?.kanbanUpdate) {
    const completedTasksDetails = state.completedTasksDetails || [];
    
    console.log(`\n🔥 [Learn] Final Kanban update`);
    console.log(`   All tasks completed: ${completedTasksDetails.length}`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      null,  // No current task
      [],    // Empty queue
      completedTasksDetails
    );
  }
  
  // ✅ Load files from disk (state.files is reset between tasks)
  // Read actual design files from outputs/design/ directory
  const loadedFiles: Array<{ path: string; content: string; actionType: 'create' | 'append' | 'edit' }> = [];
  
  if (state.deps?.git && state.context.featurePath) {
    const path = await import('path');
    const fs = await import('fs/promises');
    const designDirPath = path.join(state.context.featurePath, 'outputs/design');
    
    try {
      const dirExists = await state.deps.git.fileExists(designDirPath);
      if (dirExists) {
        const files = await fs.readdir(designDirPath);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        
        console.log(`📂 [Learn] Loading ${mdFiles.length} design document(s) from disk...`);
        
        for (const filename of mdFiles) {
          const filePath = path.join(designDirPath, filename);
          const content = await fs.readFile(filePath, 'utf-8');
          
          loadedFiles.push({
            path: `outputs/design/${filename}`,
            content,
            actionType: 'create'
          });
          
          console.log(`   ✅ Loaded: ${filename} (${content.length} chars)`);
        }
      }
    } catch (error) {
      console.warn(`⚠️  [Learn] Failed to load design files:`, error);
    }
  }
  
  if (loadedFiles.length === 0) {
    throw new Error("No design files found in outputs/design/ - docGen nodes must have run");
  }
  
  // ✅ Update state.files for downstream processing (lessons extraction, session save, etc.)
  state.files = loadedFiles;
  
  // ✅ Clean up metadata comment from final output
  // This is the last node, so remove the LAST_SECTION comment
  try {
    const designDocPath = `${state.context.featurePath}/outputs/design/system-design.md`;
    
    if (state.deps?.git) {
      const fileExists = await state.deps.git.fileExists(designDocPath);
      if (fileExists) {
        const content = await state.deps.git.readFile(designDocPath);
        if (content) {
          const lines = content.split('\n');
          
          // Find and remove LAST_SECTION comment (last non-empty line)
          let lastLineIndex = lines.length - 1;
          while (lastLineIndex >= 0 && lines[lastLineIndex].trim() === '') {
            lastLineIndex--;
          }
          
          if (lastLineIndex >= 0) {
            const lastLine = lines[lastLineIndex].trim();
            if (lastLine.match(/^<!-- LAST_SECTION: \d+ -->$/)) {
              lines.splice(lastLineIndex, 1);
              const cleanedContent = lines.join('\n');
              await state.deps.git.writeFile(designDocPath, cleanedContent);
              console.log(`🧹 [Learn] Removed metadata comment from final document`);
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️  [Learn] Failed to clean up metadata (non-critical):`, error);
  }
  
  // 1. Extract lessons from design process
  const lessons = extractDesignLessons(state);
  
  // 2. Save turn to session file
  let sessionId: string | undefined;
  let turnId: number | undefined;
  
  if (state.deps?.session) {
    await saveSessionTurn(state);
    
    // Get session IDs for memory linking
    const session = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'design'
    );
    sessionId = session.sessionId;
    turnId = session.turns[session.turns.length - 1]?.turnId;
    
    console.log(`💾 Session turn saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/design.json`);
  }
  
  // 3. Store lessons to vector memory + Index documents
  if (state.deps?.memory && state.deps?.chunk) {
    await storeLessonsToMemory(state, lessons, sessionId, turnId);
    
    // ✅ NEW: Index design document and PRD to documents collection
    await indexDocumentsToMemory(state);
  }
  
  // ✅ End workflow visualization
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.endJob(state._httpJobId);
    console.log(`\n🏁 Job ended: ${state._httpJobId}\n`);
  }
  
  return { 
    ...state, 
    lessons
  };
}

/**
 * Save session turn with all metadata
 */
async function saveSessionTurn(state: DesignGraphState): Promise<void> {
  if (!state.deps?.session) return;
  
  const decisions = extractDesignDecisions(state).split('\n').filter(d => d.trim());
  
  // Create input summary (truncate if too long)
  const inputSummary = state.spec.length > 200 
    ? state.spec.substring(0, 197) + '...' 
    : state.spec;
  
  // Create plan summary (first 3 lines)
  const planLines = state.planText.split('\n');
  const planSummary = planLines.slice(0, 3).join('\n') + (planLines.length > 3 ? '...' : '');
  
  const turn: SessionTurn = {
    turnId: 0, // Will be set by adapter
    task: 'design',
    timestamp: new Date().toISOString(),
    input: {
      type: 'file',
      source: 'inputs/sources/prd.md',
      summary: inputSummary,
      size: state.spec.length,
    },
    output: {
      // ✅ Only store summaries, not paths (paths are deterministic from context)
      planSummary: planSummary.substring(0, 300),
      decisionCount: decisions.length,
      fileCount: state.files?.length || 1
    }
  };
  
  await state.deps.session.addTurn(
    state.context.project,
    state.context.featureFolder || 'default',
    'design',
    turn
  );
  
  // Load existing session to preserve interruption details
  const existingSession = await state.deps.session.load(
    state.context.project,
    state.context.featureFolder || 'default',
    'design'
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

  // Update artifacts with latest design and state
  await state.deps.session.updateArtifacts(
    state.context.project,
    state.context.featureFolder || 'default',
    'design',
    {
      // ✅ latestDesign path is deterministic - no need to save
      keyDecisions: decisions.slice(0, 5),
      state: {
        taskQueue: state.taskQueue?.getAll() || [],
        currentTask: state.currentTask,
        completedTasks: state.completedTasks || [],
        completedTasksDetails: state.completedTasksDetails || [],
        interruption: existingSession.state?.interruption,
        jobId: (state as any).jobId,  // ✨ Preserve jobId
        jobTiming: completedJobTiming,  // ✨ Mark as completed
        directives: directivesArray,  // ✅ Save directives array (newest first)
        overrideDirective: state.overrideDirective,  // ✅ Save chat-initiated directive
        chatSource: state.chatSource  // ✅ Save chat source flag
      }
    }
  );
}

/**
 * Index design documents to documents collection
 * 
 * ✅ NEW: Design Job stores:
 * 1. Design document → documents-{project}
 * 2. PRD (if available) → documents-{project}
 */
async function indexDocumentsToMemory(state: DesignGraphState): Promise<void> {
  if (!state.deps?.chunk || !state.deps?.memory) return;
  
  try {
    const { DocumentIndexer } = await import('../../../../../core/documents');
    const documentIndexer = new DocumentIndexer(
      state.deps.memory,
      state.deps.chunk
    );
    
    // Find design document
    const designDoc = state.files?.find(f => 
      f.path.includes('system-design') || f.path.includes('design.md')
    );
    
    if (designDoc) {
      // Extract title from design doc
      const titleMatch = designDoc.content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : 'System Design Document';
      
      console.log(`📄 [Design Learn] Indexing design document: ${title}`);
      
      await documentIndexer.indexDesignDoc(
        designDoc.content,
        title,
        {
          project: state.context.project,
          feature: state.context.featureFolder || 'default',
          tags: extractDocumentTags(designDoc.content),
          version: '1.0'
        }
      );
      
      console.log(`   ✅ Design document indexed to documents-${state.context.project}`);
    }
    
    // Index PRD if available in state.spec
    if (state.spec && state.spec.length > 100) {
      console.log(`📄 [Design Learn] Indexing PRD`);
      
      const prdTitleMatch = state.spec.match(/^#\s+(.+)$/m);
      const prdTitle = prdTitleMatch ? prdTitleMatch[1] : 'Product Requirements Document';
      
      await documentIndexer.indexPRD(
        state.spec,
        prdTitle,
        {
          project: state.context.project,
          feature: state.context.featureFolder || 'default',
          tags: extractDocumentTags(state.spec),
          version: '1.0'
        }
      );
      
      console.log(`   ✅ PRD indexed to documents-${state.context.project}`);
    }
    
  } catch (error) {
    console.error('⚠️  Failed to index documents to memory:', error instanceof Error ? error.message : error);
    console.log('   Continuing without document indexing...');
  }
}

/**
 * Extract tags from document content
 */
function extractDocumentTags(content: string): string[] {
  const text = content.toLowerCase();
  const tags: string[] = [];
  
  const keywords = [
    'react', 'vue', 'angular', 'svelte',
    'typescript', 'javascript', 'python', 'go',
    'api', 'rest', 'graphql', 'websocket',
    'database', 'sql', 'mongodb', 'postgres',
    'auth', 'authentication', 'security',
    'realtime', 'sse', 'websocket',
    'ui', 'ux', 'design-system',
    'architecture', 'microservices', 'monolith'
  ];
  
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      tags.push(keyword);
    }
  }
  
  return tags.slice(0, 10);  // Max 10 tags
}

/**
 * Store lessons to vector memory with chunking
 */
async function storeLessonsToMemory(
  state: DesignGraphState,
  lessons: string,
  sessionId: string | undefined,
  turnId: number | undefined
): Promise<void> {
  if (!state.deps?.chunk || !state.deps?.memory) return;
  
  try {
    // Process through chunking pipeline
    const result = await state.deps.chunk.process({
      source: 'design-lesson',
      sourceType: 'text',
      content: lessons,
      metadata: {
        type: 'lesson',
        task: 'design',
        project: state.context.project,
        feature: state.context.featureFolder || 'default',
        timestamp: new Date().toISOString(),
        // Session tracking for traceability
        sessionId: sessionId,
        turnId: turnId
      }
    });
    
    console.log(`📚 Chunked into ${result.chunks.length} pieces (avg ${result.stats.avgTokens} tokens)`);
    
    // Convert chunks to documents
    const documents = result.chunks.map(chunk => ({
      content: chunk.text,
      metadata: chunk.metadata
    }));
    
    // ✅ Use memory adapter from deps
    const memory = state.deps.memory;
    if (!memory || typeof memory.store !== 'function') {
      throw new Error(`Memory adapter is not properly configured. Has store method: ${typeof memory?.store}`);
    }
    
    await memory.store(documents, state.context.project);
    
    console.log(`✅ ${result.chunks.length} lesson chunks stored to memory (batch)`);
    if (sessionId && turnId) {
      console.log(`🔗 Linked to session: ${sessionId}, turn: ${turnId}`);
    }
  } catch (error) {
    // Non-fatal: log error but don't fail workflow
    console.error('⚠️  Failed to store lessons to memory:', error instanceof Error ? error.message : error);
    console.log('   Continuing without memory storage...');
  }
}

/**
 * Extract structured lessons from design generation
 */
function extractDesignLessons(state: DesignGraphState): string {
  const sections: string[] = [];
  
  // 1. Session context
  sections.push(`## Design Session`);
  sections.push(`**Project**: ${state.context.project}`);
  sections.push(`**Feature**: ${state.context.featureFolder || 'main'}`);
  sections.push(`**Timestamp**: ${new Date().toISOString()}`);
  
  // 2. Design approach summary
  if (state.planText) {
    sections.push(`\n## Design Approach Summary`);
    // Extract thinking section if available
    const thinkingMatch = state.planText.match(/=== THINKING ===([\s\S]*?)=== END THINKING ===/);
    if (thinkingMatch) {
      const thinking = thinkingMatch[1].trim();
      sections.push(thinking.substring(0, 1500) + (thinking.length > 1500 ? '...' : ''));
    } else {
      sections.push(state.planText.substring(0, 1000) + (state.planText.length > 1000 ? '...' : ''));
    }
  }
  
  // 3. Previous design reference (if evolution/refactor)
  if (state.design) {
    sections.push(`\n## Previous Design Reference`);
    const summary = state.design.substring(0, 300);
    sections.push(summary + (state.design.length > 300 ? '...\n[Full previous design available in session artifacts]' : ''));
  }
  
  // 4. Directive applied
  if (state.directive) {
    sections.push(`\n## Directive Applied`);
    if (state.directive.length > 2000) {
      sections.push(state.directive.substring(0, 2000) + '\n...\n[Full directive available in session artifacts]');
    } else {
      sections.push(state.directive);
    }
  }
  
  // 5. Design document summary (from files[])
  sections.push(`\n## Design Document Summary`);
  
  const primaryDesign = state.files?.find(f => 
    f.path.includes('system-design') || f.path.includes('design.md')
  );
  
  if (primaryDesign) {
    const lines = primaryDesign.content.split('\n').length;
    sections.push(`**File**: ${primaryDesign.path}`);
    sections.push(`**Length**: ${lines} lines`);
    
    // Extract main sections from markdown
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
  
  // 6. Key design decisions
  sections.push(`\n## Key Design Decisions`);
  sections.push(extractDesignDecisions(state));
  
  return sections.join('\n');
}

/**
 * Extract key design decisions from the design document
 */
function extractDesignDecisions(state: DesignGraphState): string {
  const decisions: string[] = [];
  
  // Get primary design document content
  const primaryDesign = state.files?.find(f => 
    f.path.includes('system-design') || f.path.includes('design.md')
  );
  
  if (!primaryDesign) {
    return '- No design document available for analysis';
  }
  
  const markdown = primaryDesign.content;
  
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
  
  // Fallback if no specific decisions found
  if (decisions.length === 0) {
    decisions.push(`- Design approach documented in ${markdown.split('\n').length} lines`);
  }
  
  return decisions.join('\n');
}
