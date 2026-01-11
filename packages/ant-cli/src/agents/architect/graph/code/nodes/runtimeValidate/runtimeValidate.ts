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

import path from "path";
import { ArchitectGraphState } from "../../state";
import { 
  detectProject, 
  diagnoseError, 
  checkCompatibility,
  ErrorLayer, 
  Framework,
} from "../diagnostics";
import { errorStatsCollector } from "../diagnostics/errorStats";
import { ErrorParserFactory } from "../diagnostics/parsers";
import { RuntimeValidationResult } from "./types";
import { detectRecentToolFailures } from "./utils";
import { convertDiagnosesToViolations } from "./violations";

/**
 * Runtime validation - run actual build/lint/test
 * 
 * Only runs if:
 * 1. CommandPort is available
 * 2. Config has strictValidation enabled (DEFAULT: true, disable with strictValidation: false)
 * 3. Target repository exists
 */
export async function runtimeValidate(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔨 [runtimeValidate] NODE ENTERED ✅`);
  console.log(`   Task: ${state.currentTask?.name || 'none'}`);
  console.log(`   Priority: ${state.currentTask?.priority || 'none'}`);
  console.log(`   This confirms validation is running!`);
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
      'runtimeValidate', 
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;
  const fileSystem = state.deps?.fileSystem;

  // Skip if explicitly disabled (default is enabled)
  const strictValidation = state.context.config?.strictValidation ?? true;  // ✅ Default: true
  if (strictValidation === false) {
    console.log('⚠️  Runtime validation disabled (set strictValidation: true in config to enable)');
    return state;
  }

  // Skip if no command port or fileSystem
  if (!commandPort || !gitPort || !fileSystem) {
    console.log('⚠️  CommandPort or FileSystemPort not available, skipping dynamic validation');
    return state;
  }
  
  // ✅ NEW: Check if we got here despite tool failures (loop detection)
  const recentToolFailures = detectRecentToolFailures(state);
  
  if (recentToolFailures >= 3) {
    console.warn(`\n⚠️  [RuntimeValidate] Starting validation after ${recentToolFailures} recent tool failures`);
    console.warn(`   This indicates repeated command failures that need investigation.\n`);
  }

  // ✅ Get codebase path (works for both local and cloud mode)
  const repoRoot = await gitPort.getRepoRoot();
  const p = await import("path");
  
  // repoRoot is already the codebase directory
  // For local mode: resolves from config.localPath
  // For cloud mode: resolves from workspaces/{org}/{user}/{project}/codebase
  const resolvedPath = repoRoot;
  
  console.log(`📂 Target directory for validation: ${resolvedPath}`);

  // ✅ This node is ONLY entered for Final Verification (Priority 1000)
  // Router ensures only final task reaches here
  console.log(`\n📋 Running runtime validation in: ${resolvedPath}`);
  console.log(`   🔒 Final Verification: comprehensive build check\n`);

  // ✅ RUNTIME VALIDATION: Full validation (TypeScript + Build + Lint)
  console.log('🔍 Runtime validation mode (full)');
  console.log('   ✅ TypeScript type check');
  console.log('   ✅ Build execution');
  console.log('   ✅ Lint checks\n');

  // ✅ Detect project type first
  const projectDetection = await detectProject(resolvedPath, gitPort, fileSystem);
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
    await runTypeCheck(result, resolvedPath, repoRoot, fileSystem, commandPort, projectDetection, p);
    
    // Return early if ENVIRONMENT error detected in type check
    if (result.diagnoses?.some(d => d.layer === ErrorLayer.ENVIRONMENT && !d.canLLMFix)) {
      return handleEnvironmentError(state, result);
    }

    // 2. Lint (if .eslintrc exists)
    await runLint(result, resolvedPath, repoRoot, fileSystem, commandPort, projectDetection, p);

    // 2.5. Pre-build Compatibility Check (catches config incompatibilities early)
    // This detects known problematic settings BEFORE build fails
    const compatibilityIssues = await runCompatibilityCheck(
      result, resolvedPath, repoRoot, fileSystem, projectDetection, p
    );
    
    if (compatibilityIssues.length > 0) {
      // Return early with compatibility issues - more actionable than cryptic build errors
      const issueMessages = compatibilityIssues.map(i => 
        `[${i.framework}] ${i.issue}\n  Config: ${i.configFile}\n  Fix: ${i.fix}`
      ).join('\n\n');
      
      return {
        ...state,
        violations: [
          ...(state.violations || []),
          {
            type: 'config_incompatibility',
            severity: 'critical',
            message: `Framework configuration incompatibility detected:\n\n${issueMessages}`,
            suggestedFix: compatibilityIssues.map(i => i.fix).join('\n'),
            isRetryable: true,
            metadata: { issues: compatibilityIssues }
          }
        ],
        runtimeValidationResult: { ...result, passed: false }
      };
    }

    // 3. Build (package.json scripts)
    const buildSuccess = await runBuild(result, resolvedPath, repoRoot, fileSystem, commandPort, projectDetection, p);
    
    // Return early if build succeeded after auto-fix
    if (buildSuccess === 'auto_fixed') {
      return {
        ...state,
        violations: [],
        runtimeValidationResult: result,
      };
    }
    
    // Return early if ENVIRONMENT error detected in build
    if (result.diagnoses?.some(d => d.layer === ErrorLayer.ENVIRONMENT && !d.canLLMFix)) {
      return handleEnvironmentError(state, result);
    }

    // 4. Static asset integrity check (principle-based, catches silent runtime 404)
    // - Build can succeed even when runtime assets 404 (e.g., '/x.webp' referenced but file missing in public/)
    // - This prevents regressions like "background image missing" without breaking compilation.
    const missingStaticAssets = await findMissingPublicAssetReferences(repoRoot, fileSystem, p);
    if (missingStaticAssets.length > 0) {
      const preview = missingStaticAssets.slice(0, 12);
      const lines = preview.map(m => `- ${m.file}: ${m.assetPath} (expected: public/${m.assetPath.replace(/^\//, '')})`);
      const more = missingStaticAssets.length > preview.length
        ? `\n... and ${missingStaticAssets.length - preview.length} more`
        : '';

      return {
        ...state,
        violations: [
          ...(state.violations || []),
          {
            type: 'missing_static_asset',
            severity: 'major',
            message:
              `Static asset reference(s) are missing from the app's public static root.\n` +
              `This causes silent runtime 404s (e.g., missing backgrounds/icons) even if build passes.\n\n` +
              `Missing references (sample):\n${lines.join('\n')}${more}\n\n` +
              `Principle: If code references an absolute asset path like '/foo/bar.png', the file MUST exist under 'public/foo/bar.png' (or the project’s static root).\n` +
              `Fix: either copy the referenced asset into the correct static root OR change code to reference an existing asset path (do not invent extensions like .webp unless the file exists).`,
            suggestedFix:
              `Copy required assets into public/ (or detected static root), or update references to existing assets.\n` +
              `Avoid changing image extensions unless the target files exist.`,
            isRetryable: true,
            metadata: { count: missingStaticAssets.length }
          }
        ],
        runtimeValidationResult: { ...result, passed: false }
      };
    }

  } catch (error: any) {
    console.error('⚠️  Dynamic validation error:', error.message);

    // 🚨 CRITICAL: Do not silently succeed.
    // If runtime validation cannot run (e.g., missing package.json), surface a violation so the job cannot be marked "success".
    return {
      ...state,
      violations: [
        {
          type: 'build_error',
          severity: 'critical',
          message: `Runtime validation failed to execute:\n${error?.message || String(error)}\n\nCommon cause: missing package.json in codebase root.`,
          suggestedFix: 'Ensure package.json exists in the codebase root and rerun final verification.',
          isRetryable: false
        }
      ]
    };
  }

  // Handle validation failure
  if (!result.passed) {
    return handleValidationFailure(state, result, recentToolFailures);
  }

  console.log('\n✅ All dynamic validations passed!\n');
  
  // ✅ CHECKPOINT: Save state after validation (success/failure)
  // This allows resuming from this point if recursion limit is hit
  const { saveCheckpoint } = await import("../checkpoint");
  await saveCheckpoint(state);
  
  // ✅ Workflow instrumentation: Exit node (success path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'runtimeValidate');
  }
  
  // 🚨 CRITICAL: Clear violations on success
  return {
    ...state,
    violations: [],  // ← Clear current violations
    lastViolations: [],  // ← Clear last violations
    runtimeValidationResult: result,
  };
}

