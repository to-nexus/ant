/**
 * Install Dependencies Node
 * 
 * Handles post-validation tasks:
 * 1. Package installation (if package.json changed)
 * 2. Git initialization (if new project)
 * 
 * This runs AFTER validation to ensure we don't install dependencies
 * for invalid code (ellipsis, excessive deletion, etc.)
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses CommandPort for command execution
 * - Uses GitPort for file operations
 */

import { ArchitectGraphState, Violation } from "../state";
import { resolveLocalPath } from "../../../../../periphery/adapters/git/gitUtils";

export async function installDeps(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;
  const violations: Violation[] = [];

  // Skip if no command port (optional dependency)
  if (!commandPort || !gitPort) {
    console.log('⚠️  CommandPort not available, skipping dependency installation');
    return state;
  }

  // Get target directory from config
  const config = state.context.config;
  if (!config || config.repoType !== 'local' || !config.localPath) {
    console.log('⚠️  No local repository path configured, skipping dependency installation');
    return state;
  }

  const repoRoot = await gitPort.getRepoRoot();
  const p = await import("path");
  
  // ✅ Use resolveLocalPath to properly handle tilde (~) expansion
  const resolvedPath = resolveLocalPath(config.localPath, state.context.project);

  try {
    // 1. Check if package.json was generated or modified
    const hasPackageJson = state.files.some(f => 
      f.path.endsWith('package.json')
    );

    if (hasPackageJson) {
      console.log('📦 Detected package.json changes in current task');
      
      // Check if package.json exists in target directory
      const pkgJsonPath = p.join(resolvedPath, 'package.json');
      const pkgExists = await gitPort.fileExists(p.relative(repoRoot, pkgJsonPath));

      if (pkgExists) {
        // Detect package manager
        const pm = await commandPort.detectPackageManager(resolvedPath);
        
        if (pm) {
          console.log(`📦 Installing dependencies with ${pm}...`);
          
          // ✅ CRITICAL FIX: Always use --include=dev if NODE_ENV=production
          let installCommand = `${pm} install`;
          if (process.env.NODE_ENV === 'production') {
            console.warn('⚠️  NODE_ENV=production detected - forcing devDependencies installation');
            installCommand = `${pm} install --include=dev`;
          }
          
          const result = await commandPort.execute(installCommand, {
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
              
              // ✅ CRITICAL FIX: Check if TypeScript exists in LOCAL node_modules (not global)
              const tscPath = p.join(resolvedPath, 'node_modules', 'typescript');
              const tscExists = await gitPort.fileExists(p.relative(repoRoot, tscPath));
              
              if (!tscExists) {
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
                  
                  // Verify TypeScript again in LOCAL node_modules
                  const tscPathAgain = p.join(resolvedPath, 'node_modules', 'typescript');
                  const tscExistsAgain = await gitPort.fileExists(p.relative(repoRoot, tscPathAgain));
                  
                  if (tscExistsAgain) {
                    console.log('\n✅ TypeScript successfully installed in local node_modules');
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
                console.log('✅ TypeScript found in local node_modules');
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
    } else if (state.currentTask?.type === 'feature') {
      // ✅ OPTIMIZATION: Skip install for feature tasks that don't modify package.json
      console.log('⏭️  Skipping dependency installation (package.json unchanged)');
      console.log(`   Task: ${state.currentTask.name}`);
      console.log(`   Type: ${state.currentTask.type}`);
      console.log(`   Rationale: Feature tasks only need install if dependencies change\n`);
    } else {
      console.log('⏭️  No package.json changes detected');
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
    console.error('⚠️  Dependency installation error:', error.message);
    violations.push({
      type: 'other',
      severity: 'major',
      message: `Dependency installation error: ${error.message}`,
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

