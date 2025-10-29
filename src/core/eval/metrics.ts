/**
 * Core Eval Metrics
 * 
 * Metric calculation utilities (pure functions).
 * These implement industry-standard code quality metrics.
 */

import { QualityMetrics, QualityMetricsDelta, TestResult } from '../ports/eval';
import { METRIC_THRESHOLDS } from './types';

/**
 * Calculate pass@k metric
 * 
 * pass@k = probability that at least one of k generated samples passes tests
 * 
 * Formula: pass@k = 1 - (C(n-c, k) / C(n, k))
 * where n = total samples, c = correct samples
 * 
 * @param results Array of test results from multiple attempts
 * @param k Number of attempts to consider
 * @returns pass@k score (0-1)
 */
export function calculatePassAtK(results: TestResult[], k: number): number {
  if (results.length === 0 || k <= 0) return 0;
  
  const n = results.length;
  const c = results.filter(r => r.passed).length;
  
  // If k >= n, simply return the pass rate
  if (k >= n) {
    return c / n;
  }
  
  // Calculate using combination formula
  // pass@k = 1 - C(n-c, k) / C(n, k)
  const numerator = combination(n - c, k);
  const denominator = combination(n, k);
  
  if (denominator === 0) return 0;
  
  return 1 - (numerator / denominator);
}

/**
 * Calculate combination C(n, k) = n! / (k! * (n-k)!)
 */
function combination(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  
  // Optimize by using smaller k
  k = Math.min(k, n - k);
  
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  
  return Math.round(result);
}

/**
 * Calculate Maintainability Index (MI)
 * 
 * Microsoft's formula:
 * MI = 171 - 5.2 * ln(Halstead Volume) - 0.23 * (Cyclomatic Complexity) - 16.2 * ln(Lines of Code)
 * 
 * Simplified version:
 * MI = 171 - 5.2 * ln(V) - 0.23 * CC - 16.2 * ln(LOC)
 * 
 * Then normalized to 0-100 scale.
 * 
 * @param loc Lines of code
 * @param complexity Cyclomatic complexity
 * @param halsteadVolume Halstead volume (optional, defaults to LOC estimate)
 * @returns Maintainability Index (0-100, higher is better)
 */
export function calculateMaintainabilityIndex(
  loc: number,
  complexity: number,
  halsteadVolume?: number
): number {
  if (loc <= 0) return 100;
  
  // Use simplified estimate if Halstead volume not provided
  const volume = halsteadVolume || loc * 10;
  
  // Microsoft's formula
  const mi = 171 - 5.2 * Math.log(volume) - 0.23 * complexity - 16.2 * Math.log(loc);
  
  // Normalize to 0-100
  const normalized = Math.max(0, Math.min(100, mi * 100 / 171));
  
  return Math.round(normalized * 100) / 100;
}

/**
 * Calculate overall quality score from metrics
 * 
 * Weighted combination of:
 * - Maintainability Index (40%)
 * - Complexity (30%, inverted)
 * - Lint errors (20%, inverted)
 * - Documentation (10%)
 * 
 * @param metrics Quality metrics
 * @returns Overall score (0-100)
 */
export function calculateQualityScore(metrics: QualityMetrics): number {
  // Maintainability score (0-100, already normalized)
  const maintScore = metrics.maintainabilityIndex;
  
  // Complexity score (invert: lower complexity = higher score)
  const complexityScore = calculateComplexityScore(metrics.cyclomaticComplexity);
  
  // Lint score (fewer errors = higher score)
  const lintScore = calculateLintScore(metrics.lintErrors, metrics.lintWarnings);
  
  // Documentation score
  const docScore = calculateDocScore(metrics.commentDensity || 0);
  
  // Weighted combination
  const totalScore = 
    maintScore * 0.4 +
    complexityScore * 0.3 +
    lintScore * 0.2 +
    docScore * 0.1;
  
  return Math.round(totalScore * 100) / 100;
}

/**
 * Calculate complexity score (0-100)
 * Lower complexity = higher score
 */
function calculateComplexityScore(complexity: number): number {
  const { simple, moderate, complex, untestable } = METRIC_THRESHOLDS.cyclomaticComplexity;
  
  if (complexity <= simple) return 100;
  if (complexity <= moderate) return 80;
  if (complexity <= complex) return 50;
  if (complexity <= untestable) return 20;
  return 0;
}

/**
 * Calculate lint score (0-100)
 * Fewer errors/warnings = higher score
 */
