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
 * 2. Config has strictValidation enabled (DEFAULT: true, disable with strictValidation: false)
 * 3. Target repository exists
 */
export async function dynamicValidate(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;

  // Skip if explicitly disabled (default is enabled)
  const strictValidation = state.context.config?.strictValidation ?? true;  // ✅ Default: true
  if (strictValidation === false) {
    console.log('⚠️  Dynamic validation disabled (set strictValidation: true in config to enable)');
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

  console.log(`\n📋 Running dynamic validation in: ${resolvedPath}\n`);

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
        // ✅ TypeScript outputs errors to STDOUT, not stderr!
        const errorOutput = typeCheckResult.stdout || typeCheckResult.stderr;
        result.typeErrors = parseTypeScriptErrors(errorOutput);
        console.error('❌ Type check failed:');
        result.typeErrors.slice(0, 10).forEach(err => console.error(`   ${err}`));
        if (result.typeErrors.length > 10) {
          console.error(`   ... and ${result.typeErrors.length - 10} more errors`);
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
              // ✅ Build tools may output errors to stdout or stderr
              const errorOutput = buildResult.stderr || buildResult.stdout;
              result.buildErrors = parseBuildErrors(errorOutput);
              console.error('❌ Build failed:');
              result.buildErrors.slice(0, 10).forEach(err => console.error(`   ${err}`));
              if (result.buildErrors.length > 10) {
                console.error(`   ... and ${result.buildErrors.length - 10} more errors`);
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
 * Parse build errors and enhance with actionable messages
 */
function parseBuildErrors(stderr: string): string[] {
  const lines = stderr.split('\n');
  const errors: string[] = [];
  
  // Check for missing entry module (common in Vite projects)
  const entryModuleMatch = stderr.match(/Could not resolve entry module ["'](.+?)["']/);
  if (entryModuleMatch) {
    const missingFile = entryModuleMatch[1];
    errors.push(`⚠️ MISSING REQUIRED FILE: ${missingFile}`);
    errors.push('');
    errors.push(`This file does not exist in the project root.`);
    
    // Provide specific guidance for index.html (Vite entry point)
    if (missingFile.includes('index.html')) {
      errors.push('Vite projects REQUIRE index.html as the entry point.');
      errors.push('');
      errors.push('🔧 YOU MUST CREATE THIS FILE with content like:');
      errors.push('```html');
      errors.push('<!DOCTYPE html>');
      errors.push('<html lang="en">');
      errors.push('  <head>');
      errors.push('    <meta charset="UTF-8" />');
      errors.push('    <meta name="viewport" content="width=device-width, initial-scale=1.0" />');
      errors.push('    <title>App</title>');
      errors.push('  </head>');
      errors.push('  <body>');
      errors.push('    <div id="root"></div>');
      errors.push('    <script type="module" src="/src/index.tsx"></script>');
      errors.push('  </body>');
      errors.push('</html>');
      errors.push('```');
    } else {
      errors.push(`🔧 YOU MUST CREATE THIS FILE: ${missingFile}`);
    }
    errors.push('');
    errors.push('⚠️ Do NOT just change the configuration - CREATE THE MISSING FILE!');
    errors.push('');
  }
  
  // Check for other missing module errors
  const moduleNotFoundMatch = stderr.match(/Cannot find module ["'](.+?)["']/);
  if (moduleNotFoundMatch) {
    const missingModule = moduleNotFoundMatch[1];
    errors.push(`⚠️ MISSING MODULE: ${missingModule}`);
    errors.push('');
    errors.push('This could be:');
    errors.push('1. A missing npm package - add it to package.json dependencies');
    errors.push('2. A missing source file - create the file');
    errors.push('3. An incorrect import path - fix the import statement');
    errors.push('');
  }
  
  // Add original error output (filtered)
  const filteredLines = lines
    .filter(line => line.trim().length > 0)
    .filter(line => !line.includes('deprecated')) // Skip deprecation warnings
    .map(line => line.trim());
  
  errors.push(...filteredLines);
  
  return errors;
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
    lines.push('📋 Lint Errors:');
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

