/**
 * Install Dependencies Node
 * 
 * Handles dependency installation based on detected project language.
 * 
 * This runs AFTER validation to ensure we don't install dependencies
 * for invalid code (ellipsis, excessive deletion, etc.)
 * 
 * Note: Infrastructure startup (docker-compose) is handled by the LLM
 * via tool calls during codeGen (final verification / error tasks).
 */

import { ArchitectGraphState, Violation } from "../state";
import { detectProject } from "./diagnostics";
import { Language } from "./diagnostics/types";
import { getProjectRuntime, ProjectRuntimeConfig } from "./projectRuntime";
import { isVerificationTask } from "../utils/taskClassification";

export async function installDeps(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📦 [installDeps] NODE ENTERED`);
  console.log(`   Task: ${state.currentTask?.name || 'none'}`);
  console.log(`   Priority: ${state.currentTask?.priority || 'none'}`);
  console.log(`   Next: runtimeValidate (via graph edge)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
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
      state._httpJobId, 
      'installDeps', 
      (state as any).workerId ?? 0,
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;
  const fileSystem = state.deps?.fileSystem!;
  const violations: Violation[] = [];

  // Skip if no command port (optional dependency)
  if (!commandPort || !gitPort) {
    console.log('⚠️  CommandPort not available, skipping dependency installation');
    
    // ✅ Workflow instrumentation: Exit node (skip path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'installDeps', (state as any).workerId ?? 0);
    }
    
    return state;
  }

  // ✅ Get codebase path (works for both local and cloud mode)
  const repoRoot = await gitPort.getRepoRoot();
  const p = await import("path");
  
  // repoRoot is already the codebase directory
  // For local mode: resolves from config.localPath
  // For cloud mode: resolves from workspaces/{org}/{user}/{project}/codebase
  const resolvedPath = repoRoot;
  
  console.log(`📂 Target directory: ${resolvedPath}`);

  try {
    // ✅ Detect project language and get runtime config
    const projectDetection = await detectProject(resolvedPath, gitPort, fileSystem);
    const runtime = getProjectRuntime(projectDetection);
    
    console.log(`🔍 Detected: ${projectDetection.language} (config: ${runtime.dependency.configFile || 'none'})`);

    // ✅ Check if the dependency config file was modified in current task
    const files = state.projectCodeContext?.files || [];
    const configChanged = runtime.dependency.configFile
      ? files.some(f => f.path.endsWith(runtime.dependency.configFile))
      : false;

    // ✅ Check if local cache directory exists (language-specific)
    const fileSystemBase = fileSystem.getRootPath();
    let cacheDirExists = true;  // Default true for languages with no local cache
    if (runtime.dependency.localCacheDir) {
      const cacheDirPath = p.join(resolvedPath, runtime.dependency.localCacheDir);
      const cacheDirRelative = p.relative(fileSystemBase, cacheDirPath);
      cacheDirExists = await fileSystem.fileExists(cacheDirRelative);
    }

    // ✅ Detect verification tasks (final, error, integration)
    const isFinalTask = state.currentTask ? isVerificationTask(state.currentTask) : false;

    // ✅ Use runtime config to decide if install is needed
    const shouldInstall = runtime.dependency.shouldInstall({
      configChanged,
      cacheDirExists,
      isFinalTask: !!isFinalTask,
    });

    if (!shouldInstall) {
      if (state.currentTask?.type === 'feature') {
        console.log(`⏭️  Skipping dependency installation (${runtime.dependency.configFile} unchanged${runtime.dependency.localCacheDir ? ` and ${runtime.dependency.localCacheDir} exists` : ''})`);
        console.log(`   Task: ${state.currentTask.name}`);
        console.log(`   Type: ${state.currentTask.type}\n`);
      } else {
        console.log(`⏭️  No ${runtime.dependency.configFile || 'dependency config'} changes detected, skipping install`);
      }
    } else {
      if (isFinalTask) {
        console.log('📦 Final verification task - forcing fresh dependency installation for build validation');
      } else if (configChanged) {
        console.log(`📦 Detected ${runtime.dependency.configFile} changes in current task`);
      } else if (!cacheDirExists && runtime.dependency.localCacheDir) {
        console.log(`📦 ${runtime.dependency.localCacheDir} not found - dependencies need to be installed`);
      }

      // ✅ Route to language-specific install handler
      switch (projectDetection.language) {
        case Language.TYPESCRIPT:
        case Language.JAVASCRIPT:
          await handleNodeInstall(
            resolvedPath, repoRoot, fileSystem, commandPort, violations, isFinalTask, p
          );
          break;

        case Language.GO:
          await handleGoInstall(
            runtime, resolvedPath, commandPort, violations, p,
            state.currentTask?.type === 'setup'
          );
          break;

        default:
          // Generic: attempt install if runtime provides a command
          await handleGenericInstall(
            runtime, resolvedPath, commandPort, violations, isFinalTask
          );
          break;
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

  // ✅ Workflow instrumentation: Exit node (success path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'installDeps', (state as any).workerId ?? 0);
  }
  
  // ✅ Return with violations if any
  return {
    ...state,
    violations: [...(state.violations || []), ...violations]
  };
}

// ─────────────────────────────────────────────────────────────
// Node.js / TypeScript install handler
// ─────────────────────────────────────────────────────────────

async function handleNodeInstall(
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  commandPort: any,
  violations: Violation[],
  isFinalTask: boolean | undefined,
  p: any,
): Promise<void> {
  const pkgJsonPath = p.join(resolvedPath, 'package.json');
  const fileSystemBase = fileSystem.getRootPath();
  const pkgJsonRelative = p.relative(fileSystemBase, pkgJsonPath);
  const pkgExists = await fileSystem.fileExists(pkgJsonRelative);

  if (!pkgExists) {
    console.log('⚠️  package.json not found in target directory');
    if (isFinalTask) {
      violations.push({
        type: 'missing_file',
        severity: 'critical',
        message: `Final verification requires a runnable Node-based project, but package.json was not found in the codebase.\n\nExpected at:\n- ${pkgJsonPath}\n\nThis usually means setup task wrote files to the wrong directory (project root instead of codebase) or skipped dependency scaffolding.`,
        suggestedFix: 'Create package.json in the codebase root and ensure all generated files are written under the codebase directory.',
        isRetryable: false
      });
    }
    return;
  }

  // Detect package manager
  const pm = await commandPort.detectPackageManager(resolvedPath);
  if (!pm) {
    console.log('⚠️  Could not detect package manager');
    return;
  }

  console.log(`📦 Installing dependencies with ${pm}...`);
  
  // ✅ Modern install policy:
  // - Many environments set `npm config set omit dev`, causing Vite/TS to disappear.
  // - For our code+UI workflows we almost always need devDependencies.
  let installCommand = `${pm} install`;
  const forceDevDeps =
    pm === 'npm' &&
    process.env.NODE_ENV !== 'production';

  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️  NODE_ENV=production detected - forcing devDependencies installation');
    installCommand = `${pm} install --include=dev`;
  } else if (forceDevDeps) {
    installCommand = `${pm} install --include=dev`;
  }
  
  const result = await commandPort.execute(installCommand, {
    cwd: resolvedPath,
    timeout: 10 * 60 * 1000,
  });

  if (result.success) {
    console.log('✅ npm install completed');
    
    if (result.stdout) {
      const lines = result.stdout.split('\n').filter((l: string) => l.trim());
      console.log(lines.slice(-10).join('\n'));
    }
    
    if (result.stderr && result.stderr.trim().length > 0) {
      console.log('\n⚠️  npm warnings/messages:');
      const lines = result.stderr.split('\n').filter((l: string) => l.trim());
      console.log(lines.slice(-10).join('\n'));
    }
    
    // ✅ CRITICAL: Verify devDependencies were actually installed
    const fullOutput = (result.stdout || '') + '\n' + (result.stderr || '');
    
    if (process.env.NODE_ENV === 'production' || 
        fullOutput.toLowerCase().includes('node_env') ||
        fullOutput.includes('skipping devDependencies')) {
      
      console.warn('\n⚠️  WARNING: Detected potential devDependencies installation issue');
      console.warn(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
      
      const tscPath = p.join(resolvedPath, 'node_modules', 'typescript');
      const tscExists = await fileSystem.fileExists(p.relative(repoRoot, tscPath));
      
      if (!tscExists) {
        console.error('❌ CRITICAL: TypeScript not found after npm install');
        console.log('🔧 AUTOMATIC FIX: Running npm install --include=dev\n');
        
        const fixResult = await commandPort.execute(`${pm} install --include=dev`, {
          cwd: resolvedPath,
          timeout: 10 * 60 * 1000
        });
        
        if (fixResult.success) {
          console.log('✅ devDependencies installation completed');
          
          if (fixResult.stdout) {
            const lines = fixResult.stdout.split('\n').filter((l: string) => l.trim());
            console.log(lines.slice(-5).join('\n'));
          }
          
          const tscPathAgain = p.join(resolvedPath, 'node_modules', 'typescript');
          const tscExistsAgain = await fileSystem.fileExists(p.relative(repoRoot, tscPathAgain));
          
          if (tscExistsAgain) {
            console.log('\n✅ TypeScript successfully installed in local node_modules');
            console.log('✅ Environment issue automatically resolved!\n');
          } else {
            console.error('❌ TypeScript still not available after --include=dev');
            violations.push({
              type: 'environment_issue',
              severity: 'critical',
              message: `TypeScript installation failed even after npm install --include=dev.\n\nThis indicates a deeper environment issue that requires manual intervention.\n\nPlease check:\n1. File permissions in ${resolvedPath}\n2. npm configuration: npm config list\n3. .npmrc file settings\n4. Node.js version compatibility`,
              suggestedFix: 'Manual environment troubleshooting required',
              isRetryable: false
            });
          }
        } else {
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
    violations.push({
      type: 'missing_dependency',
      severity: 'critical',
      message: `Dependency installation failed:\n${result.stderr}`,
      suggestedFix: 'Check package.json for incorrect package versions or missing packages',
      isRetryable: false
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Go install handler
// ─────────────────────────────────────────────────────────────

async function handleGoInstall(
  runtime: ProjectRuntimeConfig,
  resolvedPath: string,
  commandPort: any,
  violations: Violation[],
  p: any,
  isSetupTask: boolean = false,
): Promise<void> {
  const installCmd = runtime.dependency.getInstallCommand(undefined, { isSetup: isSetupTask });

  console.log(`📦 Running ${installCmd}...`);

  const result = await commandPort.execute(installCmd, {
    cwd: resolvedPath,
    timeout: 5 * 60 * 1000,
  });

  if (result.success) {
    console.log('✅ Go module dependencies resolved');
    
    if (result.stdout) {
      const lines = result.stdout.split('\n').filter((l: string) => l.trim());
      if (lines.length > 0) {
        console.log(lines.slice(-10).join('\n'));
      }
    }
    
    if (result.stderr && result.stderr.trim().length > 0) {
      console.log(`\n⚠️  ${installCmd} messages:`);
      const lines = result.stderr.split('\n').filter((l: string) => l.trim());
      console.log(lines.slice(-10).join('\n'));
    }
  } else {
    console.error('❌ Go dependency resolution failed:');
    console.error(result.stderr);
    violations.push({
      type: 'missing_dependency',
      severity: 'critical',
      message: `Go dependency resolution failed:\n${result.stderr || result.stdout}`,
      suggestedFix: `Check ${runtime.dependency.configFile} for incorrect module paths or version constraints. Run 'go mod tidy' locally to diagnose.`,
      isRetryable: false
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Generic install handler (fallback for other languages)
// ─────────────────────────────────────────────────────────────

async function handleGenericInstall(
  runtime: ProjectRuntimeConfig,
  resolvedPath: string,
  commandPort: any,
  violations: Violation[],
  isFinalTask: boolean | undefined,
): Promise<void> {
  const installCmd = runtime.dependency.getInstallCommand();
  
  if (!installCmd) {
    console.log(`⚠️  No install command defined for ${runtime.language}, skipping`);
    return;
  }

  console.log(`📦 Running: ${installCmd}`);

  const result = await commandPort.execute(installCmd, {
    cwd: resolvedPath,
    timeout: 10 * 60 * 1000,
  });

  if (result.success) {
    console.log(`✅ Dependency installation completed for ${runtime.language}`);
  } else {
    console.error(`❌ Dependency installation failed for ${runtime.language}:`);
    console.error(result.stderr);
    violations.push({
      type: 'missing_dependency',
      severity: 'critical',
      message: `Dependency installation failed (${runtime.language}):\n${result.stderr || result.stdout}`,
      suggestedFix: `Check ${runtime.dependency.configFile} for errors`,
      isRetryable: false
    });
  }
}
