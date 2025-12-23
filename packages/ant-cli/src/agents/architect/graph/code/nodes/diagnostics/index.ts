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
  ErrorPattern,
  ErrorContext,
  DiagnosisResult,
  ProjectDetection
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

// Import linter patterns
import { ESLINT_PATTERNS } from './linters/eslint';

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
 * 크로스 도메인 패턴 (언어/도구 무관)
 * - 데이터베이스/ORM
 * - 테스팅 프레임워크
 * - 린터
 */
const CROSS_DOMAIN_PATTERNS: ErrorPattern[] = [
  ...PRISMA_PATTERNS,
  ...TYPEORM_PATTERNS,
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
  let packageManager = PackageManager.UNKNOWN;

  // Check Node.js/TypeScript
  const hasPackageJson = await fileSystem.fileExists('package.json');
  if (hasPackageJson) {
    const content = await fileSystem.readFile('package.json');
    if (content) {
      try {
        const pkg = JSON.parse(content);

        // Detect package manager
        if (await fileSystem.fileExists('pnpm-lock.yaml')) {
          packageManager = PackageManager.PNPM;
        } else if (await fileSystem.fileExists('yarn.lock')) {
          packageManager = PackageManager.YARN;
        } else if (await fileSystem.fileExists('package-lock.json')) {
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
          (await fileSystem.fileExists('tsconfig.json'))
        );

        // Detect React
        const hasReact = !!pkg.dependencies?.react;

        return {
          language: hasTypeScript ? Language.TYPESCRIPT : Language.JAVASCRIPT,
          buildTool,
          packageManager,
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
    (await fileSystem.fileExists('requirements.txt')) ||
    (await fileSystem.fileExists('pyproject.toml')) ||
    (await fileSystem.fileExists('setup.py'))
  ) {
    return {
      language: Language.PYTHON,
      buildTool: BuildTool.NONE,
      packageManager: PackageManager.PIP,
      hasTypeScript: false,
      hasReact: false
    };
  }

  // Check Java
  if (await fileSystem.fileExists('pom.xml')) {
    return {
      language: Language.JAVA,
      buildTool: BuildTool.MAVEN,
      packageManager: PackageManager.MAVEN,
      hasTypeScript: false,
      hasReact: false
    };
  }

  if (
    (await fileSystem.fileExists('build.gradle')) ||
    (await fileSystem.fileExists('build.gradle.kts'))
  ) {
    return {
      language: Language.JAVA,
      buildTool: BuildTool.GRADLE,
      packageManager: PackageManager.UNKNOWN,
      hasTypeScript: false,
      hasReact: false
    };
  }

  // Check Go
  if (await fileSystem.fileExists('go.mod')) {
    return {
      language: Language.GO,
      buildTool: BuildTool.NONE,
      packageManager: PackageManager.UNKNOWN,
      hasTypeScript: false,
      hasReact: false
    };
  }

  // Check Rust
  if (await fileSystem.fileExists('Cargo.toml')) {
    return {
      language: Language.RUST,
      buildTool: BuildTool.CARGO,
      packageManager: PackageManager.CARGO,
      hasTypeScript: false,
      hasReact: false
    };
  }

  return {
    language: Language.UNKNOWN,
    buildTool: BuildTool.NONE,
    packageManager: PackageManager.UNKNOWN,
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
 * Export types and patterns for external use
 */
export * from './types';
export { TYPESCRIPT_PATTERNS } from './languages/typescript';
export { VITE_PATTERNS } from './buildTools/vite';
export { NPM_PATTERNS } from './packageManagers/npm';
export { PRISMA_PATTERNS } from './databases/prisma';
export { JEST_PATTERNS } from './testing/jest';
export { ESLINT_PATTERNS } from './linters/eslint';
