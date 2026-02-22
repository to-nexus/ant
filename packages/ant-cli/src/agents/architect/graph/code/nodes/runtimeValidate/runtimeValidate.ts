/**
 * Runtime Validate Node
 * 
 * Performs runtime validation by actually running language-appropriate checks:
 * - Node.js/TypeScript: tsc --noEmit, eslint, npm run build
 * - Go: go vet ./..., go build ./...
 * - Other languages: uses ProjectRuntimeConfig to determine commands
 * 
 * This node executes build tools and collects errors, then uses the
 * diagnostics system to parse and categorize them.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses CommandPort for command execution
 * - Uses GitPort for file operations
 * 
 * ✅ Multi-language support via ProjectRuntime abstraction
 */

import path from "path";
import * as fs from "fs";
import { ArchitectGraphState } from "../../state";
import { 
  detectProject, 
  diagnoseError, 
  checkCompatibility,
  ErrorLayer, 
  Framework,
} from "../diagnostics";
import { Language } from "../diagnostics/types";
import { errorStatsCollector } from "../diagnostics/errorStats";
import { ErrorParserFactory } from "../diagnostics/parsers";
import { RuntimeValidationResult } from "./types";
import { detectRecentToolFailures } from "./utils";
import { convertDiagnosesToViolations } from "./violations";
import { getProjectRuntime, type ProjectRuntimeConfig } from "../projectRuntime";

