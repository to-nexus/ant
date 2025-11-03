/**
 * Runtime Validate Node
 * 
 * Performs runtime validation by actually running:
 * 1. Type check (tsc --noEmit)
 * 2. Build (npm run build, etc)
 * 3. Lint (eslint)
 * 4. Tests (optional)
 * 
 * This node executes build tools and collects errors, then uses the
 * diagnostics system to parse and categorize them.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses CommandPort for command execution
 * - Uses GitPort for file operations
 */

import { ArchitectGraphState, Violation } from "../state";
import { CommandPort, GitPort } from "../../../../../core/ports";
import * as path from "path";
import { 
  detectProject, 
  diagnoseError, 
  ErrorLayer, 
  DiagnosisResult,
  ProjectDetection 
} from "./diagnostics";
import { errorStatsCollector } from "./diagnostics/errorStats";

export interface RuntimeValidationResult {
  passed: boolean;
  errors: string[];  // Required, aggregated from all error types
  buildErrors?: string[];
  lintErrors?: string[];
  typeErrors?: string[];
  testErrors?: string[];
  diagnoses?: DiagnosisResult[];  // ✅ Structured diagnostic results
  projectDetection?: ProjectDetection;  // ✅ Detected project info
}

/**
 * Runtime validation - run actual build/lint/test
 * 
 * Only runs if:
 * 1. CommandPort is available
 * 2. Config has strictValidation enabled (DEFAULT: true, disable with strictValidation: false)
 * 3. Target repository exists
 */