function calculateLintScore(errors: number, warnings: number): number {
  const totalIssues = errors * 2 + warnings; // Errors weigh more
  
  if (totalIssues === 0) return 100;
  if (totalIssues <= 5) return 80;
  if (totalIssues <= 15) return 60;
  if (totalIssues <= 30) return 40;
  if (totalIssues <= 50) return 20;
  return 0;
}

/**
 * Calculate documentation score (0-100)
 * Based on comment density
 */
function calculateDocScore(commentDensity: number): number {
  // Optimal comment density: 10-30%
  if (commentDensity >= 10 && commentDensity <= 30) return 100;
  if (commentDensity >= 5 && commentDensity < 10) return 70;
  if (commentDensity > 30 && commentDensity <= 40) return 70;
  if (commentDensity < 5) return 50;
  if (commentDensity > 40) return 50;
  return 30;
}

/**
 * Compare quality metrics (before vs after)
 * 
 * @param before Metrics before refactoring
 * @param after Metrics after refactoring
 * @returns Delta metrics
 */
export function compareMetrics(
  before: QualityMetrics,
  after: QualityMetrics
): QualityMetricsDelta {
  const complexityDelta = after.cyclomaticComplexity - before.cyclomaticComplexity;
  const maintainabilityDelta = after.maintainabilityIndex - before.maintainabilityIndex;
  const lintErrorsDelta = after.lintErrors - before.lintErrors;
  
  // Calculate improvement score
  const scoreBefore = calculateQualityScore(before);
  const scoreAfter = calculateQualityScore(after);
  const score = scoreAfter - scoreBefore;
  
  // Determine if improved (lower complexity, higher MI, fewer errors)
  const improved = 
    complexityDelta <= 0 &&
    maintainabilityDelta >= 0 &&
    lintErrorsDelta <= 0;
  
  return {
    complexityDelta,
    maintainabilityDelta,
    lintErrorsDelta,
    improved,
    score,
  };
}

/**
 * Calculate aggregate statistics for multiple test results
 */
export function calculateTestStatistics(results: TestResult[]): {
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  avgExecutionTime: number;
} {
  const totalTests = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = totalTests - passed;
  const passRate = totalTests > 0 ? passed / totalTests : 0;
  
  const totalTime = results.reduce((sum, r) => sum + (r.executionTime || 0), 0);
  const avgExecutionTime = totalTests > 0 ? totalTime / totalTests : 0;
  
  return {
    totalTests,
    passed,
    failed,
    passRate,
    avgExecutionTime,
  };
}

/**
 * Categorize code quality based on metrics
 */
export function categorizeQuality(metrics: QualityMetrics): 'excellent' | 'good' | 'moderate' | 'poor' {
  const score = calculateQualityScore(metrics);
  
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'moderate';
  return 'poor';
}

/**
 * Generate quality recommendations based on metrics
 */
export function generateRecommendations(metrics: QualityMetrics): string[] {
  const recommendations: string[] = [];
  
  // Check maintainability
  if (metrics.maintainabilityIndex < METRIC_THRESHOLDS.maintainabilityIndex.good) {
    recommendations.push('코드 유지보수성 개선 필요: 함수를 더 작은 단위로 분리하세요');
  }
  
  // Check complexity
  if (metrics.cyclomaticComplexity > METRIC_THRESHOLDS.cyclomaticComplexity.complex) {
    recommendations.push('순환 복잡도 감소 필요: 조건문을 단순화하고 중첩을 줄이세요');
  }
  
  // Check lint issues
  if (metrics.lintErrors > 0) {
    recommendations.push(`Lint 오류 ${metrics.lintErrors}개 수정 필요`);
  }
  
  if (metrics.lintWarnings > 10) {
    recommendations.push(`Lint 경고 ${metrics.lintWarnings}개 검토 권장`);
  }
  
  // Check documentation
  const commentDensity = metrics.commentDensity || 0;
  if (commentDensity < 5) {
    recommendations.push('주석 및 문서화 추가 필요');
  } else if (commentDensity > 40) {
    recommendations.push('과도한 주석: 자명한 코드 작성으로 주석 최소화 권장');
  }
  
  // Check duplication
  if (metrics.duplicationRatio && metrics.duplicationRatio > 0.05) {
    recommendations.push(`코드 중복률 ${(metrics.duplicationRatio * 100).toFixed(1)}%: 리팩토링 권장`);
  }
  
  if (recommendations.length === 0) {
    recommendations.push('코드 품질이 우수합니다!');
  }
  
  return recommendations;
}

