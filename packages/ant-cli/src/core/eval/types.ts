/**
 * Core Eval Types
 * 
 * Domain types for evaluation system.
 * These are independent of any specific implementation.
 */

/**
 * Benchmark suite identifier
 */
export type BenchmarkSuite = 
  | 'humaneval'        // OpenAI HumanEval
  | 'mbpp'             // Google MBPP
  | 'evalplus'         // EvalPlus (HumanEval extended)
  | 'swe-bench'        // SWE-Bench (GitHub issues)
  | 'refactory-bench'  // RefactoryBench
  | 'custom';          // Custom dataset

/**
 * Task category
 */
export type TaskCategory = 
  | 'codegen'          // Code generation from scratch
  | 'refactor'         // Code refactoring
  | 'bugfix'           // Bug fixing
  | 'completion'       // Code completion
  | 'explanation';     // Code explanation

/**
 * Programming language
 */
export type ProgrammingLanguage = 
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'java'
  | 'rust'
  | 'cpp'
  | 'other';

/**
 * Difficulty level
 */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/**
 * Evaluation status
 */
export type EvalStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout';

/**
 * Quality dimension
 * Different aspects of code quality to measure
 */
export interface QualityDimension {
  name: string;
  weight: number;      // Weight in overall score (0-1)
  threshold?: number;  // Minimum acceptable value
}

/**
 * Standard quality dimensions
 */
export const QUALITY_DIMENSIONS: Record<string, QualityDimension> = {
  functionality: { name: 'Functionality', weight: 0.4 },
  maintainability: { name: 'Maintainability', weight: 0.25 },
  complexity: { name: 'Complexity', weight: 0.15 },
  reliability: { name: 'Reliability', weight: 0.1 },
  documentation: { name: 'Documentation', weight: 0.1 },
};

/**
 * Metric thresholds
 * Industry standard thresholds for code quality metrics
 */
export const METRIC_THRESHOLDS = {
  // Maintainability Index (0-100, higher is better)
  maintainabilityIndex: {
    excellent: 85,
    good: 65,
    moderate: 20,
    poor: 0,
  },
  
  // Cyclomatic Complexity (lower is better)
  cyclomaticComplexity: {
    simple: 1,      // 1-10: simple
    moderate: 11,   // 11-20: moderate
    complex: 21,    // 21-50: complex
    untestable: 51, // 51+: very complex
  },
  
  // Lines of Code per function (lower is better)
  linesPerFunction: {
    optimal: 20,
    acceptable: 50,
    excessive: 100,
  },
  
  // Test coverage (higher is better)
  testCoverage: {
    excellent: 90,
    good: 80,
    acceptable: 70,
    poor: 50,
  },
};

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  suite: BenchmarkSuite;
  category: TaskCategory;
  language: ProgrammingLanguage;
  maxAttempts: number;       // For pass@k calculation
  timeout: number;           // Per task timeout in ms
  includeQualityMetrics: boolean;
  parallelTasks: number;
}

/**
 * Default benchmark configurations
 */
export const DEFAULT_BENCHMARK_CONFIGS: Record<BenchmarkSuite, Partial<BenchmarkConfig>> = {
  'humaneval': {
    suite: 'humaneval',
    category: 'codegen',
    language: 'python',
    maxAttempts: 10,
    timeout: 30000,
    includeQualityMetrics: true,
    parallelTasks: 4,
  },
  'mbpp': {
    suite: 'mbpp',
    category: 'codegen',
    language: 'python',
    maxAttempts: 3,
    timeout: 20000,
    includeQualityMetrics: false,
    parallelTasks: 8,
  },
  'evalplus': {
    suite: 'evalplus',
    category: 'codegen',
    language: 'python',
    maxAttempts: 10,
    timeout: 30000,
    includeQualityMetrics: true,
    parallelTasks: 4,
  },
  'swe-bench': {
    suite: 'swe-bench',
    category: 'bugfix',
    language: 'python',
    maxAttempts: 5,
    timeout: 60000,
    includeQualityMetrics: true,
    parallelTasks: 2,
  },
  'refactory-bench': {
    suite: 'refactory-bench',
    category: 'refactor',
    language: 'python',
    maxAttempts: 3,
    timeout: 40000,
    includeQualityMetrics: true,
    parallelTasks: 4,
  },
  'custom': {
    suite: 'custom',
    category: 'codegen',
    language: 'typescript',
    maxAttempts: 3,
    timeout: 30000,
    includeQualityMetrics: true,
    parallelTasks: 4,
  },
};