/**
 * Find missing public static assets referenced by absolute paths in source files.
 * Principle-based: absolute '/x.ext' should exist under public/x.ext.
 */
async function findMissingPublicAssetReferences(
  repoRoot: string,
  fileSystem: any,
  p: any
): Promise<Array<{ file: string; assetPath: string }>> {
  const assetExt = '(?:png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)';
  const jsStringRe = new RegExp(`(["'])\\/(?!\\/|dev\\/)([^"'\\n\\r?#]+?\\.${assetExt})(?:\\?[^"']*)?\\1`, 'g');
  const cssUrlRe = new RegExp(`url\\(\\s*['"]?\\/(?!\\/|dev\\/)([^'")\\n\\r?#]+?\\.${assetExt})(?:\\?[^'")]+)?['"]?\\s*\\)`, 'g');

  const publicRel = 'public';
  const candidates: string[] = [];

  // Gather likely source files
  const roots = ['src', 'index.html'];
  for (const r of roots) {
    // index.html is a file, src is a directory
    const maybeDir = r;
    const maybeFile = r;
    if (await fileSystem.fileExists(maybeFile)) {
      candidates.push(maybeFile);
      continue;
    }
    if (await fileSystem.fileExists(maybeDir)) {
      const files = await collectFilesRecursive(maybeDir, fileSystem);
      candidates.push(...files);
    }
  }

  // Filter to text-ish files
  const textFiles = candidates.filter(f => /\.(ts|tsx|js|jsx|css|html)$/.test(f));

  const missing: Array<{ file: string; assetPath: string }> = [];

  for (const file of textFiles) {
    let content = '';
    try {
      content = await fileSystem.readFile(file);
    } catch {
      continue;
    }

    const found = new Set<string>();
    for (const re of [jsStringRe, cssUrlRe]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const relPath = m[2] || m[1]; // jsStringRe uses group 2, cssUrlRe uses group 1
        if (!relPath) continue;
        const assetPath = `/${relPath}`;
        found.add(assetPath);
      }
    }

    for (const assetPath of found) {
      const expected = p.join(publicRel, assetPath.replace(/^\//, ''));
      try {
        const exists = await fileSystem.fileExists(expected);
        if (!exists) {
          missing.push({ file, assetPath });
        }
      } catch {
        // If filesystem check fails, treat as missing to avoid silent pass
        missing.push({ file, assetPath });
      }
    }
  }

  return missing;
}

async function collectFilesRecursive(dir: string, fileSystem: any): Promise<string[]> {
  const out: string[] = [];
  const entries = await fileSystem.readDirectory(dir);
  for (const e of entries) {
    if (!e?.name) continue;
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory) {
      out.push(...(await collectFilesRecursive(full, fileSystem)));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Run TypeScript type check
 */
async function runTypeCheck(
  result: RuntimeValidationResult,
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  commandPort: any,
  projectDetection: any,
  p: any
): Promise<void> {
  const hasTypeScript = await fileSystem.fileExists(
    p.relative(repoRoot, p.join(resolvedPath, 'tsconfig.json'))
  );

  if (!hasTypeScript) {
    return;
  }

  console.log('📘 Running TypeScript type check...');
  
  const typeCheckResult = await commandPort.execute('npx tsc --noEmit', {
    cwd: resolvedPath,
    timeout: 2 * 60 * 1000, // 2 minutes
  });

  if (!typeCheckResult.success) {
    result.passed = false;
    // ✅ TypeScript outputs errors to STDOUT, not stderr!
    const errorOutput = typeCheckResult.stdout || typeCheckResult.stderr;
    
    // ✅ Use new TypeScript parser
    const parser = ErrorParserFactory.create('typescript', {
      projectRoot: resolvedPath,
      maxErrors: 50
    });
    const parsedErrors = parser.parse(errorOutput);
    
    // Convert parsed errors to formatted strings
    result.typeErrors = parser.format(parsedErrors);
    
    // ✅ Use diagnostics system for legacy support
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
      }
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

/**
 * Run ESLint
 */
async function runLint(
  result: RuntimeValidationResult,
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  commandPort: any,
  projectDetection: any,
  p: any
): Promise<void> {
  const hasESLint = await fileSystem.fileExists(
    p.relative(repoRoot, p.join(resolvedPath, '.eslintrc.json'))
  ) || await fileSystem.fileExists(
    p.relative(repoRoot, p.join(resolvedPath, '.eslintrc.js'))
  );

  if (!hasESLint) {
    console.log('ℹ️  ESLint not configured, skipping lint check');
    return;
  }

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
      const configDiagnosis = {
        type: 'lint_error',
        layer: ErrorLayer.CONFIGURATION,
        severity: 'critical' as const,
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
      // Parse lint errors for diagnostics
      const lintParser = ErrorParserFactory.create('eslint', {
        projectRoot: resolvedPath,
        maxErrors: 50
      });
      const parsedLintErrors = lintParser.parse(lintResult.stdout);
      result.lintErrors = lintParser.format(parsedLintErrors);
      
      // Only add diagnostic if there are actual errors to report
      if (result.lintErrors && result.lintErrors.length > 0) {
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
        }
        
        console.error('⚠️  Lint failed (non-blocking):');
        result.lintErrors!.slice(0, 10).forEach(err => console.error(`   ${err}`));
        if (result.lintErrors!.length > 10) {
          console.error(`   ... and ${result.lintErrors!.length - 10} more errors`);
        }
        console.log('   ℹ️  Lint errors have LOW priority - fix build/deps/types first');
      }
      
      // ✅ CRITICAL: Do NOT set result.passed = false for lint-only failures
      // Let the validation level filtering handle this (FUNCTIONAL level ignores lint)
      // result.passed stays true unless type check or build failed
    }
  } else {
    console.log('✅ Lint passed');
  }
}

/**
 * Run build
 * @returns 'auto_fixed' if build succeeded after auto-fix, undefined otherwise
 */
async function runBuild(
  result: RuntimeValidationResult,
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  commandPort: any,
  projectDetection: any,
  p: any
): Promise<'auto_fixed' | undefined> {
  const pkgJsonPath = p.join(resolvedPath, 'package.json');
  const pkgExists = await fileSystem.fileExists(p.relative(repoRoot, pkgJsonPath));

  if (!pkgExists) {
    return;
  }

  const pkgContent = await fileSystem.readFile(p.relative(repoRoot, pkgJsonPath));
  if (!pkgContent) {
    return;
  }

  try {
    const pkg = JSON.parse(pkgContent);
    
    // Check for build script
    if (!pkg.scripts?.build) {
      return;
    }

    console.log('🔨 Running build...');
    
    const pm = await commandPort.detectPackageManager(resolvedPath);
    const buildResult = await commandPort.execute(`${pm} run build`, {
      cwd: resolvedPath,
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    if (!buildResult.success) {
      result.passed = false;
      // ✅ Build tools may output errors to stdout or stderr - combine both
      const errorOutput = [buildResult.stderr, buildResult.stdout]
        .filter(s => s && s.trim().length > 0)
        .join('\n\n');
      
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
          console.error('🚨 ENVIRONMENT ISSUE DETECTED!');
          console.error(`   ${diagnosis.message}`);
          console.error('   Root cause:', diagnosis.rootCause);
          diagnosis.suggestedActions.forEach(action => console.error(`   • ${action}`));
          
          // ✅ Check if this is a corrupted dependency issue (auto-fixable)
          const isCorruptedDependency = diagnosis.message.toLowerCase().includes('corrupted') ||
                                         diagnosis.message.toLowerCase().includes('rollup') ||
                                         diagnosis.type === 'environment_issue';
          
          if (isCorruptedDependency && diagnosis.canLLMFix) {
            const autoFixed = await attemptAutoFix(commandPort, resolvedPath, pm);
            if (autoFixed) {
              result.passed = true;
              result.buildErrors = [];
              return 'auto_fixed';
            }
          }
        }
      }
      
      // ✅ Use new Vite parser for build errors
      const buildParser = ErrorParserFactory.create('vite', {
        projectRoot: resolvedPath,
        maxErrors: 50
      });
      const parsedBuildErrors = buildParser.parse(errorOutput);
      result.buildErrors = buildParser.format(parsedBuildErrors);
      
      // ⚠️ CRITICAL: If parser failed to extract errors, use raw output
      if (result.buildErrors!.length === 0 && errorOutput && errorOutput.trim().length > 0) {
        console.warn('⚠️  Build error parser returned no errors, using raw output');
        result.buildErrors = [errorOutput];
      }
      
      console.error('❌ Build failed:');
      if (result.buildErrors && result.buildErrors.length > 0) {
        result.buildErrors!.slice(0, 10).forEach(err => console.error(`   ${err}`));
        if (result.buildErrors!.length > 10) {
          console.error(`   ... and ${result.buildErrors!.length - 10} more errors`);
        }
      } else {
        console.error('   (No specific error messages captured)');
      }
    } else {
      console.log('✅ Build passed');
    }
  } catch {
    // Ignore parse errors
  }
}

/**
 * Run pre-build compatibility check
 * 
 * Analyzes framework config files to detect known incompatible settings
 * BEFORE build fails with cryptic errors.
 * 
 * Platform-neutral: Each framework has its own compatibility rules defined in
 * diagnostics/frameworks/{framework}.ts
 */
async function runCompatibilityCheck(
  result: RuntimeValidationResult,
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  projectDetection: any,
  p: any
): Promise<Array<{ framework: string; severity: string; issue: string; configFile: string; fix: string }>> {
  const issues: Array<{ framework: string; severity: string; issue: string; configFile: string; fix: string }> = [];
  
  const framework = projectDetection.framework;
  
  if (framework === Framework.NONE) {
    return issues;
  }
  
  console.log(`\n🔍 Running ${framework} compatibility check...`);
  
  // Framework-specific config file detection
  const configFiles: { path: string; parser: (content: string) => any }[] = [];
  
  switch (framework) {
    case Framework.NEXTJS:
      // Check next.config.js, next.config.mjs, next.config.ts
      for (const configName of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
        const configPath = p.relative(repoRoot, p.join(resolvedPath, configName));
        if (await fileSystem.fileExists(configPath)) {
          configFiles.push({
            path: configPath,
            parser: parseNextConfig
          });
          break; // Use first found
        }
      }
      break;
      
    // Add more frameworks here as needed
    // case Framework.NUXT:
    //   configFiles.push({ path: 'nuxt.config.ts', parser: parseNuxtConfig });
    //   break;
  }
  
  // Check each config file
  for (const { path: configPath, parser } of configFiles) {
    try {
      const content = await fileSystem.readFile(configPath);
      if (!content) continue;
      
      const config = parser(content);
      if (!config) continue;
      
      const frameworkIssues = checkCompatibility(framework, configPath, config);
      issues.push(...frameworkIssues.map(i => ({
        framework: i.framework,
        severity: i.severity,
        issue: i.issue,
        configFile: i.configFile,
        fix: i.fix
      })));
      
    } catch (error) {
      console.warn(`⚠️  Could not parse ${configPath}:`, error instanceof Error ? error.message : error);
    }
  }
  
  if (issues.length > 0) {
    console.log(`\n⚠️  Found ${issues.length} compatibility issue(s):`);
    issues.forEach(i => {
      console.log(`   - [${i.severity.toUpperCase()}] ${i.issue}`);
      console.log(`     Fix: ${i.fix}`);
    });
    console.log('');
  } else {
    console.log('✅ No compatibility issues found\n');
  }
  
  return issues;
}

/**
 * Parse Next.js config file (simplified extraction)
 * 
 * Extracts key settings without full JS evaluation
 */
function parseNextConfig(content: string): any {
  const config: any = {};
  
  // Extract output setting
  const outputMatch = content.match(/output\s*:\s*['"]([^'"]+)['"]/);
  if (outputMatch) {
    config.output = outputMatch[1];
  }
  
  // Extract images.unoptimized setting
  const unoptimizedMatch = content.match(/unoptimized\s*:\s*(true|false)/);
  if (unoptimizedMatch) {
    config.images = config.images || {};
    config.images.unoptimized = unoptimizedMatch[1] === 'true';
  }
  
  // Check for images block without unoptimized
  const imagesBlockMatch = content.match(/images\s*:\s*\{/);
  if (imagesBlockMatch && !unoptimizedMatch) {
    config.images = config.images || {};
    // images block exists but unoptimized not set
  }
  
  return config;
}

/**
 * Attempt to auto-fix corrupted dependencies
 */
async function attemptAutoFix(
  commandPort: any,
  resolvedPath: string,
  pm: string
): Promise<boolean> {
  console.log('\n⚡ ATTEMPTING AUTO-FIX: Clean dependency reinstall...');
  
  try {
    // Step 1: Remove corrupted files using Node.js fs (safer than shell rm)
    console.log('🗑️  Removing node_modules and lock files...');
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Remove node_modules
      const nodeModulesPath = path.join(resolvedPath, 'node_modules');
      try {
        await fs.rm(nodeModulesPath, { recursive: true, force: true });
        console.log('   ✅ Removed node_modules');
      } catch (err) {
        console.log('   ℹ️  node_modules not found or already removed');
      }
      
      // Remove lock files
      const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
      for (const lockFile of lockFiles) {
        const lockPath = path.join(resolvedPath, lockFile);
        try {
          await fs.unlink(lockPath);
          console.log(`   ✅ Removed ${lockFile}`);
        } catch (err) {
          // File doesn't exist, ignore
        }
      }
      
      console.log('   ✅ Cleanup completed');
    } catch (fsError) {
      console.error('   ❌ Failed to remove files:', fsError instanceof Error ? fsError.message : fsError);
      throw new Error('Failed to remove corrupted files');
    }
    
    // Step 2: Clear cache
    console.log('🧹 Clearing package manager cache...');
    const clearCmd = pm === 'npm' ? 'npm cache clean --force' :
                    pm === 'yarn' ? 'yarn cache clean' :
                    'pnpm store prune';
    const cacheResult = await commandPort.execute(clearCmd, { 
      cwd: resolvedPath, 
      timeout: 60000 
    });
    if (!cacheResult.success) {
      console.warn('   ⚠️  Cache clear failed (non-critical):', cacheResult.stderr);
    } else {
      console.log('   ✅ Cache cleared');
    }
    
    // Step 3: Reinstall dependencies
    console.log('📦 Reinstalling dependencies (this may take 1-2 minutes)...');
    const installResult = await commandPort.execute(`${pm} install`, { 
      cwd: resolvedPath, 
      timeout: 5 * 60 * 1000  // 5 minutes timeout
    });
    if (!installResult.success) {
      console.error('   ❌ Installation failed:', installResult.stderr);
      throw new Error('Failed to reinstall dependencies');
    }
    console.log('   ✅ Dependencies reinstalled successfully\n');
    
    // Step 4: Retry build
    console.log('🔨 Retrying build after dependency fix...');
    const retryResult = await commandPort.execute(`${pm} run build`, {
      cwd: resolvedPath,
      timeout: 5 * 60 * 1000,
    });
    
    if (retryResult.success) {
      console.log('✅ BUILD SUCCEEDED after auto-fix!\n');
      return true;
    } else {
      console.error('❌ Build still failing after dependency fix');
      console.error('   This may be a code error, not an environment issue');
      return false;
    }
  } catch (autoFixError) {
    console.error('❌ Auto-fix failed:', autoFixError instanceof Error ? autoFixError.message : autoFixError);
    console.error('   User intervention may be required\n');
    return false;
  }
}

/**
 * Handle ENVIRONMENT errors that require user intervention
 */
function handleEnvironmentError(
  state: ArchitectGraphState,
  result: RuntimeValidationResult
): ArchitectGraphState {
  const envDiagnosis = result.diagnoses!.find(d => d.layer === ErrorLayer.ENVIRONMENT && !d.canLLMFix);
  
  const violations = state.violations || [];
  violations.push({
    type: envDiagnosis!.type as any,
    severity: envDiagnosis!.severity as any,
    message: envDiagnosis!.message,
    suggestedFix: envDiagnosis!.suggestedActions.join('\n'),
    isRetryable: false,  // ✅ ENVIRONMENT issues cannot be fixed by LLM
  });
  
  return {
    ...state,
    violations,
    runtimeValidationResult: result,
  };
}

/**
 * Handle validation failure
 */
async function handleValidationFailure(
  state: ArchitectGraphState,
  result: RuntimeValidationResult,
  recentToolFailures: number
): Promise<ArchitectGraphState> {
  const violations = state.violations || [];
  
  // ✅ Apply validation policy to determine filtering level
  const { 
    determineValidationLevel, 
    filterErrorsByLevel, 
    logValidationLevel 
  } = await import("../validationPolicy");
  
  const validationContext = {
    taskType: state.currentTask?.type || 'feature',
    taskName: state.currentTask?.name || 'Unknown',
    retryCount: state.retries || 0,
    isLastTask: (state.taskQueue?.size() || 0) === 0,
    hasPreviousAttempts: (state.retries || 0) > 0
  };
  
  const validationLevel = determineValidationLevel(validationContext);
  logValidationLevel(validationLevel, validationContext);
  
  // ✅ Convert diagnostics to structured violations
  let newViolations = convertDiagnosesToViolations(result);
  
  // ⚠️ CRITICAL SAFETY CHECK: If build/type/lint failed but no violations were created,
  // add a generic violation to prevent silent failures
  if (newViolations.length === 0) {
    console.warn('⚠️  Validation failed but no violations were generated - adding generic violation');
    
    let errorMessage = 'Validation failed but specific errors could not be parsed';
    const errorSources: string[] = [];
    
    if (result.buildErrors && result.buildErrors.length > 0) {
      errorSources.push(`Build errors: ${result.buildErrors.length}`);
    }
    if (result.typeErrors && result.typeErrors.length > 0) {
      errorSources.push(`Type errors: ${result.typeErrors.length}`);
    }
    if (result.lintErrors && result.lintErrors.length > 0) {
      errorSources.push(`Lint errors: ${result.lintErrors.length}`);
    }
    
    if (errorSources.length > 0) {
      errorMessage = `Validation failed: ${errorSources.join(', ')}`;
    }
    
    newViolations.push({
      type: 'build_error',
      severity: 'critical',
      message: errorMessage,
      suggestedFix: 'Review build output and fix configuration or code issues',
      isRetryable: true
    });
  }
  
  // ✅ Apply validation level filtering
  const filteredViolations = filterErrorsByLevel(newViolations, validationLevel) as any[];
  
  // ✅ NEW: Add context about repeated tool failures (if detected)
  if (recentToolFailures >= 3) {
    console.warn(`\n⚠️  [RuntimeValidate] Adding violation context: ${recentToolFailures} recent tool failures detected\n`);
    
    filteredViolations.push({
      type: 'build_error',
      severity: 'critical',
      message: `Build validation failed after ${recentToolFailures} failed command attempts. This indicates a systemic issue that was not resolved by retrying.`,
      suggestedFix: 'Review command history and environment setup. The issue is likely related to:\n' +
        '1. Missing or misconfigured dependencies\n' +
        '2. Environment variables (NODE_ENV, PATH, etc.)\n' +
        '3. File permissions or access issues\n' +
        '4. Incorrect working directory\n\n' +
        'Check the command history to see what was attempted.',
      isRetryable: false,
      metadata: {
        context: 'repeated_tool_failures',
        failureCount: recentToolFailures,
        commandHistory: state.commandHistory?.slice(-10)  // Last 10 commands
      }
    });
  }
  
  console.log(`\n📊 Validation Results:`);
  console.log(`   Total errors found: ${newViolations.length}`);
  console.log(`   After filtering: ${filteredViolations.length}`);
  
  if (filteredViolations.length < newViolations.length) {
    const filtered = newViolations.length - filteredViolations.length;
    console.log(`   ✅ ${filtered} error(s) ignored based on validation level`);
  }

  // ✅ If no blocking errors remain after filtering, pass validation
  if (filteredViolations.length === 0) {
    console.log(`\n✅ No blocking errors - proceeding despite warnings\n`);
    
    // Save checkpoint
    const { saveCheckpoint } = await import("../checkpoint");
    await saveCheckpoint(state);
    
    return {
      ...state,
      runtimeValidationResult: { ...result, passed: true },
    };
  }

  return {
    ...state,
    violations: [...violations, ...filteredViolations],
    runtimeValidationResult: result,
  };
}

