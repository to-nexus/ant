import * as path from "path";
import { DesignGraphState } from "../state";

/**
 * WriteFiles Node
 * Write design document to file system
 * 
 * Separated from learn node to maintain consistency with code job workflow:
 * - execute: Generate content (in-memory)
 * - writeFiles: Persist to disk
 * - learn: Store learnings and finalize
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations (not fs directly)
 */
export async function writeFiles(state: DesignGraphState): Promise<DesignGraphState> {
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'writeFiles', taskInfo);
  }
  
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort is required for writeFiles node");
  }
  
  // ✅ Use pre-resolved featurePath (should be set by resolve node)
  if (!state.context.featurePath) {
    throw new Error("featurePath is required in ProjectContext. Ensure resolve node has run.");
  }
  
  // ✅ Validate designMarkdown exists
  if (!state.designMarkdown || state.designMarkdown.trim().length === 0) {
    console.error(`❌ [writeFiles] state.designMarkdown is empty or undefined!`);
    console.error(`   state.designMarkdown: ${state.designMarkdown ? `"${state.designMarkdown.substring(0, 100)}..."` : 'undefined/null'}`);
    throw new Error("Cannot write design file: state.designMarkdown is empty");
  }
  
  console.log(`\n📝 [writeFiles] Writing design document...`);
  console.log(`   Content length: ${state.designMarkdown.length} chars`);
  console.log(`   Feature path (from WorkspaceResolver): ${state.context.featurePath}`);
  
  // ✅ Use absolute path from WorkspaceResolver (already resolved correctly)
  const designDir = path.join(
    state.context.featurePath,
    "outputs",
    "design"
  );
  
  console.log(`   Target directory: ${designDir}`);
  await gitPort.createDirectory(designDir);
  
  const designFilePath = path.join(
    designDir, 
    `system-design-${state.context.project}-${Date.now()}.md`
  );
  
  console.log(`   Writing to: ${designFilePath}`);
  await gitPort.writeFile(designFilePath, state.designMarkdown);
  console.log(`✅ [writeFiles] System design saved: ${designFilePath}`);
  
  // ✅ Broadcast file tree update
  if (state.deps?.fileTreeUpdate) {
    const featureName = state.context.featureFolder || 'default';
    console.log(`📡 Notifying file tree update: ${state.context.project}/${featureName}`);
    await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
      state.context.project,
      featureName
    );
    console.log(`✅ File tree update notification sent\n`);
  } else {
    console.warn('⚠️  fileTreeUpdate dependency not available - UI may not update automatically');
  }
  
  return { 
    ...state, 
    designFilePath 
  };
}