export async function runtimeValidate(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;
  const currentTask = state.currentTask;

  // ✅ CHECK VALIDATION STRATEGY (LLM decision)
  if (currentTask && currentTask.validationRequired === false) {
    console.log(`\n⏭️  Skipping validation (LLM decision)`);
    console.log(`   Task: ${currentTask.name}`);
    console.log(`   Rationale: ${currentTask.validationRationale || 'Not provided'}\n`);
    
    // Save checkpoint before moving to next task
    const { saveCheckpoint } = await import('./checkpoint');
    await saveCheckpoint(state);
    
    return state;
  }

  // Skip if explicitly disabled (default is enabled)
  const strictValidation = state.context.config?.strictValidation ?? true;  // ✅ Default: true
  if (strictValidation === false) {
    console.log('⚠️  Runtime validation disabled (set strictValidation: true in config to enable)');
    return state;
  }

  // Skip if no command port
  if (!commandPort || !gitPort) {
    console.log('⚠️  CommandPort not available, skipping dynamic validation');
    return state;
  }

  // Get target directory
  const config = state.context.config;
  if (!config || config.repoType !== 'local' || !config.localPath) {
    console.log('⚠️  No local repository path, skipping runtime validation');
    return state;
  }

  const repoRoot = await gitPort.getRepoRoot();
  const p = await import("path");
  const resolvedPath = p.isAbsolute(config.localPath)
    ? config.localPath
    : p.resolve(repoRoot, config.localPath);

  // ✅ FORCE VALIDATION TYPE BY TASK TYPE (ignore LLM decision for consistency)
  let validationType: 'static' | 'runtime';
  
  if (currentTask?.type === 'setup') {
    validationType = 'static';  // Setup: config files only → static
  } else if (currentTask?.type === 'feature') {
    validationType = 'static';  // Feature: defer full validation to Final → static
  } else if (currentTask?.type === 'error') {
    validationType = 'runtime';  // Error: must verify fix works → runtime
  } else if (currentTask?.priority === 1000) {
    validationType = 'runtime';  // Final Verification: comprehensive check → runtime
  } else {
    // Fallback: runtime for safety
    validationType = 'runtime';
  }
  
  console.log(`\n📋 Running ${validationType} validation in: ${resolvedPath}`);
  console.log(`   🔒 Policy: ${currentTask?.type || 'unknown'} tasks → ${validationType} validation`);
  if (currentTask?.validationRationale) {
    console.log(`   💡 LLM Rationale (overridden): ${currentTask.validationRationale}`);
  }
  console.log('');

  // ✅ STATIC VALIDATION: Syntax check only (for config files, setup tasks)
  if (validationType === 'static') {
    console.log('⚡ Static validation mode (fast)');
    console.log('   ✅ Configuration files syntax check');
    console.log('   ⏭️  Skipping: TypeScript compilation');
    console.log('   ⏭️  Skipping: Build execution');
    console.log('   ⏭️  Skipping: Lint checks\n');
    
    // Lightweight validation: Just check if config files are valid JSON
    const configFiles = ['package.json', 'tsconfig.json'];
    const errors: string[] = [];
    
    for (const file of configFiles) {
      const filePath = p.join(resolvedPath, file);
      const exists = await gitPort.fileExists(p.relative(repoRoot, filePath));
      
      if (exists && file.endsWith('.json')) {
        try {
          const content = await gitPort.readFile(p.relative(repoRoot, filePath));
          if (!content) {
            errors.push(`${file} is empty`);
            console.error(`   ❌ ${file} - empty file`);
            continue;
          }
          JSON.parse(content);
          console.log(`   ✅ ${file} - valid JSON`);
        } catch (e) {
          const error = `Invalid JSON in ${file}: ${e instanceof Error ? e.message : String(e)}`;
          errors.push(error);
          console.error(`   ❌ ${file} - ${error}`);
        }
      }
    }
    
    if (errors.length > 0) {
      console.log('\n⚠️  Configuration file errors found\n');
      return {
        ...state,
        violations: errors.map(error => ({
          type: 'config_error',
          severity: 'major',
          message: error,
          suggestedFix: 'Fix JSON syntax in configuration files',
          isRetryable: true
        }))
      };
    }
    
    console.log('\n✅ All configuration files are valid!\n');
    
    // Save checkpoint after static validation
    const { saveCheckpoint } = await import('./checkpoint');
    await saveCheckpoint(state);
    
    return state;
  }

  // ✅ RUNTIME VALIDATION: Full validation (TypeScript + Build + Lint)
  console.log('🔍 Runtime validation mode (full)');
  console.log('   ✅ TypeScript type check');
  console.log('   ✅ Build execution');
  console.log('   ✅ Lint checks\n');

  // ✅ Detect project type first
  const projectDetection = await detectProject(resolvedPath, gitPort);
  console.log(`🔍 Detected: ${projectDetection.language} + ${projectDetection.buildTool} (${projectDetection.packageManager})`);

  const result: RuntimeValidationResult = {
    passed: true,
    errors: [],
    buildErrors: [],
    lintErrors: [],
    typeErrors: [],
    testErrors: [],
    diagnoses: [],
    projectDetection,
  };

  try {
    // 1. Type Check (tsc --noEmit)
    const hasTypeScript = await gitPort.fileExists(
      p.relative(repoRoot, p.join(resolvedPath, 'tsconfig.json'))
    );

    if (hasTypeScript) {
      console.log('📘 Running TypeScript type check...');
      
      const typeCheckResult = await commandPort.execute('npx tsc --noEmit', {
        cwd: resolvedPath,
        timeout: 2 * 60 * 1000, // 2 minutes
      });

      if (!typeCheckResult.success) {
        result.passed = false;
        // ✅ TypeScript outputs errors to STDOUT, not stderr!
        const errorOutput = typeCheckResult.stdout || typeCheckResult.stderr;
        
        // ✅ Use diagnostics system
        const diagnosis = diagnoseError(errorOutput, {
          command: 'npx tsc --noEmit',
          workDir: resolvedPath,
          output: errorOutput,
          projectDetection,
        });
        
        if (diagnosis) {
          result.diagnoses!.push(diagnosis);
          
          // ✅ Record error statistics
          errorStatsCollector.recordError(diagnosis, {
            command: 'npx tsc --noEmit',
            workDir: resolvedPath,
            language: projectDetection.language,
            buildTool: projectDetection.buildTool,
            packageManager: projectDetection.packageManager,
          });
          
          // Check for ENVIRONMENT layer errors (e.g., tsc not found)
          if (diagnosis.layer === ErrorLayer.ENVIRONMENT) {
            console.error('🚨 ENVIRONMENT ISSUE DETECTED - User intervention required!');
            console.error(`   ${diagnosis.message}`);
            console.error('   Root cause:', diagnosis.rootCause);
            diagnosis.suggestedActions.forEach(action => console.error(`   • ${action}`));
            
            // ✅ Immediately convert to violation and return
            const violations = state.violations || [];
            violations.push({
              type: diagnosis.type as any,
              severity: diagnosis.severity as any,
              message: diagnosis.message,
              suggestedFix: diagnosis.suggestedActions.join('\n'),
              isRetryable: false,  // ✅ ENVIRONMENT issues cannot be fixed by LLM
            });
            
            return {
              ...state,
              violations,
              runtimeValidationResult: result,
            };
          }
          
          result.typeErrors = [diagnosis.message];
        } else {
          // Fallback to old parsing
          result.typeErrors = parseTypeScriptErrors(errorOutput);
        }
        
        console.error('❌ Type check failed:');
        result.typeErrors!.slice(0, 10).forEach(err => console.error(`   ${err}`));
        if (result.typeErrors!.length > 10) {
          console.error(`   ... and ${result.typeErrors!.length - 10} more errors`);
        }
      } else {
        console.log('✅ Type check passed');
      }
    }

    // 2. Lint (if .eslintrc exists)
    const hasESLint = await gitPort.fileExists(
      p.relative(repoRoot, p.join(resolvedPath, '.eslintrc.json'))
    ) || await gitPort.fileExists(
      p.relative(repoRoot, p.join(resolvedPath, '.eslintrc.js'))
    );

    if (hasESLint) {
      console.log('📋 Running ESLint...');
      
      const lintResult = await commandPort.execute('npx eslint . --ext .ts,.tsx,.js,.jsx', {
        cwd: resolvedPath,
        timeout: 2 * 60 * 1000,
      });

      if (!lintResult.success) {
        // ⚠️  Check if errors are in build artifacts (configuration issue)
        const isBuildArtifactError = /\/(dist|build|node_modules|\.next|\.nuxt|out)\//i.test(lintResult.stdout);
        
        if (isBuildArtifactError) {
          console.error('⚠️  ESLint Configuration Error Detected!');
          console.error('   ESLint is checking build artifacts (dist/, node_modules/, etc.)');
          console.error('   This indicates missing ignorePatterns in .eslintrc.json');
          
          // Create a configuration-specific diagnosis
          const configDiagnosis: DiagnosisResult = {
            type: 'lint_error',
            layer: ErrorLayer.CONFIGURATION,
            severity: 'critical',
            message: 'ESLint is checking build artifacts instead of source code. Add ignorePatterns to .eslintrc.json',
            rootCause: 'Missing ignorePatterns in .eslintrc.json configuration',
            suggestedActions: [
              'Add ignorePatterns to .eslintrc.json: ["dist", "build", "node_modules", "*.config.*"]',
              'Or create .eslintignore file with: dist/\\nbuild/\\nnode_modules/\\n*.config.*'
            ],
            isRetryable: true,
            canLLMFix: true,
          };
          
          result.diagnoses!.push(configDiagnosis);
          result.lintErrors = [configDiagnosis.message];
          result.passed = false;
          
          console.error(`   💡 Fix: ${configDiagnosis.suggestedActions[0]}`);
        } else {
          result.passed = false;
          
          // ✅ Use diagnostics system for actual code errors
          const diagnosis = diagnoseError(lintResult.stdout, {
            command: 'npx eslint',
            workDir: resolvedPath,
            output: lintResult.stdout,
            projectDetection,
          });
          
          if (diagnosis) {
            result.diagnoses!.push(diagnosis);
            
            // ✅ Record error statistics
            errorStatsCollector.recordError(diagnosis, {
              command: 'npx eslint',
              workDir: resolvedPath,
              language: projectDetection.language,
              buildTool: projectDetection.buildTool,
              packageManager: projectDetection.packageManager,
            });
            
            result.lintErrors = [diagnosis.message];
          } else {
            // Fallback to old parsing
            result.lintErrors = parseLintErrors(lintResult.stdout);
          }
          
          console.error('⚠️  Lint failed (non-blocking):');
          result.lintErrors!.slice(0, 10).forEach(err => console.error(`   ${err}`));
          if (result.lintErrors!.length > 10) {
            console.error(`   ... and ${result.lintErrors!.length - 10} more errors`);
          }
          console.log('   ℹ️  Lint errors have LOW priority - fix build/deps/types first');
        }
      } else {
        console.log('✅ Lint passed');
      }
    } else {
      console.log('ℹ️  ESLint not configured, skipping lint check');
    }

    // 3. Build (package.json scripts)
    const pkgJsonPath = p.join(resolvedPath, 'package.json');
    const pkgExists = await gitPort.fileExists(p.relative(repoRoot, pkgJsonPath));

    if (pkgExists) {
      const pkgContent = await gitPort.readFile(p.relative(repoRoot, pkgJsonPath));
      if (pkgContent) {
        try {
          const pkg = JSON.parse(pkgContent);
          
          // Check for build script
          if (pkg.scripts?.build) {
            console.log('🔨 Running build...');
            
            const pm = await commandPort.detectPackageManager(resolvedPath);
            const buildResult = await commandPort.execute(`${pm} run build`, {
              cwd: resolvedPath,
              timeout: 5 * 60 * 1000, // 5 minutes
            });

            if (!buildResult.success) {
              result.passed = false;
              // ✅ Build tools may output errors to stdout or stderr
              const errorOutput = buildResult.stderr || buildResult.stdout;
              
              // ✅ Use diagnostics system
              const diagnosis = diagnoseError(errorOutput, {
                command: `${pm} run build`,
                workDir: resolvedPath,
                output: errorOutput,
                projectDetection,
              });
              
              if (diagnosis) {
                result.diagnoses!.push(diagnosis);
                
                // ✅ Record error statistics
                errorStatsCollector.recordError(diagnosis, {
                  command: `${pm} run build`,
                  workDir: resolvedPath,
                  language: projectDetection.language,
                  buildTool: projectDetection.buildTool,
                  packageManager: projectDetection.packageManager,
                });
                
                // Check for ENVIRONMENT layer errors
                if (diagnosis.layer === ErrorLayer.ENVIRONMENT) {
                  console.error('🚨 ENVIRONMENT ISSUE DETECTED - User intervention required!');
                  console.error(`   ${diagnosis.message}`);
                  console.error('   Root cause:', diagnosis.rootCause);
                  diagnosis.suggestedActions.forEach(action => console.error(`   • ${action}`));
                  
                  const violations = state.violations || [];
                  violations.push({
                    type: diagnosis.type as any,
                    severity: diagnosis.severity as any,
                    message: diagnosis.message,
                    suggestedFix: diagnosis.suggestedActions.join('\n'),
                    isRetryable: false,
                  });
                  
                  return {
                    ...state,
                    violations,
                    runtimeValidationResult: result,
                  };
                }
                
                result.buildErrors = [diagnosis.message];
              } else {
                // Fallback to old parsing
                result.buildErrors = parseBuildErrors(errorOutput);
              }
              
              console.error('❌ Build failed:');
              result.buildErrors!.slice(0, 10).forEach(err => console.error(`   ${err}`));
              if (result.buildErrors!.length > 10) {
                console.error(`   ... and ${result.buildErrors!.length - 10} more errors`);
              }
            } else {
              console.log('✅ Build passed');
            }
          }

          // Optional: Run tests (if enabled in config)
          if (config.runTests && pkg.scripts?.test) {
            console.log('🧪 Running tests...');
            
            const pm = await commandPort.detectPackageManager(resolvedPath);
            const testResult = await commandPort.execute(`${pm} run test`, {
              cwd: resolvedPath,
              timeout: 5 * 60 * 1000,
            });

            if (!testResult.success) {
              result.passed = false;
              result.testErrors = [testResult.stderr];
              console.error('❌ Tests failed');
            } else {
              console.log('✅ Tests passed');
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

  } catch (error: any) {
    console.error('⚠️  Dynamic validation error:', error.message);
    // Don't fail the workflow, just return current state
    return state;
  }

  // Add validation result to violations if failed
  if (!result.passed) {
    const violations = state.violations || [];
    
    // ✅ Convert diagnostics to structured violations
    const newViolations = convertDiagnosesToViolations(result);

    return {
      ...state,
      violations: [...violations, ...newViolations],
      runtimeValidationResult: result,
    };
  }

  console.log('\n✅ All dynamic validations passed!\n');
  
  // ✅ CHECKPOINT: Save state after validation (success/failure)
  // This allows resuming from this point if recursion limit is hit
  const { saveCheckpoint } = await import('./checkpoint');
  await saveCheckpoint(state);
  
  return {
    ...state,
    runtimeValidationResult: result,
  };
}

// Checkpoint function moved to ./checkpoint.ts for reuse across nodes

/**
 * Convert diagnostics to structured violations
 */
function convertDiagnosesToViolations(result: RuntimeValidationResult): Violation[] {
  const violations: Violation[] = [];
  
  // ✅ Use structured diagnostics if available
  if (result.diagnoses && result.diagnoses.length > 0) {
    for (const diagnosis of result.diagnoses) {
      violations.push({
        type: diagnosis.type as any,
        severity: diagnosis.severity as any,
        message: `${diagnosis.message}\n\nRoot Cause: ${diagnosis.rootCause}\n\nSuggested Actions:\n${diagnosis.suggestedActions.map(a => `• ${a}`).join('\n')}`,
        suggestedFix: diagnosis.suggestedActions.join('\n'),
        isRetryable: diagnosis.isRetryable,
      });
    }
  }
  
  // ⚠️ CRITICAL: ALWAYS check buildErrors/typeErrors/lintErrors
  // Even if we have diagnoses, some errors might not have diagnosis patterns yet
  // (e.g. PostCSS config errors, new error types)
  
  // Track which errors are already covered by diagnoses to avoid duplicates
  const diagnosedMessages = new Set(
    result.diagnoses?.map(d => d.message) || []
  );
  
  // Build errors (highest priority - often missing files or deps)
  if (result.buildErrors && result.buildErrors.length > 0) {
    for (const error of result.buildErrors) {
      // Skip if already covered by diagnosis
      if (diagnosedMessages.has(error)) continue;
      
      // Check for missing entry file
      if (error.includes('MISSING REQUIRED FILE') || error.includes('Could not resolve entry module')) {
        const fileMatch = error.match(/index\.html|main\.tsx?|main\.jsx?|index\.tsx?|index\.jsx?/);
        violations.push({
          type: 'missing_file',
          severity: 'critical',
          file: fileMatch ? fileMatch[0] : 'entry file',
          message: error,
          suggestedFix: 'Create the missing entry file',
          isRetryable: false
        });
      }
      // Check for missing module/dependency
      else if (error.includes('Cannot find module') || error.includes('MISSING MODULE')) {
        const moduleMatch = error.match(/["'](.+?)["']/);
        violations.push({
          type: 'missing_dependency',
          severity: 'critical',
          module: moduleMatch ? moduleMatch[1] : 'unknown',
          message: error,
          suggestedFix: 'Install missing dependency or create missing file',
          isRetryable: false
        });
      }
      // Other build errors
      else {
        violations.push({
          type: 'build_error',
          severity: 'major',
          message: error,
          suggestedFix: 'Fix build configuration or code',
          isRetryable: true  // ✅ Make it retryable so LLM can try to fix
        });
      }
    }
  }
  
  // Type errors (only if not already covered by diagnoses)
  if (result.typeErrors && result.typeErrors.length > 0) {
    const uncoveredTypeErrors = result.typeErrors.filter(e => !diagnosedMessages.has(e));
    if (uncoveredTypeErrors.length > 0) {
      // ✅ Extract file names from TypeScript errors
      const filesWithErrors = new Set<string>();
      uncoveredTypeErrors.forEach(error => {
        // Parse: "src/path/file.ts(line,col): error TS1234: message"
        const fileMatch = error.match(/^(.+?)\(\d+,\d+\):/);
        if (fileMatch) {
          filesWithErrors.add(fileMatch[1]);
        }
      });
      
      const filesList = Array.from(filesWithErrors).join(', ');
      const filesContext = filesList ? `\n\n🎯 Files requiring fixes: ${filesList}` : '';
      
      violations.push({
        type: 'type_error',
        severity: 'major',
        message: `TypeScript type errors (${uncoveredTypeErrors.length} total):\n${uncoveredTypeErrors.slice(0, 5).join('\n')}${uncoveredTypeErrors.length > 5 ? `\n... and ${uncoveredTypeErrors.length - 5} more` : ''}${filesContext}`,
        file: filesWithErrors.size === 1 ? Array.from(filesWithErrors)[0] : undefined,
        suggestedFix: `Fix type errors in: ${filesList || 'code'}`,
        isRetryable: true
      });
    }
  }
  
  // Import errors (from type errors or build errors)
  const importErrors = [...(result.typeErrors || []), ...(result.buildErrors || [])]
    .filter(e => e.includes("Cannot find module") || e.includes("Module not found"))
    .filter(e => !diagnosedMessages.has(e));
  if (importErrors.length > 0) {
    violations.push({
      type: 'import_error',
      severity: 'major',
      message: `Import errors (${importErrors.length} total):\n${importErrors.slice(0, 3).join('\n')}`,
      suggestedFix: 'Fix import paths or install missing dependencies',
      isRetryable: false
    });
  }
  
  // Lint errors (lowest priority, only if not already covered)
  if (result.lintErrors && result.lintErrors.length > 0) {
    const uncoveredLintErrors = result.lintErrors.filter(e => !diagnosedMessages.has(e));
    if (uncoveredLintErrors.length > 0) {
      violations.push({
        type: 'lint_error',
        severity: 'minor',
        message: `ESLint errors (${uncoveredLintErrors.length} total) - LOW PRIORITY`,
        suggestedFix: 'Fix lint errors (but prioritize build/type errors first)',
        isRetryable: true
      });
    }
  }
  
  return violations;
}

/**
 * Parse TypeScript errors with better context and multi-line support
 */
function parseTypeScriptErrors(output: string): string[] {
  // ✅ Special case: tsc not found
  if (output.includes('This is not the tsc command') || 
      output.includes('command not found: tsc') ||
      output.includes('tsc: command not found')) {
    return [
      '❌ CRITICAL: TypeScript compiler (tsc) is not installed or not in PATH',
      '',
      '🔍 This usually means devDependencies were not installed.',
      '   Possible causes:',
      '   1. NODE_ENV=production preventing devDependencies installation',
      '   2. npm install ran with --production flag',
      '   3. .npmrc has production=true setting',
      '',
      `   Current NODE_ENV: ${process.env.NODE_ENV || 'not set'}`,
      '',
      '✅ Solution: npm install --include=dev'
    ];
  }
  
  const lines = output.split('\n');
  const errors: string[] = [];
  let currentError = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // TypeScript error format: src/App.tsx(10,5): error TS2304: Cannot find name 'React'.
    if (line.match(/\(\d+,\d+\):\s*error\s+TS\d+:/)) {
      // Save previous error if exists
      if (currentError) {
        errors.push(currentError.trim());
      }
      currentError = line;
    }
    // Continuation line (usually indented or starts with spaces)
    else if (currentError && line.match(/^\s+/) && line.trim().length > 0) {
      currentError += '\n' + line;
    }
    // End of current error
    else if (currentError && line.trim().length === 0) {
      errors.push(currentError.trim());
      currentError = '';
    }
  }
  
  // Don't forget last error
  if (currentError) {
    errors.push(currentError.trim());
  }
  
  return errors.length > 0 ? errors : [output];
}

/**
 * Parse lint errors
 */
function parseLintErrors(stdout: string): string[] {
  const lines = stdout.split('\n');
  const errors: string[] = [];
  
  for (const line of lines) {
    if (line.includes('error') || line.includes('✖')) {
      errors.push(line.trim());
    }
  }
  
  return errors.length > 0 ? errors : [stdout];
}

/**
 * Parse build errors with enhanced diagnostics for multiple build tools
 */
function parseBuildErrors(output: string): string[] {
  const errors: string[] = [];
  
  // ✅ 1. Check for tsc not found (critical - should be caught by type check but defensive)
  if (output.includes('This is not the tsc command') || 
      output.includes('command not found: tsc') ||
      output.includes('tsc: command not found')) {
    errors.push('❌ CRITICAL: TypeScript compiler not found during build');
    errors.push('   See type check errors for full diagnosis and solution');
    return errors;
  }
  
  // ✅ 2. Check for missing entry module (common in Vite projects)
  const entryModuleMatch = output.match(/Could not resolve entry module ["'](.+?)["']/);
  if (entryModuleMatch) {
    const missingFile = entryModuleMatch[1];
    errors.push(`📄 MISSING ENTRY FILE: ${missingFile}`);
    errors.push('');
    if (missingFile.includes('index.html')) {
      errors.push('Vite projects REQUIRE index.html as the entry point.');
      errors.push('🔧 CREATE THIS FILE with content like:');
      errors.push('   <!DOCTYPE html>');
      errors.push('   <html><head><title>App</title></head>');
      errors.push('   <body><div id="root"></div>');
      errors.push('   <script type="module" src="/src/main.tsx"></script></body></html>');
    } else {
      errors.push(`🔧 CREATE THIS FILE: ${missingFile}`);
    }
    errors.push('');
  }
  
  // ✅ 3. Check for module/import errors
  const moduleErrors = output.match(/Cannot find module ["']([^"']+)["']/gi);
  if (moduleErrors && moduleErrors.length > 0) {
    errors.push(`📦 MISSING MODULES (${moduleErrors.length}):`);
    moduleErrors.slice(0, 3).forEach(err => {
      const module = err.match(/["']([^"']+)["']/)?.[1];
      errors.push(`   • ${module}`);
    });
    if (moduleErrors.length > 3) {
      errors.push(`   ... and ${moduleErrors.length - 3} more`);
    }
    errors.push('');
  }
  
  // ✅ 4. Check for Vite-specific errors
  const viteErrors = output.match(/\[vite\].*error.*/gi);
  if (viteErrors) {
    errors.push('🔴 Vite Errors:');
    viteErrors.slice(0, 3).forEach(err => errors.push(`   ${err.trim()}`));
    if (viteErrors.length > 3) {
      errors.push(`   ... and ${viteErrors.length - 3} more`);
    }
    errors.push('');
  }
  
  // ✅ 5. Check for import resolution errors
  const importErrors = output.match(/failed to resolve import ["']([^"']+)["']/gi);
  if (importErrors) {
    errors.push('🔗 Import Resolution Failures:');
    importErrors.slice(0, 3).forEach(err => errors.push(`   ${err.trim()}`));
    if (importErrors.length > 3) {
      errors.push(`   ... and ${importErrors.length - 3} more`);
    }
    errors.push('');
  }
  
  // ✅ 6. Fallback: extract context around error keywords
  if (errors.length === 0) {
    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('error') || line.includes('failed') || line.includes('✖')) {
        // Add context: prev + current + next
        if (i > 0) errors.push(lines[i - 1].trim());
        errors.push(lines[i].trim());
        if (i < lines.length - 1) errors.push(lines[i + 1].trim());
        errors.push('');
        break; // Only first error for now
      }
    }
  }
  
  // ✅ 7. Last resort: filtered output
  if (errors.length === 0) {
    const filtered = output.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.toLowerCase().includes('deprecated'))
      .slice(0, 15);
    return filtered.length > 0 ? filtered : [output.slice(0, 500)];
  }
  
  return errors;
}

/**
 * Format validation errors for display
 */
function formatValidationErrors(result: RuntimeValidationResult): string[] {
  const lines: string[] = [];
  
  if (result.typeErrors && result.typeErrors.length > 0) {
    lines.push('📘 Type Errors:');
    result.typeErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.typeErrors.length > 5) {
      lines.push(`  ... and ${result.typeErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.lintErrors && result.lintErrors.length > 0) {
    lines.push('📋 Lint Errors (LOW PRIORITY - Fix after build/deps/types):');
    result.lintErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.lintErrors.length > 5) {
      lines.push(`  ... and ${result.lintErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.buildErrors && result.buildErrors.length > 0) {
    lines.push('🔨 Build Errors:');
    result.buildErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.buildErrors.length > 5) {
      lines.push(`  ... and ${result.buildErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.testErrors && result.testErrors.length > 0) {
    lines.push('🧪 Test Errors:');
    result.testErrors.forEach(err => lines.push(`  - ${err}`));
    lines.push('');
  }
  
  lines.push('⚠️  Please fix these errors and regenerate.');
  
  return lines;
}

