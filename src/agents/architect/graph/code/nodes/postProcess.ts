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
    console.log(`📝 Writing ${state.files.length} files to disk...`);
    
    for (const file of state.files) {
      await gitPort.writeFile(file.path, file.content);
      console.log(`   ✓ ${file.path}`);
    }
    
    console.log(`✅ All files written to disk\n`);

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
            console.log('✅ Dependencies installed successfully');
            if (result.stdout) {
              console.log(result.stdout.split('\n').slice(-5).join('\n')); // Last 5 lines
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

