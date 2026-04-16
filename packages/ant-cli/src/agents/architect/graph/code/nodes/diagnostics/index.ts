/**
 * Error Diagnostics System
 * 
 * Centralized error parsing and diagnosis for multi-language, multi-tool projects.
 * Provides structured error analysis with actionable suggestions.
 */

import { GitPort, FileSystemPort } from '../../../../../../core/ports';
import {
  Language,
  BuildTool,
  PackageManager,
  Framework,
  ErrorPattern,
  ErrorContext,
  DiagnosisResult,
  ProjectDetection,
  CompatibilityIssue,
  CompatibilityRule
} from './types';

// Import language-specific patterns
import { TYPESCRIPT_PATTERNS } from './languages/typescript';
import { PYTHON_PATTERNS } from './languages/python';
import { JAVA_PATTERNS } from './languages/java';
import { GO_PATTERNS } from './languages/go';
import { RUST_PATTERNS } from './languages/rust';

// Import build tool patterns
import { VITE_PATTERNS } from './buildTools/vite';
import { WEBPACK_PATTERNS } from './buildTools/webpack';
import { MAVEN_PATTERNS } from './buildTools/maven';

// Import package manager patterns
import { NPM_PATTERNS } from './packageManagers/npm';
import { PNPM_PATTERNS } from './packageManagers/pnpm';
import { YARN_PATTERNS } from './packageManagers/yarn';
import { PIP_PATTERNS } from './packageManagers/pip';
import { CARGO_PATTERNS as CARGO_PM_PATTERNS } from './packageManagers/cargo';

// Import database/ORM patterns
import { PRISMA_PATTERNS } from './databases/prisma';
import { TYPEORM_PATTERNS } from './databases/typeorm';

// Import testing framework patterns
import { JEST_PATTERNS } from './testing/jest';
import { PYTEST_PATTERNS } from './testing/pytest';
import { TEST_ENVIRONMENT_PATTERNS } from './testing/testEnvironment';

// Import linter patterns
import { ESLINT_PATTERNS } from './linters/eslint';

// Import framework-specific patterns, compatibility rules, and build configs
import { NEXTJS_PATTERNS, NEXTJS_COMPATIBILITY_RULES, NEXTJS_BUILD_CONFIG, getNextjsBuildConfig, detectNextjsMode } from './frameworks/nextjs';

/**
 * 언어별 패턴 맵
 */
const LANGUAGE_PATTERNS: Record<Language, ErrorPattern[]> = {
  [Language.TYPESCRIPT]: TYPESCRIPT_PATTERNS,
  [Language.JAVASCRIPT]: TYPESCRIPT_PATTERNS.filter(p => p.layer !== 'code'), // JS는 타입 체크 제외
  [Language.PYTHON]: PYTHON_PATTERNS,
  [Language.JAVA]: JAVA_PATTERNS,
  [Language.GO]: GO_PATTERNS,
  [Language.RUST]: RUST_PATTERNS,
  [Language.UNKNOWN]: []
};

/**
 * 빌드 도구별 패턴 맵
 */
const BUILD_TOOL_PATTERNS: Record<BuildTool, ErrorPattern[]> = {
  [BuildTool.VITE]: VITE_PATTERNS,
  [BuildTool.WEBPACK]: WEBPACK_PATTERNS,
  [BuildTool.ROLLUP]: [],
  [BuildTool.MAVEN]: MAVEN_PATTERNS,
  [BuildTool.GRADLE]: [],
  [BuildTool.CARGO]: [],
  [BuildTool.NONE]: []
};

/**
 * 패키지 매니저별 패턴 맵
 */
const PACKAGE_MANAGER_PATTERNS: Record<PackageManager, ErrorPattern[]> = {
  [PackageManager.NPM]: NPM_PATTERNS,
  [PackageManager.PNPM]: PNPM_PATTERNS,
  [PackageManager.YARN]: YARN_PATTERNS,
  [PackageManager.PIP]: PIP_PATTERNS,
  [PackageManager.MAVEN]: [],
  [PackageManager.CARGO]: CARGO_PM_PATTERNS,
  [PackageManager.UNKNOWN]: []
};

/**
 * 프레임워크별 패턴 맵
 */
const FRAMEWORK_PATTERNS: Record<Framework, ErrorPattern[]> = {
  [Framework.NEXTJS]: NEXTJS_PATTERNS,
  [Framework.NUXT]: [],
  [Framework.ANGULAR]: [],
  [Framework.SVELTE]: [],
  [Framework.DJANGO]: [],
  [Framework.FLASK]: [],
  [Framework.FASTAPI]: [],
  [Framework.SPRING]: [],
  [Framework.EXPRESS]: [],
  [Framework.NESTJS]: [],
  [Framework.NONE]: []
};

/**
 * 프레임워크별 호환성 규칙
 */
