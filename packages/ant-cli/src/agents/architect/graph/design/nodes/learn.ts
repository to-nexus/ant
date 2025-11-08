import * as path from "path";
import { DesignGraphState } from "../state";
import { SessionTurn } from "../../../../../core/types";

/**
 * Learn node - Complete workflow finalization:
 * 1. Extract learnings from design
 * 2. Save design document to file
 * 3. Chunk and store learnings to memory
 * 4. Save turn to session file
 * 
 * This is the final node that performs all side effects.
 * Depends on GitPort, ChunkPort and SessionPort (injected via deps) - follows hexagonal architecture.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations (not fs directly)
 * - No direct infrastructure dependencies
 */
export async function learn(state: DesignGraphState): Promise<DesignGraphState> {
  // ✅ Workflow instrumentation: Enter node FIRST
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'learn', taskInfo);
  }
  
  // ✅ Update Kanban AFTER workflow tracking
  // This ensures workflow node is added to queue before Kanban update triggers UI changes
  if (state._httpTaskId && state.taskQueue) {
    const queueTasks = state.taskQueue.getAll();
    const completedTasksDetails = state.completedTasksDetails || [];
    
    console.log(`\n🔥 [Design Learn] Updating Kanban - all tasks complete`);
    console.log(`   Queue remaining: ${queueTasks.length}`);
    console.log(`   Completed: ${completedTasksDetails.length}`);
    
    if (state.deps?.kanbanUpdate) {
      // In-process: use injected port
      console.log(`   Method: Direct port call\n`);
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpTaskId,
        undefined,  // No current task (all complete)
        queueTasks,
        completedTasksDetails
      );
    } else {
      // Child process: HTTP API fallback
      console.log(`   Method: HTTP API fallback\n`);
      const serverPort = process.env.ANT_SERVER_PORT || '4100';
      try {
        const response = await fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: state._httpTaskId,
            currentTask: undefined,
            queue: queueTasks,
            completedTasks: completedTasksDetails
          })
        });
        
        if (response.ok) {
          console.log(`   ✅ HTTP update successful\n`);
        } else {
          console.log(`   ⚠️  HTTP update failed: ${response.status} ${response.statusText}\n`);
        }
      } catch (err: any) {
        console.log(`   ⚠️  HTTP update error: ${err.message}\n`);
      }
    }
  }
  
  // Get GitPort for file operations
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for file saving");
  }
  
  // 1. Extract learnings
  const learnings = extractDesignLearnings(state);
  
  // 2. Save system design document to file
  const designDir = path.join(
    "workspace",
    state.context.project,
    state.context.featureFolder || "default",
    "outputs",
    "design"
  );
  await gitPort.createDirectory(designDir);
  
  const designFilePath = path.join(
    designDir, 
    `system-design-${state.context.project}-${Date.now()}.md`  // ✅ Renamed to system-design
  );
  await gitPort.writeFile(designFilePath, state.designMarkdown);
  console.log(`📐 System design saved: ${designFilePath}`);
  
  // 3. Save turn to session file first (to get sessionId and turnId)
  let sessionId: string | undefined;
  let turnId: number | undefined;
  
  if (state.deps?.session) {
    const decisions = extractDesignDecisions(state).split('\n').filter(d => d.trim());
    
    // Load session to get sessionId
    const session = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default'
    );
    sessionId = session.sessionId;
    
    // Create input summary (truncate PRD to 200 chars)
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
        source: 'inputs/sources/prd.md',  // Reference to source file
        summary: inputSummary,
        size: state.spec.length,
      },
      output: {
        designPath: designFilePath,
        planSummary: planSummary.substring(0, 300),  // Brief summary only
        decisionCount: decisions.length
      }
    };
    
    await state.deps.session.addTurn(
      state.context.project,
      state.context.featureFolder || 'default',
      'design',  // ✅ Specify job type
      turn
    );
    
    // Get the turnId that was assigned
    const updatedSession = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'design'  // ✅ Specify job type
    );
    turnId = updatedSession.turns[updatedSession.turns.length - 1]?.turnId;
    
    // ✅ Load existing session to preserve interruption details and other state
    const existingSession = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'design'  // ✅ Specify job type
    );

    // Update artifacts (no latestPlan to avoid duplication)
    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder || 'default',
      'design',  // ✅ Specify job type
      {
        latestDesign: designFilePath,
        keyDecisions: decisions.slice(0, 5),  // Only top 5 decisions
        state: {
          taskQueue: state.taskQueue?.getAll() || [],
          currentTask: state.currentTask,
          completedTasks: state.completedTasks || [],
          completedTasksDetails: state.completedTasksDetails || [],  // ✅ Preserve completed task details
          interruption: existingSession.state?.interruption  // ✅ Preserve interruption details
        }
      }
    );
    
        console.log(`💾 Session turn saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/design.json`);
  }
  
  // 4. Chunk and store learnings to memory with session tracking
  if (state.context.memory && state.deps?.chunk) {
    try {
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
      const memory = state.context.memory as any;
      await memory.store(documents, state.context.project);
      
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
  
  // ✅ CRITICAL: End job to stop workflow visualization
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    state.deps.workflowUpdate.endJob(state._httpTaskId);
    console.log(`\n🏁 Job ended: ${state._httpTaskId}\n`);
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
  
  // 2. Design Plan (summarized to reduce memory)
  if (state.planText) {
    sections.push(`\n## Design Approach Summary`);
    // Extract key points from plan (THINKING section only)
    const thinkingMatch = state.planText.match(/=== THINKING ===([\s\S]*?)=== END THINKING ===/);
    if (thinkingMatch) {
      const thinking = thinkingMatch[1].trim();
      sections.push(thinking.substring(0, 1500) + (thinking.length > 1500 ? '...' : ''));
    } else {
      sections.push(state.planText.substring(0, 1000) + (state.planText.length > 1000 ? '...' : ''));
    }
  }
  
  // 3. Previous Design Context (keep minimal reference)
  if (state.design) {
    sections.push(`\n## Previous Design Reference`);
    const summary = state.design.substring(0, 300);
    sections.push(summary + (state.design.length > 300 ? '...\n[Full previous design available in session artifacts]' : ''));
  }
  
  // 4. Directive Applied (summarized if too long)
  if (state.directive) {
    sections.push(`\n## Directive Applied`);
    if (state.directive.length > 2000) {
      sections.push(state.directive.substring(0, 2000) + '\n...\n[Full directive available in session artifacts]');
    } else {
      sections.push(state.directive);
    }
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

