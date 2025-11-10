/**
 * Write Files Node
 * 
 * ✅ CRITICAL: Write generated files to disk IMMEDIATELY after parsing
 * This ensures files are persisted even if recursion limit is hit.
 * 
 * This node:
 * - Writes all generated files to disk
 * - Handles file deletions
 * - Reports file operations
 * - Does NOT run validation (that comes next)
 * - Does NOT install dependencies (that comes after validation)
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations
 */

import { ArchitectGraphState } from "../state";
import * as path from "path";
import { resolveLocalPath } from "../../../../../periphery/adapters/git/gitUtils";

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export async function writeFiles(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
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
    console.log('⚠️  GitPort not available, skipping file write');
    return state;
  }

  // Get target directory from config
  const config = state.context.config;
  if (!config || config.repoType !== 'local' || !config.localPath) {
    console.log('⚠️  No local repository path configured, skipping file write');
    return state;
  }

  const repoRoot = await gitPort.getRepoRoot();
  const p = await import("path");
  
  // ✅ Use resolveLocalPath to properly handle tilde (~) expansion
  const resolvedPath = resolveLocalPath(config.localPath, state.context.project);

  console.log(`\n🔧 Post-processing in: ${resolvedPath}\n`);

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📝 FILE OPERATIONS REPORT`);
    console.log(`${'='.repeat(80)}\n`);
    
    // Track file statistics
    let newFiles = 0;
    let modifiedFiles = 0;
    let totalSize = 0;
    
    for (const file of state.files) {
      const filePath = p.join(resolvedPath, file.path);
      const relPath = p.relative(repoRoot, filePath);
      
      // Check if file exists (to determine if new or modified)
      const exists = await gitPort.fileExists(relPath);
      const operation = exists ? '📝 MODIFIED' : '✨ CREATED';
      
      if (exists) {
        modifiedFiles++;
      } else {
        newFiles++;
      }
      
      // Calculate file size
      const sizeInBytes = Buffer.byteLength(file.content, 'utf8');
      totalSize += sizeInBytes;
      const sizeStr = formatFileSize(sizeInBytes);
      
      // Count lines
      const lines = file.content.split('\n').length;
      
      // Write file
      await gitPort.writeFile(file.path, file.content);
      
      // Print detailed report
      console.log(`${operation}  ${file.path}`);
      console.log(`           Size: ${sizeStr.padEnd(10)} Lines: ${lines}`);
    }
    
    // Handle file deletions if any
    const filesToDelete = state.filesToDelete || [];
    let deletedFiles = 0;
    if (filesToDelete.length > 0) {
      console.log(`\n🗑️  DELETED FILES:\n`);
      for (const deletePath of filesToDelete) {
        // ✅ Normalize path: remove absolute path if present
        let normalizedPath = deletePath;
        
        // If path is absolute and matches resolvedPath, make it relative
        if (p.isAbsolute(deletePath)) {
          if (deletePath.startsWith(resolvedPath)) {
            normalizedPath = p.relative(resolvedPath, deletePath);
          } else if (deletePath.startsWith(repoRoot)) {
            normalizedPath = p.relative(repoRoot, deletePath);
          } else {
            console.log(`⚠️  SKIP      ${deletePath} (absolute path outside project)`);
            continue;
          }
        }
        
        // Check if file exists before deleting
        const exists = await gitPort.fileExists(normalizedPath);
        if (exists) {
          try {
            await gitPort.deleteFile(normalizedPath);
            console.log(`🗑️  DELETED   ${normalizedPath}`);
            deletedFiles++;
          } catch (error) {
            console.error(`❌ FAILED    ${normalizedPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        } else {
          console.log(`⚠️  SKIP      ${normalizedPath} (not found)`);
        }
      }
    }
    
    // Summary
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📊 SUMMARY:`);
    console.log(`   ✨ New files:      ${newFiles}`);
    console.log(`   📝 Modified files: ${modifiedFiles}`);
    if (deletedFiles > 0) {
      console.log(`   🗑️  Deleted files:  ${deletedFiles}`);
    }
    console.log(`   📦 Total files:    ${state.files.length}`);
    console.log(`   💾 Total size:     ${formatFileSize(totalSize)}`);
    console.log(`${'='.repeat(80)}\n`);
    
    // ✅ Notify file tree update for real-time UI refresh
    if (state.deps?.fileTreeUpdate && state.context.project && state.context.featureFolder) {
      const featureName = path.basename(state.context.featureFolder);
      state.deps.fileTreeUpdate.notifyFileTreeUpdate(state.context.project, featureName);
      console.log(`📡 File tree update notification sent to UI\n`);
    }

  } catch (error: any) {
    console.error('⚠️  File write error:', error.message);
    // Don't fail on write errors - continue to validation
  }

  return state;
}