const FRAMEWORK_COMPATIBILITY_RULES: Record<Framework, CompatibilityRule[]> = {
  [Framework.NEXTJS]: NEXTJS_COMPATIBILITY_RULES,
  [Framework.NUXT]: [],
  [Framework.ANGULAR]: [],
  [Framework.SVELTE]: [],
  [Framework.DJANGO]: [],
  [Framework.FLASK]: [],
  [Framework.FASTAPI]: [],
  [Framework.SPRING]: [],
  [Framework.EXPRESS]: [],
  [Framework.NESTJS]: [],
  [Framework.NONE]: []
};

/**
 * 크로스 도메인 패턴 (언어/도구 무관)
 * - 데이터베이스/ORM
 * - 테스팅 프레임워크
 * - 린터
 */
const CROSS_DOMAIN_PATTERNS: ErrorPattern[] = [
  ...PRISMA_PATTERNS,
  ...TYPEORM_PATTERNS,
  ...TEST_ENVIRONMENT_PATTERNS,
  ...JEST_PATTERNS,
  ...PYTEST_PATTERNS,
  ...ESLINT_PATTERNS
];

/**
 * 프로젝트 타입 감지
 */
export async function detectProject(
  projectPath: string,
  gitPort: GitPort,
  fileSystem: FileSystemPort  // ✅ Use proper import
): Promise<ProjectDetection> {
  // ✅ Compute relative prefix from fileSystem root to actual project directory
  // fileSystem root = feature path (e.g., .../skeleton)
  // projectPath = codebase path (e.g., .../skeleton/codebase)
  // prefix = 'codebase' → fileSystem.fileExists('codebase/go.mod')
  const p = await import("path");
  const fsRoot = fileSystem.getRootPath();
  const prefix = p.relative(fsRoot, projectPath);
  
  // Helpers: resolve file paths relative to projectPath within fileSystem scope
  const exists = (filePath: string) => 
    fileSystem.fileExists(prefix ? p.join(prefix, filePath) : filePath);
  const read = (filePath: string) => 
    fileSystem.readFile(prefix ? p.join(prefix, filePath) : filePath);

  let packageManager = PackageManager.UNKNOWN;

  // Check Node.js/TypeScript
  const hasPackageJson = await exists('package.json');
  if (hasPackageJson) {
    const content = await read('package.json');
    if (content) {
      try {
        const pkg = JSON.parse(content);

        // Detect package manager
        if (await exists('pnpm-lock.yaml')) {
          packageManager = PackageManager.PNPM;
        } else if (await exists('yarn.lock')) {
          packageManager = PackageManager.YARN;
        } else if (await exists('package-lock.json')) {
          packageManager = PackageManager.NPM;
        } else {
          packageManager = PackageManager.NPM; // Default for Node projects
        }

        // Detect build tool
        let buildTool = BuildTool.NONE;
        if (pkg.devDependencies?.vite || pkg.dependencies?.vite) {
          buildTool = BuildTool.VITE;
        } else if (pkg.devDependencies?.webpack || pkg.dependencies?.webpack) {
          buildTool = BuildTool.WEBPACK;
        } else if (pkg.devDependencies?.rollup || pkg.dependencies?.rollup) {
          buildTool = BuildTool.ROLLUP;
        }

        // Detect TypeScript
        const hasTypeScript = !!(
          pkg.devDependencies?.typescript ||
          (await exists('tsconfig.json'))
        );

        // Detect React
        const hasReact = !!pkg.dependencies?.react;

        // Detect Framework (platform-neutral)
        let framework = Framework.NONE;
        if (pkg.dependencies?.next || pkg.devDependencies?.next) {
          framework = Framework.NEXTJS;
        } else if (pkg.dependencies?.nuxt || pkg.devDependencies?.nuxt) {
          framework = Framework.NUXT;
        } else if (pkg.dependencies?.['@angular/core']) {
          framework = Framework.ANGULAR;
        } else if (pkg.dependencies?.svelte || pkg.devDependencies?.svelte) {
          framework = Framework.SVELTE;
        } else if (pkg.dependencies?.['@nestjs/core']) {
          framework = Framework.NESTJS;
        } else if (pkg.dependencies?.express) {
          framework = Framework.EXPRESS;
        }

        return {
          language: hasTypeScript ? Language.TYPESCRIPT : Language.JAVASCRIPT,
          buildTool,
          packageManager,
          framework,
          hasTypeScript,
          hasReact
        };
      } catch (e) {
        // Invalid package.json
      }
    }
  }

  // Check Python
  if (
    (await exists('requirements.txt')) ||
    (await exists('pyproject.toml')) ||
    (await exists('setup.py'))
  ) {
    // Detect Python frameworks
    let framework = Framework.NONE;
    try {
      const requirements = await read('requirements.txt');
      if (requirements) {
        if (requirements.includes('django')) framework = Framework.DJANGO;
        else if (requirements.includes('flask')) framework = Framework.FLASK;
        else if (requirements.includes('fastapi')) framework = Framework.FASTAPI;
      }
    } catch { /* ignore */ }
    
    return {
      language: Language.PYTHON,
      buildTool: BuildTool.NONE,
      packageManager: PackageManager.PIP,
      framework,
      hasTypeScript: false,
      hasReact: false
    };
  }

  // Check Java
  if (await exists('pom.xml')) {
    // Could detect Spring here by parsing pom.xml
    return {
      language: Language.JAVA,
      buildTool: BuildTool.MAVEN,
      packageManager: PackageManager.MAVEN,
      framework: Framework.NONE, // TODO: detect Spring
      hasTypeScript: false,
      hasReact: false
    };
  }

  if (
    (await exists('build.gradle')) ||
    (await exists('build.gradle.kts'))
  ) {
    return {
      language: Language.JAVA,
      buildTool: BuildTool.GRADLE,
      packageManager: PackageManager.UNKNOWN,
      framework: Framework.NONE, // TODO: detect Spring
      hasTypeScript: false,
      hasReact: false
    };
  }

  // Check Go (workspace or single module)
  if ((await exists('go.work')) || (await exists('go.mod'))) {
    return {
      language: Language.GO,
      buildTool: BuildTool.NONE,
      packageManager: PackageManager.UNKNOWN,
      framework: Framework.NONE,
      hasTypeScript: false,
      hasReact: false
    };
  }

  // Check Rust
  if (await exists('Cargo.toml')) {
    return {
      language: Language.RUST,
      buildTool: BuildTool.CARGO,
      packageManager: PackageManager.CARGO,
      framework: Framework.NONE,
      hasTypeScript: false,
      hasReact: false
    };
  }

  return {
    language: Language.UNKNOWN,
    buildTool: BuildTool.NONE,
    packageManager: PackageManager.UNKNOWN,
    framework: Framework.NONE,
    hasTypeScript: false,
    hasReact: false
  };
}

