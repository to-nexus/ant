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
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'writeFiles', taskInfo);
  }
  
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort is required for writeFiles node");
  }
  
  // ✅ Use pre-resolved featurePath (should be set by resolve node)
  if (!state.context.featurePath) {
    throw new Error("featurePath is required in ProjectContext. Ensure resolve node has run.");
  }
  
  // ✅ NEW: Use files[] array (supports multi-file design)
  const filesToWrite = state.files || [];
  
  if (filesToWrite.length === 0) {
    console.error(`❌ [writeFiles] No files to write!`);
    console.error(`   state.files: ${state.files?.length || 0}`);
    throw new Error("Cannot write design files: no content provided");
  }
  
  console.log(`\n📝 [writeFiles] Writing ${filesToWrite.length} design file(s)...`);
  console.log(`   Feature path: ${state.context.featurePath}`);
  
  // ✅ Write all files
  for (const file of filesToWrite) {
    // Resolve absolute path
    const absolutePath = path.isAbsolute(file.path)
      ? file.path
      : path.join(state.context.featurePath, file.path);
    
    // Ensure directory exists
    const fileDir = path.dirname(absolutePath);
    await gitPort.createDirectory(fileDir);
    
    // ✅ Handle actionType: append vs write (create/edit/delete)
    const actionType = file.actionType || 'create';
    
    if (actionType === 'append') {
      // ✅ Append to existing file
      console.log(`   📄 ${file.path}: ${file.content.length} chars (append)`);
      
      // Read existing content (if file exists)
      let existingContent = '';
      try {
        const fileExists = await gitPort.fileExists(absolutePath);
        if (fileExists) {
          const fileContent = await gitPort.readFile(absolutePath);
          existingContent = fileContent || '';  // ✅ Handle null case
          
          // ✅ Remove old metadata comment (last non-empty line if it's LAST_SECTION)
          const lines = existingContent.split('\n');
          // Find last non-empty line
          let lastLineIndex = lines.length - 1;
          while (lastLineIndex >= 0 && lines[lastLineIndex].trim() === '') {
            lastLineIndex--;
          }
          
          if (lastLineIndex >= 0) {
            const lastLine = lines[lastLineIndex].trim();
            if (lastLine.match(/^<!-- LAST_SECTION: \d+ -->$/)) {
              lines.splice(lastLineIndex, 1);  // Remove metadata line
              existingContent = lines.join('\n');
              console.log(`   🧹 Removed old metadata comment from line ${lastLineIndex + 1}`);
            }
          }
        }
      } catch (error) {
        // File doesn't exist, start fresh
        console.log(`   ℹ️  File doesn't exist yet, creating: ${file.path}`);
      }
      
      // Append new content (which should include new metadata at the end)
      const mergedContent = existingContent + '\n' + file.content;
      await gitPort.writeFile(absolutePath, mergedContent);
      console.log(`   ✅ Appended ${file.content.length} chars (total: ${mergedContent.length} chars)`);
    } else {
      // ✅ Create/overwrite file (create, edit, or delete)
      console.log(`   📄 ${file.path}: ${file.content.length} chars (${actionType})`);
      await gitPort.writeFile(absolutePath, file.content);
    }
  }
  
  console.log(`✅ [writeFiles] ${filesToWrite.length} file(s) saved`);
  
  // ✅ Clean up buffer files on successful write
  try {
    const { StreamBufferManager } = await import('../../../../../core/streaming/buffer/StreamBufferManager');
    const projectPath = state.context.featurePath.replace(`/features/${state.context.featureFolder}`, '');
    const jobId = state._httpJobId || `design-${Date.now()}`;
    const bufferManager = new StreamBufferManager(projectPath, state.context.featureFolder || 'default', 'design', jobId);
    
    // ✅ CRITICAL: Load buffers from disk first before cleanup
    const loadedBuffers = bufferManager.loadBuffersFromDisk();
    console.log(`🧹 [writeFiles] Loaded ${loadedBuffers.size} buffer(s) from disk for cleanup`);
    
    bufferManager.cleanupAll();
    console.log(`🧹 [writeFiles] Buffer files cleaned up`);
  } catch (error) {
    console.warn(`⚠️  [writeFiles] Failed to cleanup buffers (non-critical):`, error);
  }
  
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
  
  return state;
}

