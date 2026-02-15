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
  // ✅ Increment recursion count (track node execution for UI gauge)
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
      state._httpJobId, 'learn', (state as any).workerId ?? 0, taskInfo,
      undefined, state.recursionCount, state.recursionLimit
    );
  }
  
  // ✅ Update Kanban to show all tasks completed
  // Skip in worker context — orchestrator handles kanban for parallel mode
  // (worker's learn would overwrite multi-task kanban with only this worker's completed tasks)
  const _workerId = (state as any).workerId;
  const _isWorkerContext = _workerId !== undefined && _workerId !== null;
  if (!_isWorkerContext && state._httpJobId && state.deps?.kanbanUpdate) {
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
  // - All Design documents: outputs/design/ (system-design, ui-design both go here)
  const loadedFiles: Array<{ path: string; content: string; actionType: 'create' | 'append' | 'edit' }> = [];
  
  if (state.deps?.fileSystem && state.context.featurePath) {
    const path = await import('path');
    const fileSystem = state.deps.fileSystem;
    
    // FileSystemPort expects paths relative to workspace root.
    // featurePath is an absolute path, so convert it.
    const rootPath = fileSystem.getRootPath?.() || '';
    const featureDirRel = rootPath
      ? path.relative(rootPath, state.context.featurePath)
      : state.context.featurePath.replace(/^\//, '');
    
    // ✅ All design documents go to outputs/design
    const designDirRel = path.join(featureDirRel, 'outputs/design');
    
    const isUiDesign = state.detectionReport?.workType === 'ui-design';
    const expectedFiles = isUiDesign
      ? ['ui-tokens.json', 'ui-assets.json', 'ui-spec.json']
      : undefined;  // Any .md files for system design
    
    console.log(`📂 [Learn] Checking ${isUiDesign ? 'UI Design' : 'System Design'} files in outputs/design...`);
    
    try {
      const dirExists = await fileSystem.fileExists(designDirRel);
      if (dirExists) {
        const entries = await fileSystem.readDirectory(designDirRel);
        let mdFiles = entries
          .filter(e => !e.isDirectory && e.name.endsWith('.md'))
          .map(e => e.name);
        
        // For UI Design, only load expected JSON files
        if (expectedFiles) {
          const allFiles = entries
            .filter(e => !e.isDirectory)
            .map(e => e.name);
          mdFiles = allFiles.filter(f => expectedFiles.includes(f));
        }
        
        console.log(`📂 [Learn] Loading ${mdFiles.length} design document(s) from disk...`);
        
        for (const filename of mdFiles) {
          const filePath = path.join(designDirRel, filename);
          let content = await fileSystem.readFile(filePath);
          
          // ✅ Clean up _meta field from JSON files (chapter tracking metadata)
          if (content && isUiDesign) {
            content = stripMetaFromContent(filename, content);
            // Write cleaned content back to disk
            await fileSystem.writeFile(filePath, content);
            console.log(`   🧹 Cleaned _meta from: ${filename}`);
          }
          
          const relativePath = `outputs/design/${filename}`;
          
          loadedFiles.push({
            path: relativePath,
            content: content || '',
            actionType: 'create'
          });
          
          console.log(`   ✅ Loaded: ${filename} (${(content || '').length} chars)`);
        }
      }
    } catch (error) {
      console.warn(`⚠️  [Learn] Failed to load design files:`, error);
    }
  }
  
  if (loadedFiles.length === 0) {
    throw new Error(`No design files found in outputs/design/ - docGen nodes must have run`);
  }
  
  // ✅ Update state.files for downstream processing (lessons extraction, session save, etc.)
  state.files = loadedFiles;
  
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
    
    console.log(`💾 Session turn saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/architect/design.json`);
  }
  
  // 3. Store lessons to vector memory + Index documents
  if (state.deps?.memory && state.deps?.chunk) {
    await storeLessonsToMemory(state, lessons, sessionId, turnId);
    
    // ✅ Request GC if available (helps with memory pressure before document indexing)
    if (global.gc) {
      global.gc();
      console.log(`🧹 [Design Learn] Requested garbage collection before document indexing`);
    }
    
  }
  
  // ✅ End workflow visualization
  // CRITICAL: Skip in worker context! Each worker runs learn after its task.
  // If worker calls endJob, it prematurely terminates workflow visualization
  // while other workers are still running. Only the MAIN graph's learn should end the job.
  if (!_isWorkerContext && state.deps?.workflowUpdate && state._httpJobId) {
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
  
  // Skip turn recording in worker context (only main orchestrator should record)
  const workerId = (state as any).workerId;
  if (workerId !== undefined && workerId !== null) return;
  
  const decisions = extractDesignDecisions(state).split('\n').filter(d => d.trim());
  
  // Create input summary (truncate if too long)
  const inputSummary = (state.directive || '').length > 200 
    ? (state.directive || '').substring(0, 197) + '...' 
    : (state.directive || '');
  
  // Create plan summary (first 3 lines)
  const planLines = state.planText.split('\n');
  const planSummary = planLines.slice(0, 3).join('\n') + (planLines.length > 3 ? '...' : '');
  
  const turn: SessionTurn = {
    turnId: 0, // Will be set by adapter
    job: 'design',
    timestamp: new Date().toISOString(),
    input: {
      type: 'file',
      source: 'inputs/sources/prd.md',
      summary: inputSummary,
      size: (state.directive || '').length,
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
        chatSource: state.chatSource,  // ✅ Save chat source flag
        detectionReport: state.detectionReport,  // ✅ Save for resume routing
      }
    }
  );
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
        job: 'design',
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
  
  // 3. Previous design reference (if refactor)
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

/**
 * Strip _meta field from JSON content
 * _meta is used for chapter tracking during generation, not needed in final output
 */
function stripMetaFromContent(filename: string, content: string): string {
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
