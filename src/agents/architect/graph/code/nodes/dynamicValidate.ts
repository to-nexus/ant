/**
 * Dynamic Validate Node
 * 
 * Performs runtime validation by actually running:
 * 1. Build (tsc, pnpm build, etc)
 * 2. Lint (eslint)
 * 3. Type check (tsc --noEmit)
 * 4. Tests (optional)
 * 
 * This is similar to Cursor's behavior where it tries to build
 * and automatically fixes errors.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses CommandPort for command execution
 * - Uses GitPort for file operations
 */

import { ArchitectGraphState } from "../state";
import { CommandPort, GitPort } from "../../../../../core/ports";
import * as path from "path";

export interface DynamicValidationResult {
  passed: boolean;
  errors: string[];  // Required, aggregated from all error types
  buildErrors?: string[];
  lintErrors?: string[];
  typeErrors?: string[];
  testErrors?: string[];
}

/**
 * Dynamic validation - run actual build/lint/test
 * 
 * Only runs if:
 * 1. CommandPort is available
 * 2. Config has strictValidation enabled (or --strict flag)
 * 3. Target repository exists
 */
export async function dynamicValidate(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;

  // Skip if not enabled
  if (!state.context.config?.strictValidation) {
    console.log('⚠️  Dynamic validation disabled (enable with strictValidation: true in config)');
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
    console.log('⚠️  No local repository path, skipping dynamic validation');
    return state;
  }

  const repoRoot = await gitPort.getRepoRoot();
  const p = await import("path");
  const resolvedPath = p.isAbsolute(config.localPath)
    ? config.localPath
    : p.resolve(repoRoot, config.localPath);

  console.log(`\n🔍 Running dynamic validation in: ${resolvedPath}\n`);

  const result: DynamicValidationResult = {
    passed: true,
    errors: [],
    buildErrors: [],
    lintErrors: [],
    typeErrors: [],
    testErrors: [],
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
        result.typeErrors = parseTypeScriptErrors(typeCheckResult.stderr);
        console.error('❌ Type check failed:');
        result.typeErrors.forEach(err => console.error(`   ${err}`));
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
      console.log('🔍 Running ESLint...');
      
      const lintResult = await commandPort.execute('npx eslint . --ext .ts,.tsx,.js,.jsx', {
        cwd: resolvedPath,
        timeout: 2 * 60 * 1000,
      });

      if (!lintResult.success) {
        result.passed = false;
        result.lintErrors = parseLintErrors(lintResult.stdout);
        console.error('❌ Lint failed:');
        result.lintErrors.slice(0, 10).forEach(err => console.error(`   ${err}`));
        if (result.lintErrors.length > 10) {
          console.error(`   ... and ${result.lintErrors.length - 10} more errors`);
        }
      } else {
        console.log('✅ Lint passed');
      }
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
              result.buildErrors = parseBuildErrors(buildResult.stderr);
              console.error('❌ Build failed:');
              result.buildErrors.slice(0, 5).forEach(err => console.error(`   ${err}`));
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
    
    const errorSummary = [
      '🔴 DYNAMIC VALIDATION FAILED',
      '',
      ...formatValidationErrors(result),
    ].join('\n');

    return {
      ...state,
      violations: [...violations, errorSummary],
      dynamicValidationResult: result,
    };
  }

  console.log('\n✅ All dynamic validations passed!\n');
  
  return {
    ...state,
    dynamicValidationResult: result,
  };
}

/**
 * Parse TypeScript errors
 */
function parseTypeScriptErrors(stderr: string): string[] {
  const lines = stderr.split('\n');
  const errors: string[] = [];
  
  for (const line of lines) {
    if (line.includes('error TS')) {
      errors.push(line.trim());
    }
  }
  
  return errors.length > 0 ? errors : [stderr];
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
 * Parse build errors
 */
function parseBuildErrors(stderr: string): string[] {
  const lines = stderr.split('\n');
  return lines
    .filter(line => line.trim().length > 0)
    .map(line => line.trim());
}

/**
 * Format validation errors for display
 */
function formatValidationErrors(result: DynamicValidationResult): string[] {
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
    lines.push('🔍 Lint Errors:');
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