const DOCKER_COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

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
      (state as any).workerId ?? 0,
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Docker Infrastructure: Start before validation, stop after (finally)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let infraStarted = false;
  const composeFilePath = findComposeFile(resolvedPath);
  if (composeFilePath) {
    infraStarted = await startDockerInfrastructure(composeFilePath, commandPort);
  }

  try {

  // ✅ Detect project type first
  const projectDetection = await detectProject(resolvedPath, gitPort, fileSystem);
  const runtime = getProjectRuntime(projectDetection);
  console.log(`🔍 Detected: ${projectDetection.language} + ${projectDetection.buildTool} (${projectDetection.packageManager})`);

  // ✅ RUNTIME VALIDATION: Show applicable checks
  console.log('🔍 Runtime validation mode (full)');
  if (runtime.validation.typeCheck) console.log(`   ✅ ${runtime.validation.typeCheck.name}`);
  if (runtime.validation.lint) console.log(`   ✅ ${runtime.validation.lint.name}`);
  if (runtime.validation.build) console.log(`   ✅ ${runtime.validation.build.name}`);
  if (runtime.validation.test) console.log(`   ✅ ${runtime.validation.test.name}`);
  if (!runtime.validation.typeCheck && !runtime.validation.lint && !runtime.validation.build) {
    console.log(`   ⚠️  No validation steps configured for ${projectDetection.language}`);
  }
  console.log('');

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
    // 1. Type Check (language-specific: tsc --noEmit / go vet ./... / etc.)
    await runTypeCheck(result, resolvedPath, repoRoot, fileSystem, commandPort, projectDetection, runtime, p);
    
    // Return early if ENVIRONMENT error detected in type check
    if (result.diagnoses?.some(d => d.layer === ErrorLayer.ENVIRONMENT && !d.canLLMFix)) {
      return handleEnvironmentError(state, result);
    }

    // 2. Lint (language-specific: eslint / golangci-lint / etc.)
    await runLint(result, resolvedPath, repoRoot, fileSystem, commandPort, projectDetection, runtime, p);

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

    // 3. Build (language-specific: npm run build / go build ./... / etc.)
    const buildSuccess = await runBuild(result, resolvedPath, repoRoot, fileSystem, commandPort, projectDetection, runtime, p);
    
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

    // 4. Static asset integrity check (frontend-only: catches silent runtime 404)
    // Only applicable for projects with a public/ directory (frontend/fullstack Node.js)
    const isFrontendProject = projectDetection.language === Language.TYPESCRIPT ||
                               projectDetection.language === Language.JAVASCRIPT;
    const missingStaticAssets = isFrontendProject
      ? await findMissingPublicAssetReferences(repoRoot, fileSystem, p)
      : [];
    // 5. Test (language-specific: go test ./... / npm test / etc.)
    // Safety net — LLM already runs tests via run_command in verification step.
    // Only runs if test config indicators exist; skips silently otherwise.
    await runTest(result, resolvedPath, repoRoot, fileSystem, commandPort, projectDetection, runtime, p);

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
    const configHint = runtime.dependency.configFile
      ? `missing ${runtime.dependency.configFile} in codebase root`
      : 'missing project configuration';
    return {
      ...state,
      violations: [
        {
          type: 'build_error',
          severity: 'critical',
          message: `Runtime validation failed to execute:\n${error?.message || String(error)}\n\nCommon cause: ${configHint}.`,
          suggestedFix: `Ensure ${runtime.dependency.configFile || 'project config'} exists in the codebase root and rerun final verification.`,
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
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'runtimeValidate', (state as any).workerId ?? 0);
  }
  
  // 🚨 CRITICAL: Clear violations on success
  return {
    ...state,
    violations: [],  // ← Clear current violations
    lastViolations: [],  // ← Clear last violations
    runtimeValidationResult: result,
  };

  } finally {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Docker Infrastructure: Cleanup (best-effort)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (infraStarted && composeFilePath) {
      await stopDockerInfrastructure(composeFilePath, commandPort);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Docker Infrastructure helpers
// ─────────────────────────────────────────────────────────────

function findComposeFile(projectPath: string): string | null {
  for (const fileName of DOCKER_COMPOSE_FILES) {
    const filePath = path.join(projectPath, fileName);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

async function startDockerInfrastructure(
  composeFile: string,
  commandPort: any,
): Promise<boolean> {
  console.log(`\n🐳 [runtimeValidate] Docker infrastructure detected: ${path.basename(composeFile)}`);

  const dockerCheck = await commandPort.execute('docker info', {
    cwd: path.dirname(composeFile),
    timeout: 10_000,
  });
  if (!dockerCheck.success) {
    console.warn(`⚠️  Docker not available — skipping infrastructure startup`);
    return false;
  }

  console.log(`🐳 Starting infrastructure services (docker compose up -d --wait)...`);
  const result = await commandPort.execute(
    `docker compose -f ${composeFile} up -d --wait`,
    { cwd: path.dirname(composeFile), timeout: 90_000 },
  );

  if (result.success) {
    console.log(`✅ Infrastructure services ready\n`);
    return true;
  }

  console.warn(`⚠️  docker compose up failed (exit ${result.exitCode}). Continuing with build-only validation.`);
  if (result.stderr) {
    const lines = result.stderr.split('\n').filter((l: string) => l.trim()).slice(-5);
    lines.forEach((l: string) => console.warn(`   ${l}`));
  }
  return false;
}

async function stopDockerInfrastructure(
  composeFile: string,
  commandPort: any,
): Promise<void> {
  console.log(`\n🐳 [runtimeValidate] Stopping infrastructure services...`);
  try {
    await commandPort.execute(
      `docker compose -f ${composeFile} down`,
      { cwd: path.dirname(composeFile), timeout: 30_000 },
    );
    console.log(`✅ Infrastructure services stopped\n`);
  } catch (err: any) {
    console.warn(`⚠️  Infrastructure cleanup failed (best-effort): ${err.message}`);
  }
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
 * Run type check (language-specific via ProjectRuntimeConfig)
 * - Node.js/TypeScript: npx tsc --noEmit
 * - Go: go vet ./...
 * - Skipped if runtime.validation.typeCheck is null
 */
async function runTypeCheck(
  result: RuntimeValidationResult,
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  commandPort: any,
  projectDetection: any,
  runtime: ProjectRuntimeConfig,
  p: any
): Promise<void> {
  const typeCheckConfig = runtime.validation.typeCheck;
  if (!typeCheckConfig) {
    return;
  }

  // Check if any indicator file exists
  // ✅ Use fileSystem.getRootPath() (feature path) as base, not repoRoot (codebase path)
  // repoRoot === resolvedPath, so p.relative(repoRoot, ...) would just give bare filename
  const fsRoot = fileSystem.getRootPath();
  let hasIndicator = false;
  for (const indicator of typeCheckConfig.indicators) {
    if (await fileSystem.fileExists(p.relative(fsRoot, p.join(resolvedPath, indicator)))) {
      hasIndicator = true;
      break;
    }
  }

  if (!hasIndicator) {
    console.log(`ℹ️  ${typeCheckConfig.name} skipped (no ${typeCheckConfig.indicators.join('/')} found)`);
    return;
  }

  const command = typeCheckConfig.getCommand();
  console.log(`📘 Running ${typeCheckConfig.name}...`);
  
  const typeCheckResult = await commandPort.execute(command, {
    cwd: resolvedPath,
    timeout: 2 * 60 * 1000, // 2 minutes
  });

  if (!typeCheckResult.success) {
    result.passed = false;
    // TypeScript outputs errors to STDOUT; Go vet outputs to stderr. Combine both.
    const errorOutput = typeCheckResult.stdout || typeCheckResult.stderr;
    
    // Use parser from runtime config (falls back to generic if not specified)
    const parserType = typeCheckConfig.parserType || 'generic';
    const parser = ErrorParserFactory.create(parserType, {
      projectRoot: resolvedPath,
      maxErrors: 50
    });
    const parsedErrors = parser.parse(errorOutput);
    
    // Convert parsed errors to formatted strings
    result.typeErrors = parser.format(parsedErrors);
    
    // Use diagnostics system
    const diagnosis = diagnoseError(errorOutput, {
      command,
      workDir: resolvedPath,
      output: errorOutput,
      projectDetection,
    });
    
    if (diagnosis) {
      result.diagnoses!.push(diagnosis);
      
      errorStatsCollector.recordError(diagnosis, {
        command,
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
      }
    }
    
    console.error(`❌ ${typeCheckConfig.name} failed:`);
    result.typeErrors!.slice(0, 10).forEach(err => console.error(`   ${err}`));
    if (result.typeErrors!.length > 10) {
      console.error(`   ... and ${result.typeErrors!.length - 10} more errors`);
    }
  } else {
    console.log(`✅ ${typeCheckConfig.name} passed`);
  }
}

/**
 * Run lint (language-specific via ProjectRuntimeConfig)
 * - Node.js/TypeScript: npx eslint
 * - Go: null (golangci-lint is external, not guaranteed)
 * - Skipped if runtime.validation.lint is null
 */
async function runLint(
  result: RuntimeValidationResult,
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  commandPort: any,
  projectDetection: any,
  runtime: ProjectRuntimeConfig,
  p: any
): Promise<void> {
  const lintConfig = runtime.validation.lint;
  if (!lintConfig) {
    console.log(`ℹ️  Lint not configured for ${projectDetection.language}, skipping`);
    return;
  }

  // Check if any indicator file exists
  // ✅ Use fileSystem.getRootPath() (feature path) as base, not repoRoot (codebase path)
  const fsRootLint = fileSystem.getRootPath();
  let hasIndicator = false;
  for (const indicator of lintConfig.indicators) {
    if (await fileSystem.fileExists(p.relative(fsRootLint, p.join(resolvedPath, indicator)))) {
      hasIndicator = true;
      break;
    }
  }

  if (!hasIndicator) {
    console.log(`ℹ️  ${lintConfig.name} not configured, skipping lint check`);
    return;
  }

  const command = lintConfig.getCommand();
  console.log(`📋 Running ${lintConfig.name}...`);
  
  const lintResult = await commandPort.execute(command, {
    cwd: resolvedPath,
    timeout: 2 * 60 * 1000,
  });

  if (!lintResult.success) {
    // ⚠️  Check if errors are in build artifacts (ESLint-specific configuration issue)
    const isESLint = lintConfig.parserType === 'eslint';
    const isBuildArtifactError = isESLint && /\/(dist|build|node_modules|\.next|\.nuxt|out)\//i.test(lintResult.stdout);
    
    if (isBuildArtifactError) {
      console.error('⚠️  ESLint Configuration Error Detected!');
      console.error('   ESLint is checking build artifacts (dist/, node_modules/, etc.)');
      console.error('   This indicates missing ignorePatterns in .eslintrc.json');
      
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
      const parserType = lintConfig.parserType || 'generic';
      const lintParser = ErrorParserFactory.create(parserType, {
        projectRoot: resolvedPath,
        maxErrors: 50
      });
      const parsedLintErrors = lintParser.parse(lintResult.stdout);
      result.lintErrors = lintParser.format(parsedLintErrors);
      
      if (result.lintErrors && result.lintErrors.length > 0) {
        const diagnosis = diagnoseError(lintResult.stdout, {
          command,
          workDir: resolvedPath,
          output: lintResult.stdout,
          projectDetection,
        });
        
        if (diagnosis) {
          result.diagnoses!.push(diagnosis);
          
          errorStatsCollector.recordError(diagnosis, {
            command,
            workDir: resolvedPath,
            language: projectDetection.language,
            buildTool: projectDetection.buildTool,
            packageManager: projectDetection.packageManager,
          });
        }
        
        console.error(`⚠️  ${lintConfig.name} failed (non-blocking):`);
        result.lintErrors!.slice(0, 10).forEach(err => console.error(`   ${err}`));
        if (result.lintErrors!.length > 10) {
          console.error(`   ... and ${result.lintErrors!.length - 10} more errors`);
        }
        console.log('   ℹ️  Lint errors have LOW priority - fix build/deps/types first');
      }
      
      // ✅ CRITICAL: Do NOT set result.passed = false for lint-only failures
      // Let the validation level filtering handle this (FUNCTIONAL level ignores lint)
    }
  } else {
    console.log(`✅ ${lintConfig.name} passed`);
  }
}

/**
 * Run build (language-specific via ProjectRuntimeConfig)
 * - Node.js: checks package.json scripts.build, uses PM, supports auto-fix
 * - Go: go build ./..., no PM needed
 * - Other: uses runtime.validation.build config
 * 
 * @returns 'auto_fixed' if build succeeded after auto-fix, undefined otherwise
 */
async function runBuild(
  result: RuntimeValidationResult,
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  commandPort: any,
  projectDetection: any,
  runtime: ProjectRuntimeConfig,
  p: any
): Promise<'auto_fixed' | undefined> {
  const buildConfig = runtime.validation.build;
  if (!buildConfig) {
    return;
  }

  // Check if any indicator file exists
  // ✅ Use fileSystem.getRootPath() (feature path) as base, not repoRoot (codebase path)
  const fsRootBuild = fileSystem.getRootPath();
  let hasIndicator = false;
  for (const indicator of buildConfig.indicators) {
    if (await fileSystem.fileExists(p.relative(fsRootBuild, p.join(resolvedPath, indicator)))) {
      hasIndicator = true;
      break;
    }
  }

  if (!hasIndicator) {
    return;
  }

  // ─── Node.js-specific: check for scripts.build in package.json ───
  const isNodeProject = projectDetection.language === Language.TYPESCRIPT ||
                         projectDetection.language === Language.JAVASCRIPT;
  let buildCommand: string;
  let pm: string | null = null;

  if (isNodeProject) {
    const pkgJsonPath = p.join(resolvedPath, 'package.json');
    const pkgContent = await fileSystem.readFile(p.relative(fsRootBuild, pkgJsonPath));
    if (!pkgContent) return;

    try {
      const pkg = JSON.parse(pkgContent);
      if (!pkg.scripts?.build) return;
    } catch {
      return;
    }

    pm = await commandPort.detectPackageManager(resolvedPath);
    buildCommand = buildConfig.getCommand(pm || undefined);
  } else {
    // Go, Rust, etc. - use runtime config directly
    buildCommand = buildConfig.getCommand();
  }

  console.log(`🔨 Running ${buildConfig.name}...`);
  
  const buildResult = await commandPort.execute(buildCommand, {
    cwd: resolvedPath,
    timeout: 5 * 60 * 1000, // 5 minutes
  });

  if (!buildResult.success) {
    result.passed = false;
    // Build tools may output errors to stdout or stderr - combine both
    const errorOutput = [buildResult.stderr, buildResult.stdout]
      .filter((s: string) => s && s.trim().length > 0)
      .join('\n\n');
    
    // Use diagnostics system
    const diagnosis = diagnoseError(errorOutput, {
      command: buildCommand,
      workDir: resolvedPath,
      output: errorOutput,
      projectDetection,
    });
    
    if (diagnosis) {
      result.diagnoses!.push(diagnosis);
      
      errorStatsCollector.recordError(diagnosis, {
        command: buildCommand,
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
        
        // Node.js-specific: auto-fix corrupted dependencies
        if (isNodeProject && pm) {
          const isCorruptedDependency = diagnosis.message.toLowerCase().includes('corrupted') ||
                                         diagnosis.message.toLowerCase().includes('rollup') ||
                                         diagnosis.type === 'environment_issue';
          
          if (isCorruptedDependency && diagnosis.canLLMFix) {
            const autoFixed = await attemptNodeAutoFix(commandPort, resolvedPath, pm);
            if (autoFixed) {
              result.passed = true;
              result.buildErrors = [];
              return 'auto_fixed';
            }
          }
        }
      }
    }
    
    // Use parser from runtime config
    const parserType = buildConfig.parserType || 'generic';
    const buildParser = ErrorParserFactory.create(parserType, {
      projectRoot: resolvedPath,
      maxErrors: 50
    });
    const parsedBuildErrors = buildParser.parse(errorOutput);
    result.buildErrors = buildParser.format(parsedBuildErrors);
    
    // CRITICAL: If parser failed to extract errors, use raw output
    if (result.buildErrors!.length === 0 && errorOutput && errorOutput.trim().length > 0) {
      console.warn('⚠️  Build error parser returned no errors, using raw output');
      result.buildErrors = [errorOutput];
    }
    
    console.error(`❌ ${buildConfig.name} failed:`);
    if (result.buildErrors && result.buildErrors.length > 0) {
      result.buildErrors!.slice(0, 10).forEach(err => console.error(`   ${err}`));
      if (result.buildErrors!.length > 10) {
        console.error(`   ... and ${result.buildErrors!.length - 10} more errors`);
      }
    } else {
      console.error('   (No specific error messages captured)');
    }
  } else {
    console.log(`✅ ${buildConfig.name} passed`);
  }
}

/**
 * Run test suite (safety net — LLM already runs tests via run_command in verify step).
 * Only runs if test config files are detected. Skips silently if no test infrastructure.
 */
async function runTest(
  result: RuntimeValidationResult,
  resolvedPath: string,
  repoRoot: string,
  fileSystem: any,
  commandPort: any,
  projectDetection: any,
  runtime: ProjectRuntimeConfig,
  p: any
): Promise<void> {
  const testConfig = runtime.validation.test;
  if (!testConfig) {
    return;
  }

  const fsRoot = fileSystem.getRootPath();
  let hasIndicator = false;
  for (const indicator of testConfig.indicators) {
    if (await fileSystem.fileExists(p.relative(fsRoot, p.join(resolvedPath, indicator)))) {
      hasIndicator = true;
      break;
    }
  }

  if (!hasIndicator) {
    return;
  }

  // Node.js: check if test script exists in package.json
  const isNodeProject = projectDetection.language === Language.TYPESCRIPT ||
                         projectDetection.language === Language.JAVASCRIPT;
  let testCommand: string;

  if (isNodeProject) {
    const pkgJsonPath = p.join(resolvedPath, 'package.json');
    const pkgContent = await fileSystem.readFile(p.relative(fsRoot, pkgJsonPath));
    if (!pkgContent) return;

    try {
      const pkg = JSON.parse(pkgContent);
      if (!pkg.scripts?.test) return;
    } catch {
      return;
    }

    const pm = await commandPort.detectPackageManager(resolvedPath);
    testCommand = testConfig.getCommand(pm || undefined);
  } else {
    testCommand = testConfig.getCommand();
  }

  console.log(`🧪 Running ${testConfig.name}...`);

  const testResult = await commandPort.execute(testCommand, {
    cwd: resolvedPath,
    timeout: 3 * 60 * 1000, // 3 minutes
  });

  if (!testResult.success) {
    result.passed = false;
    const errorOutput = [testResult.stderr, testResult.stdout]
      .filter((s: string) => s && s.trim().length > 0)
      .join('\n\n');

    const parserType = testConfig.parserType || 'generic';
    const testParser = ErrorParserFactory.create(parserType, {
      projectRoot: resolvedPath,
      maxErrors: 30
    });
    const parsedTestErrors = testParser.parse(errorOutput);
    result.testErrors = testParser.format(parsedTestErrors);

    if (result.testErrors!.length === 0 && errorOutput && errorOutput.trim().length > 0) {
      result.testErrors = [errorOutput];
    }

    console.error(`❌ ${testConfig.name} failed:`);
    if (result.testErrors && result.testErrors.length > 0) {
      result.testErrors!.slice(0, 5).forEach(err => console.error(`   ${err}`));
      if (result.testErrors!.length > 5) {
        console.error(`   ... and ${result.testErrors!.length - 5} more errors`);
      }
    }
  } else {
    console.log(`✅ ${testConfig.name} passed`);
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
        const configPath = p.relative(fileSystem.getRootPath(), p.join(resolvedPath, configName));
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
 * Attempt to auto-fix corrupted Node.js dependencies
 * Node.js-specific: removes node_modules, clears cache, reinstalls
 */
async function attemptNodeAutoFix(
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

