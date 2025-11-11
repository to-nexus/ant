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
  
  // Save system design document to file
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
    `system-design-${state.context.project}-${Date.now()}.md`
  );
  await gitPort.writeFile(designFilePath, state.designMarkdown);
  console.log(`📐 System design saved: ${designFilePath}`);
  
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