/**
 * Main diagnosis function
 * Analyzes error output and returns structured diagnosis
 */
export function diagnoseError(
  errorOutput: string,
  context: ErrorContext
): DiagnosisResult | null {
  // Combine all patterns based on detected project
  const allPatterns: ErrorPattern[] = [
    // Framework-specific patterns (highest priority - most specific)
    ...(FRAMEWORK_PATTERNS[context.projectDetection?.framework || Framework.NONE] || []),

    // Language patterns
    ...(LANGUAGE_PATTERNS[context.projectDetection?.language || Language.UNKNOWN] || []),

    // Build tool patterns
    ...(BUILD_TOOL_PATTERNS[context.projectDetection?.buildTool || BuildTool.NONE] || []),

    // Package manager patterns
    ...(PACKAGE_MANAGER_PATTERNS[context.projectDetection?.packageManager || PackageManager.UNKNOWN] || []),

    // Cross-domain patterns (databases, testing, linters)
    ...CROSS_DOMAIN_PATTERNS
  ];

  // Try each pattern until one matches
  for (const pattern of allPatterns) {
    for (const regex of pattern.patterns) {
      const match = errorOutput.match(regex);
      if (match) {
        return pattern.diagnosis(match, context);
      }
    }
  }

  return null;
}

/**
 * Pre-error compatibility check
 * Analyzes config files to detect known incompatible settings BEFORE running build/dev
 * 
 * @param framework - Detected framework
 * @param configPath - Path to config file (e.g., next.config.js)
 * @param config - Parsed config object
 * @returns Array of compatibility issues found
 */
export function checkCompatibility(
  framework: Framework,
  configPath: string,
  config: any
): CompatibilityIssue[] {
  const rules = FRAMEWORK_COMPATIBILITY_RULES[framework] || [];
  const issues: CompatibilityIssue[] = [];
  
  for (const rule of rules) {
    const issue = rule.check(config, configPath);
    if (issue) {
      issues.push(issue);
    }
  }
  
  return issues;
}

/**
 * Get all compatibility rules for a framework
 * Useful for documentation or tooling
 */
export function getCompatibilityRules(framework: Framework): CompatibilityRule[] {
  return FRAMEWORK_COMPATIBILITY_RULES[framework] || [];
}

/**
 * Export types and patterns for external use
 */
export * from './types';
export { TYPESCRIPT_PATTERNS } from './languages/typescript';
export { VITE_PATTERNS } from './buildTools/vite';
export { NPM_PATTERNS } from './packageManagers/npm';
export { PRISMA_PATTERNS } from './databases/prisma';
export { JEST_PATTERNS } from './testing/jest';
export { TEST_ENVIRONMENT_PATTERNS } from './testing/testEnvironment';
export { ESLINT_PATTERNS } from './linters/eslint';

// Framework-specific exports
export { NEXTJS_PATTERNS, NEXTJS_COMPATIBILITY_RULES, NEXTJS_BUILD_CONFIG, getNextjsBuildConfig, detectNextjsMode } from './frameworks/nextjs';
