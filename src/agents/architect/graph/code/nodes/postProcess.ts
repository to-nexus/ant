/**
 * Post-Process Node
 * 
 * Handles post-generation tasks BEFORE dynamic validation:
 * 0. Write generated files to disk (CRITICAL: must happen before validation)
 * 1. Package installation (if package.json changed)
 * 2. Git initialization (if new project)
 * 
 * This ensures dynamicValidate can check actual files on disk.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses CommandPort for command execution
 * - Uses GitPort for file operations
 */

import { ArchitectGraphState, Violation } from "../state";
import { CommandPort, GitPort } from "../../../../../core/ports";
import * as path from "path";

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

export async function postProcess(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;
  const violations: Violation[] = [];

  // Skip if no command port (optional dependency)
  if (!commandPort || !gitPort) {
    console.log('⚠️  CommandPort not available, skipping post-process');
    return state;
  }

  // Get target directory from config
  const config = state.context.config;
  if (!config || config.repoType !== 'local' || !config.localPath) {
    console.log('⚠️  No local repository path configured, skipping post-process');
    return state;
  }

  const repoRoot = await gitPort.getRepoRoot();
  const p = await import("path");
  
  // Resolve localPath (handle relative paths)
  const resolvedPath = p.isAbsolute(config.localPath)
    ? config.localPath
    : p.resolve(repoRoot, config.localPath);

  console.log(`\n🔧 Post-processing in: ${resolvedPath}\n`);

  try {
    // 0. CRITICAL: Write files to disk BEFORE validation/installation
    // This ensures dynamicValidate can actually check the files
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
    if (filesToDelete.length > 0) {
      console.log(`\n🗑️  DELETED FILES:\n`);
      for (const deletePath of filesToDelete) {
        const filePath = p.join(resolvedPath, deletePath);
        const relPath = p.relative(repoRoot, filePath);
        
        // Check if file exists before deleting
        const exists = await gitPort.fileExists(relPath);
        if (exists) {
          // TODO: Implement delete via GitPort
          console.log(`🗑️  DELETED   ${deletePath}`);
        } else {
          console.log(`⚠️  SKIP      ${deletePath} (not found)`);
        }
      }
    }
    
    // Summary
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📊 SUMMARY:`);
    console.log(`   ✨ New files:      ${newFiles}`);
    console.log(`   📝 Modified files: ${modifiedFiles}`);
    if (filesToDelete.length > 0) {
      console.log(`   🗑️  Deleted files:  ${filesToDelete.length}`);
    }
    console.log(`   📦 Total files:    ${state.files.length}`);
    console.log(`   💾 Total size:     ${formatFileSize(totalSize)}`);
    console.log(`${'='.repeat(80)}\n`);

    // 1. Check if package.json was generated or modified
    const hasPackageJson = state.files.some(f => 
      f.path.endsWith('package.json')
    );

    if (hasPackageJson) {
      console.log('📦 Detected package.json changes');
      
      // Check if package.json exists in target directory
      const pkgJsonPath = p.join(resolvedPath, 'package.json');
      const pkgExists = await gitPort.fileExists(p.relative(repoRoot, pkgJsonPath));

      if (pkgExists) {
        // Detect package manager
        const pm = await commandPort.detectPackageManager(resolvedPath);
        
        if (pm) {
          console.log(`📦 Installing dependencies with ${pm}...`);
          
          const result = await commandPort.execute(`${pm} install`, {
            cwd: resolvedPath,
            timeout: 10 * 60 * 1000, // 10 minutes for install
          });

          if (result.success) {
            console.log('✅ npm install completed');
            
            // ✅ Show last 10 lines of stdout (not just 5)
            if (result.stdout) {
              const lines = result.stdout.split('\n').filter(l => l.trim());
              console.log(lines.slice(-10).join('\n'));
            }
            
            // ✅ Check stderr for warnings (even on success)
            if (result.stderr && result.stderr.trim().length > 0) {
              console.log('\n⚠️  npm warnings/messages:');
              const lines = result.stderr.split('\n').filter(l => l.trim());
              console.log(lines.slice(-10).join('\n'));
            }
            
            // ✅ CRITICAL: Verify devDependencies were actually installed
            const fullOutput = (result.stdout || '') + '\n' + (result.stderr || '');
            
            // Check for NODE_ENV production warning
            if (process.env.NODE_ENV === 'production' || 
                fullOutput.toLowerCase().includes('node_env') ||
                fullOutput.includes('skipping devDependencies')) {
              
              console.warn('\n⚠️  WARNING: Detected potential devDependencies installation issue');
              console.warn(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
              
              // Verify TypeScript installation
              const verifyTsc = await commandPort.execute('npx tsc --version', {
                cwd: resolvedPath,
                timeout: 30000
              });
              
              if (!verifyTsc.success) {
                console.error('❌ CRITICAL: TypeScript not found after npm install');
                console.log('🔧 AUTOMATIC FIX: Running npm install --include=dev\n');
                
                // ✅ AGENT ACTION: Automatically install devDependencies
                const fixResult = await commandPort.execute(`${pm} install --include=dev`, {
                  cwd: resolvedPath,
                  timeout: 10 * 60 * 1000
                });
                
                if (fixResult.success) {
                  console.log('✅ devDependencies installation completed');
                  
                  // Show last few lines
                  if (fixResult.stdout) {
                    const lines = fixResult.stdout.split('\n').filter(l => l.trim());
                    console.log(lines.slice(-5).join('\n'));
                  }
                  
                  // Verify TypeScript again
                  const verifyAgain = await commandPort.execute('npx tsc --version', {
                    cwd: resolvedPath,
                    timeout: 30000
                  });
                  
                  if (verifyAgain.success) {
                    console.log(`\n✅ TypeScript successfully installed: ${verifyAgain.stdout.trim()}`);
                    console.log('✅ Environment issue automatically resolved!\n');
                  } else {
                    // Still failed - deeper issue
                    console.error('❌ TypeScript still not available after --include=dev');
                    
                    violations.push({
                      type: 'environment_issue',
                      severity: 'critical',
                      message: `TypeScript installation failed even after npm install --include=dev.

This indicates a deeper environment issue that requires manual intervention.

Please check:
1. File permissions in ${resolvedPath}
2. npm configuration: npm config list
3. .npmrc file settings
4. Node.js version compatibility`,
                      suggestedFix: 'Manual environment troubleshooting required',
                      isRetryable: false
                    });
                  }
                } else {
                  // npm install --include=dev itself failed
                  console.error('❌ npm install --include=dev failed');
                  console.error(fixResult.stderr);
                  
                  violations.push({
                    type: 'environment_issue',
                    severity: 'critical',
                    message: `Automatic fix attempt failed: ${fixResult.stderr}`,
                    suggestedFix: 'Manual intervention required',
                    isRetryable: false
                  });
                }
              } else {
                console.log('✅ TypeScript verified: ' + verifyTsc.stdout.trim());
              }
            }
            
          } else {
            console.error('❌ Dependency installation failed:');
            console.error(result.stderr);
            
            // ✅ Add to violations so LLM can see and fix
            violations.push({
              type: 'missing_dependency',
              severity: 'critical',
              message: `Dependency installation failed:\n${result.stderr}`,
              suggestedFix: 'Check package.json for incorrect package versions or missing packages',
              isRetryable: false  // Needs fixing package.json
            });
          }
        } else {
          console.log('⚠️  Could not detect package manager');
        }
      }
    }

    // 2. Check if Git repository needs initialization
    const isNewProject = state.files.length > 0 && 
                         !state.codeHead && 
                         state.codeMode === 'generate';

    if (isNewProject) {
      // Check if .git exists
      const gitPath = p.join(resolvedPath, '.git');
      const gitExists = await gitPort.fileExists(p.relative(repoRoot, gitPath));

      if (!gitExists) {
        console.log('🔧 Initializing Git repository...');
        
        const result = await commandPort.execute('git init', {
          cwd: resolvedPath,
        });

        if (result.success) {
          console.log('✅ Git repository initialized');
        } else {
          console.error('⚠️  Git init failed:', result.stderr);
        }
      }
    }

  } catch (error: any) {
    console.error('⚠️  Post-process error:', error.message);
    violations.push({
      type: 'other',
      severity: 'major',
      message: `Post-process error: ${error.message}`,
      suggestedFix: 'Check file system permissions or command execution',
      isRetryable: false
    });
  }

  // ✅ Return with violations if any
  return {
    ...state,
    violations: [...(state.violations || []), ...violations]
  };
}

