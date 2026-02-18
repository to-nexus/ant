/**
 * Project Runtime Abstraction
 * 
 * Centralized registry of language-specific runtime configurations.
 * Maps ProjectDetection results to actionable commands for:
 * - Dependency installation
 * - Type checking, linting, building
 * - Long-running process detection
 * 
 * Consumers (installDeps, runtimeValidate, runCommand) use this module
 * instead of hardcoding language-specific logic.
 * 
 * Adding a new language:
 * 1. Add a new entry to RUNTIME_CONFIGS
 * 2. Implement DependencyConfig and ValidationConfig for the language
 * 3. No changes needed in consumer code
 */

import {
  Language,
  ProjectDetection,
} from './diagnostics/types';
import type { ParserType } from './diagnostics/parsers';

// ─────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────

export interface DependencyConfig {
  /** Primary config file that declares dependencies (e.g. 'package.json', 'go.mod') */
  configFile: string;
  /** Local cache directory that indicates deps are installed (e.g. 'node_modules'), null if language uses global cache */
  localCacheDir: string | null;
  /** Returns the install command string. pm is the detected Node.js package manager (npm/pnpm/yarn) */
  getInstallCommand(pm?: string, opts?: { isSetup?: boolean }): string;
  /** Determines whether dependency installation should run */
  shouldInstall(opts: { configChanged: boolean; cacheDirExists: boolean; isFinalTask: boolean }): boolean;
}

export interface ValidationStep {
  /** Human-readable step name */
  name: string;
  /** Config files whose presence activates this step */
  indicators: string[];
  /** Returns the command to execute. pm is the detected Node.js package manager */
  getCommand(pm?: string): string;
  /** Parser type for structured error extraction */
  parserType?: ParserType;
}

export interface ValidationConfig {
  typeCheck: ValidationStep | null;
  lint: ValidationStep | null;
  build: ValidationStep | null;
}

export interface LongRunningConfig {
  /** Patterns that identify long-running dev server commands */
  patterns: RegExp[];
  /** Patterns that identify interactive commands requiring user input */
  interactivePatterns: RegExp[];
}

export interface ProjectRuntimeConfig {
  language: Language;
  dependency: DependencyConfig;
  validation: ValidationConfig;
  longRunning: LongRunningConfig;
}

// ─────────────────────────────────────────────────────────────
// Node.js / TypeScript Runtime
// ─────────────────────────────────────────────────────────────

