/**
 * Simple Code Metrics Utilities
 * 
 * Provides basic static analysis without external dependencies.
 * No need for ESLint, VM execution, or complex tooling.
 */

export interface CodeMetrics {
  linesOfCode: number;
  logicalLines: number;
  complexity: number;
  maintainabilityIndex: number;
  commentDensity: number;
}

export interface FileMetrics {
  path: string;
  metrics: CodeMetrics;
}

export interface AggregateMetrics {
  totalFiles: number;
  totalLines: number;
  avgComplexity: number;
  avgMaintainability: number;
  fileMetrics: FileMetrics[];
}

/**
 * Analyze code and calculate metrics
 */
export function analyzeCode(code: string): CodeMetrics {
  const lines = code.split('\n');
  const linesOfCode = lines.length;
  const logicalLines = countLogicalLines(lines);
  const complexity = calculateComplexity(code);
  const commentDensity = calculateCommentDensity(lines);
  const maintainabilityIndex = calculateMaintainabilityIndex(
    logicalLines,
    complexity,
    commentDensity
  );

  return {
    linesOfCode,
    logicalLines,
    complexity,
    maintainabilityIndex,
    commentDensity,
  };
}

/**
 * Count logical lines (non-empty, non-comment)
 */
function countLogicalLines(lines: string[]): number {
  let count = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Handle block comments
    if (trimmed.startsWith('/*')) inBlockComment = true;
    if (trimmed.includes('*/')) {
      inBlockComment = false;
      continue;
    }
    if (inBlockComment) continue;
    
    // Skip single-line comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    
    count++;
  }

  return count;
}

/**
 * Calculate cyclomatic complexity
 * Counts decision points: if, for, while, case, &&, ||, ?, catch
 */
function calculateComplexity(code: string): number {
  let complexity = 1; // Base complexity

  // Count control flow keywords
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\bswitch\b/g,
    /&&/g,
    /\|\|/g,
    /\?(?!\?)/g,  // ? but not ??
  ];

  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

/**
 * Calculate comment density (percentage)
 */
function calculateCommentDensity(lines: string[]): number {
  let totalLines = 0;
  let commentLines = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    totalLines++;
    
    if (trimmed.startsWith('/*')) inBlockComment = true;
    
    if (inBlockComment || 
        trimmed.startsWith('//') || 
        trimmed.startsWith('#') ||
        trimmed.startsWith('*')) {
      commentLines++;
    }
    
    if (trimmed.includes('*/')) inBlockComment = false;
  }

  return totalLines > 0 ? (commentLines / totalLines) * 100 : 0;
}

/**
 * Calculate Maintainability Index
 * Simplified formula: MI = max(0, 100 * (1 - complexity/50) * (LOC/1000)^0.5 * (1 + comments/100))
 */
function calculateMaintainabilityIndex(
  loc: number,
  complexity: number,
  commentDensity: number
): number {
  if (loc === 0) return 100;

  // Penalties
  const complexityPenalty = Math.min(complexity / 50, 1); // 0-1
  const sizeFactor = Math.pow(Math.min(loc / 1000, 1), 0.5); // 0-1
  const commentBonus = Math.min(commentDensity / 100, 0.2); // 0-0.2

  // Calculate MI (0-100)
  const mi = 100 * (1 - complexityPenalty * 0.7) * sizeFactor * (1 + commentBonus);

  return Math.max(0, Math.min(100, Math.round(mi * 10) / 10));
}

/**
 * Analyze multiple files and aggregate metrics
 */
export function analyzeFiles(files: { path: string; content: string }[]): AggregateMetrics {
  const fileMetrics: FileMetrics[] = files.map(file => ({
    path: file.path,
    metrics: analyzeCode(file.content),
  }));

  const totalFiles = files.length;
  const totalLines = fileMetrics.reduce((sum, f) => sum + f.metrics.linesOfCode, 0);
  const avgComplexity = fileMetrics.reduce((sum, f) => sum + f.metrics.complexity, 0) / totalFiles;
  const avgMaintainability = fileMetrics.reduce((sum, f) => sum + f.metrics.maintainabilityIndex, 0) / totalFiles;

  return {
    totalFiles,
    totalLines,
    avgComplexity: Math.round(avgComplexity * 10) / 10,
    avgMaintainability: Math.round(avgMaintainability * 10) / 10,
    fileMetrics,
  };
}

/**
 * Categorize code quality
 */
export function categorizeQuality(mi: number): 'excellent' | 'good' | 'moderate' | 'poor' {
  if (mi >= 85) return 'excellent';
  if (mi >= 70) return 'good';
  if (mi >= 50) return 'moderate';
  return 'poor';
}

/**
 * Generate recommendations based on metrics
 */
export function generateRecommendations(metrics: CodeMetrics): string[] {
  const recommendations: string[] = [];

  // Check maintainability
  if (metrics.maintainabilityIndex < 70) {
    recommendations.push('코드 유지보수성 개선 필요: 함수를 더 작은 단위로 분리하세요');
  }

  // Check complexity
  if (metrics.complexity > 20) {
    recommendations.push('순환 복잡도가 높습니다: 조건문을 단순화하고 중첩을 줄이세요');
  } else if (metrics.complexity > 10) {
    recommendations.push('복잡도가 다소 높습니다: 함수 분리를 고려하세요');
  }

  // Check size
  if (metrics.linesOfCode > 300) {
    recommendations.push('파일이 너무 큽니다: 여러 파일로 분리하는 것을 고려하세요');
  }

  // Check documentation
  if (metrics.commentDensity < 5) {
    recommendations.push('주석이 부족합니다: 복잡한 로직에 설명을 추가하세요');
  } else if (metrics.commentDensity > 40) {
    recommendations.push('주석이 과도합니다: 자명한 코드 작성으로 주석을 최소화하세요');
  }

  if (recommendations.length === 0) {
    recommendations.push('코드 품질이 우수합니다!');
  }

  return recommendations;
}