const NODE_RUNTIME: ProjectRuntimeConfig = {
  language: Language.TYPESCRIPT,

  dependency: {
    configFile: 'package.json',
    localCacheDir: 'node_modules',
    getInstallCommand(pm?: string): string {
      return `${pm || 'npm'} install`;
    },
    shouldInstall({ configChanged, cacheDirExists, isFinalTask }): boolean {
      if (isFinalTask) return true;
      return configChanged || !cacheDirExists;
    },
  },

  validation: {
    typeCheck: {
      name: 'TypeScript type check',
      indicators: ['tsconfig.json'],
      getCommand(): string {
        return 'npx tsc --noEmit';
      },
      parserType: 'typescript',
    },
    lint: {
      name: 'ESLint',
      indicators: ['.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs'],
      getCommand(): string {
        return 'npx eslint . --ext .ts,.tsx,.js,.jsx';
      },
      parserType: 'eslint',
    },
    build: {
      name: 'Build',
      indicators: ['package.json'],
      getCommand(pm?: string): string {
        return `${pm || 'npm'} run build`;
      },
      parserType: 'vite',  // Vite parser as default for Node.js build errors
    },
  },

  longRunning: {
    patterns: [
      /npm\s+run\s+dev\b/,
      /npm\s+run\s+serve\b/,
      /npm\s+run\s+start\b/,
      /npm\s+run\s+preview\b/,
      /npm\s+start\b/,
      /yarn\s+dev\b/,
      /yarn\s+serve\b/,
      /yarn\s+start\b/,
      /yarn\s+preview\b/,
      /yarn\s+run\s+dev\b/,
      /yarn\s+run\s+serve\b/,
      /yarn\s+run\s+start\b/,
      /yarn\s+run\s+preview\b/,
      /pnpm.*\s+dev\b/,
      /pnpm.*\s+serve\b/,
      /pnpm.*\s+start\b/,
      /pnpm.*\s+preview\b/,
      /node\s+.*server\.(js|ts)\b/,
      /tsx\s+.*server\.(js|ts)\b/,
      /nodemon\b/,
      /npx\s+vite\b/,
      /npx\s+vite\s+preview\b/,
      /npx\s+next\s+dev\b/,
      /npx\s+react-scripts\s+start\b/,
      /vite\s*$/,
      /vite\s+preview\b/,
    ],
    interactivePatterns: [
      /\bnpm\s+init\b(?!\s+(-y|--yes))/i,
      /\byarn\s+init\b(?!\s+(-y|--yes))/i,
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// Go Runtime
// ─────────────────────────────────────────────────────────────

const GO_RUNTIME: ProjectRuntimeConfig = {
  language: Language.GO,

  dependency: {
    configFile: 'go.mod',
    localCacheDir: null,  // Go uses global module cache ($GOPATH/pkg/mod)
    getInstallCommand(_pm?: string, opts?: { isSetup?: boolean }): string {
      if (opts?.isSetup) return 'go mod download';
      return 'go mod tidy';
    },
    shouldInstall({ configChanged, isFinalTask }): boolean {
      // Go modules are downloaded on demand during build/run.
      // Explicit install only needed when go.mod changed or for final verification.
      if (isFinalTask) return true;
      return configChanged;
    },
  },

  validation: {
    typeCheck: {
      name: 'Go vet',
      indicators: ['go.mod'],
      getCommand(): string {
        return 'go vet ./...';
      },
      parserType: 'go',
    },
    lint: null,  // golangci-lint is external; not guaranteed to be installed
    build: {
      name: 'Go build',
      indicators: ['go.mod'],
      getCommand(): string {
        return 'go build ./...';
      },
      parserType: 'go',
    },
  },

  longRunning: {
    patterns: [
      /go\s+run\s+/,                // go run main.go, go run ./cmd/server
      /\bair\b/,                     // air (Go hot-reload dev server)
      /make\s+(run|serve|dev)\b/,   // make run, make serve, make dev
    ],
    interactivePatterns: [],  // Go toolchain has no interactive init commands
  },
};

// ─────────────────────────────────────────────────────────────
// Fallback Runtime (unknown/unsupported languages)
// ─────────────────────────────────────────────────────────────

const FALLBACK_RUNTIME: ProjectRuntimeConfig = {
  language: Language.UNKNOWN,

  dependency: {
    configFile: '',
    localCacheDir: null,
    getInstallCommand(): string {
      return '';
    },
    shouldInstall(): boolean {
      return false;
    },
  },

  validation: {
    typeCheck: null,
    lint: null,
    build: null,
  },

  longRunning: {
    patterns: [],
    interactivePatterns: [],
  },
};

// ─────────────────────────────────────────────────────────────
// Registry & Factory
// ─────────────────────────────────────────────────────────────

/**
 * Language → Runtime config mapping.
 * JavaScript reuses Node runtime (same toolchain).
 */
const RUNTIME_REGISTRY: Partial<Record<Language, ProjectRuntimeConfig>> = {
  [Language.TYPESCRIPT]: NODE_RUNTIME,
  [Language.JAVASCRIPT]: NODE_RUNTIME,
  [Language.GO]: GO_RUNTIME,
};

/**
 * Get the runtime configuration for a detected project.
 * Returns language-specific config or a safe fallback for unsupported languages.
 */
export function getProjectRuntime(detection: ProjectDetection): ProjectRuntimeConfig {
  return RUNTIME_REGISTRY[detection.language] || FALLBACK_RUNTIME;
}

/**
 * Get all long-running patterns across all registered runtimes.
 * Used by constants.ts to build the unified LONG_RUNNING_PATTERNS array.
 */
export function getAllLongRunningPatterns(): RegExp[] {
  const patterns: RegExp[] = [];
  for (const runtime of Object.values(RUNTIME_REGISTRY)) {
    if (runtime) {
      patterns.push(...runtime.longRunning.patterns);
    }
  }
  return patterns;
}

/**
 * Get all interactive command patterns across all registered runtimes.
 */
export function getAllInteractivePatterns(): RegExp[] {
  const patterns: RegExp[] = [];
  for (const runtime of Object.values(RUNTIME_REGISTRY)) {
    if (runtime) {
      patterns.push(...runtime.longRunning.interactivePatterns);
    }
  }
  return patterns;
}

/**
 * Check if a language is supported by the runtime system.
 */
export function isLanguageSupported(language: Language): boolean {
  return language in RUNTIME_REGISTRY;
}
