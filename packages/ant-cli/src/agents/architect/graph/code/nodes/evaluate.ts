/**
 * Evaluate Node
 * 
 * Evaluates generated code quality and creates reports.
 * This is part of the Architect workflow, not a separate agent.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations (not fs directly)
 * - No direct infrastructure dependencies
 */

import * as path from 'path';
import { ArchitectGraphState, Task } from '../state';
import { analyzeFiles, categorizeQuality, generateRecommendations, AggregateMetrics } from '../../../utils/codeMetrics';
import { GitPort } from '../../../../../core/ports';

export interface EvaluationReport {
  timestamp: string;
  filesGenerated: number;
  totalLines: number;
  metrics: AggregateMetrics;
  quality: string;
  recommendations: string[];
  requirements?: RequirementChecklistItem[];
}

export interface RequirementChecklistItem {
  id: string;
  description: string;
  notes?: string;
}

/**
 * Evaluate generated code
 * 
 * This node runs after all tasks are completed to:
 * 1. Run comprehensive runtime validation (Final Verification)
 * 2. If errors found, create Error Tasks dynamically
 * 3. If no errors, analyze code quality and generate report
 */
export async function evaluate(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`🔍 FINAL VERIFICATION & EVALUATION`);
  console.log(`═══════════════════════════════════════════════════\n`);
  
  // ✅ 1. Run comprehensive runtime validation
  console.log(`📋 Running comprehensive validation...\n`);
  
  const validationResult = await runComprehensiveValidation(state);
  
  // ✅ 2. If errors found, create Error Tasks dynamically
  if (validationResult.violations && validationResult.violations.length > 0) {
    console.log(`⚠️  Found ${validationResult.violations.length} error(s) during final verification\n`);
    
    // Prevent infinite loop
    const finalRetryCount = state.finalRetryCount || 0;
    if (finalRetryCount >= 3) {
      console.log(`⚠️  Final Verification failed ${finalRetryCount} times`);
      console.log(`   Stopping to prevent infinite loop - reporting unresolved errors\n`);
      
      // Generate failure report
      const report = await generateFailureReport(state, validationResult.violations);
      return {
        ...state,
        evaluationReport: report,
        shouldEvaluate: false,  // ✅ Reset routing flag
      };
    }
    
    state.finalRetryCount = finalRetryCount + 1;
    console.log(`🔄 Final Verification attempt ${state.finalRetryCount}/3\n`);
    
    // Group errors by type
    const errorGroups = groupViolationsByType(validationResult.violations);
    
    console.log(`📝 Creating ${errorGroups.length} error task(s):\n`);
    
    // Create Error Task for each error group
    errorGroups.forEach((group, idx) => {
      const errorPriority = getErrorPriorityByType(group.type);
      
      const { Task, TASK_PRIORITIES } = require('../state');
      const errorTask = {
        id: `error-final-${group.type}-${Date.now()}-${idx}`,
        name: `Fix ${group.type.replace(/_/g, ' ').toUpperCase()} Errors`,
        type: 'error' as const,
        priority: errorPriority,
        description: formatErrorDescription(group.violations),
        errors: group.violations.map((v: any) => v.message),
        validationRequired: true,
        validationType: 'runtime' as const,
      };
      
      state.taskQueue?.push(errorTask);
      console.log(`   ${idx + 1}. "${errorTask.name}" (P${errorTask.priority}) - ${group.violations.length} error(s)`);
    });
    
    console.log(`\n⏭️  Moving to error resolution phase...\n`);
    
    // Move to next Error Task
    const nextErrorTask = state.taskQueue?.pop();
    
    return {
      ...state,
      currentTask: nextErrorTask,
      retries: 0,
      violations: [],
      enforcementReason: undefined,
      shouldEvaluate: false,  // ✅ CRITICAL: Reset routing flag
    };
  }
  
  // ✅ 3. No errors - generate success report
  console.log(`\n✅ Final Verification PASSED - No errors detected!\n`);
  
  const { modifications, context } = state;
  const project = context.project;

  // Get GitPort for file operations (Hexagonal Architecture)
  const gitPort = state.gitPort || state.deps?.git;
  if (!gitPort) {
    console.warn('⚠️  GitPort not available, skipping evaluation');
    return {
      ...state,
      shouldEvaluate: false,  // ✅ Reset routing flag
    };
  }

  console.log('🔬 Evaluating generated code...\n');

  try {
    // Collect generated files from state (not from disk)
    const generatedFiles = state.files.map(f => ({
      path: f.path,
      content: f.content
    }));
    
    if (generatedFiles.length === 0) {
      console.log('⚠️  No files to evaluate');
      return {
        ...state,
        shouldEvaluate: false,  // ✅ Reset routing flag
      };
    }

    // Analyze code metrics
    const metrics = analyzeFiles(generatedFiles);
    
    // Load requirements (if available)
    const requirements = await loadRequirements(project, gitPort);

    // Generate recommendations
    const allRecommendations = new Set<string>();
    for (const fileMetric of metrics.fileMetrics) {
      const recs = generateRecommendations(fileMetric.metrics);
      recs.forEach(r => allRecommendations.add(r));
    }

    // Create report
    const report: EvaluationReport = {
      timestamp: new Date().toISOString(),
      filesGenerated: metrics.totalFiles,
      totalLines: metrics.totalLines,
      metrics,
      quality: categorizeQuality(metrics.avgMaintainability),
      recommendations: Array.from(allRecommendations),
      requirements,
    };

    // Save report
    const reportPath = await saveReport(project, report, gitPort);
    console.log(`📄 Evaluation report saved: ${reportPath}`);

    // Print summary
    printSummary(report);

    // Check quality thresholds
    await checkQualityThresholds(project, report, gitPort);

    return {
      ...state,
      evaluationReport: report,
      shouldEvaluate: false,  // ✅ Reset routing flag
    };
  } catch (error: any) {
    console.error('⚠️  Evaluation failed:', error.message);
    return {
      ...state,
      shouldEvaluate: false,  // ✅ Reset routing flag
    };
  }
}

// Removed: collectGeneratedFiles() function
// Files are now read directly from state.files instead of outputs/code/

/**
 * Load requirements checklist from eval directive
 */
async function loadRequirements(project: string, gitPort: GitPort): Promise<RequirementChecklistItem[] | undefined> {
  try {
    const testsPath = path.join('workspace', project, 'inputs/directives/eval/tests.json');

    const exists = await gitPort.fileExists(testsPath);
    if (!exists) {
      return undefined;
    }

    const content = await gitPort.readFile(testsPath);
    if (!content) {
      return undefined;
    }

    const tests = JSON.parse(content);
    
    // Convert test tasks to requirement checklist
    return tests.tasks?.map((task: any) => ({
      id: task.id,
      description: task.description,
      notes: 'Manual verification required',
    }));
  } catch (error) {
    return undefined;
  }
}

/**
 * Save evaluation report
 */
async function saveReport(project: string, report: EvaluationReport, gitPort: GitPort): Promise<string> {
  const outputDir = path.join('workspace', project, 'outputs/eval');
  
  // Create directory if needed
  await gitPort.createDirectory(outputDir);

  // Save JSON report
  const jsonPath = path.join(outputDir, 'report.json');
  await gitPort.writeFile(jsonPath, JSON.stringify(report, null, 2));

  // Save Markdown report
  const mdPath = path.join(outputDir, 'report.md');
  const markdown = generateMarkdownReport(report);
  await gitPort.writeFile(mdPath, markdown);

  return mdPath;
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport(report: EvaluationReport): string {
  const lines: string[] = [];

  lines.push('# Code Evaluation Report\n');
  lines.push(`**Generated**: ${new Date(report.timestamp).toLocaleString()}\n`);
  
  lines.push('## Summary\n');
  lines.push(`- **Files Generated**: ${report.filesGenerated}`);
  lines.push(`- **Total Lines**: ${report.totalLines}`);
  lines.push(`- **Avg Complexity**: ${report.metrics.avgComplexity}`);
  lines.push(`- **Avg Maintainability**: ${report.metrics.avgMaintainability}/100`);
  lines.push(`- **Quality**: ${report.quality}\n`);

  if (report.recommendations.length > 0) {
    lines.push('## Recommendations\n');
    for (const rec of report.recommendations) {
      const icon = rec.includes('우수') ? '✅' : '💡';
      lines.push(`${icon} ${rec}`);
    }
    lines.push('');
  }

  if (report.requirements && report.requirements.length > 0) {
    lines.push('## Requirements Checklist\n');
    lines.push('Please verify these requirements manually:\n');
    for (const req of report.requirements) {
      lines.push(`- [ ] **${req.id}**: ${req.description}`);
      if (req.notes) {
        lines.push(`  - *${req.notes}*`);
      }
    }
    lines.push('');
  }

  lines.push('## File Details\n');
  for (const file of report.metrics.fileMetrics) {
    lines.push(`### ${file.path}\n`);
    lines.push(`- Lines: ${file.metrics.linesOfCode} (${file.metrics.logicalLines} logical)`);
    lines.push(`- Complexity: ${file.metrics.complexity}`);
    lines.push(`- Maintainability: ${file.metrics.maintainabilityIndex}/100`);
    lines.push(`- Comment Density: ${file.metrics.commentDensity.toFixed(1)}%\n`);
  }

  return lines.join('\n');
}

/**
 * Print summary to console
 */
function printSummary(report: EvaluationReport): void {
  console.log('═'.repeat(60));
  console.log('📊 EVALUATION SUMMARY');
  console.log('═'.repeat(60));
  
  console.log(`\n📈 Code Metrics:`);
  console.log(`   Files:           ${report.filesGenerated}`);
  console.log(`   Total Lines:     ${report.totalLines}`);
  console.log(`   Complexity:      ${report.metrics.avgComplexity}`);
  console.log(`   Maintainability: ${report.metrics.avgMaintainability}/100`);
  console.log(`   Quality:         ${report.quality.toUpperCase()}`);

  if (report.recommendations.length > 0) {
    console.log(`\n💡 Recommendations:`);
    for (const rec of report.recommendations) {
      const icon = rec.includes('우수') ? '   ✅' : '   💡';
      console.log(`${icon} ${rec}`);
    }
  }

  if (report.requirements && report.requirements.length > 0) {
    console.log(`\n📋 Requirements (${report.requirements.length} items):`);
    console.log(`   Please verify manually in the report`);
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

/**
 * Check quality thresholds
 */
async function checkQualityThresholds(project: string, report: EvaluationReport, gitPort: GitPort): Promise<void> {
  try {
    const thresholdsPath = path.join('workspace', project, 'inputs/directives/eval/quality-thresholds.json');

    const exists = await gitPort.fileExists(thresholdsPath);
    if (!exists) {
      return; // No thresholds defined
    }

    const content = await gitPort.readFile(thresholdsPath);
    if (!content) {
      return;
    }

    const thresholds = JSON.parse(content);

    console.log('🎯 Checking quality thresholds...\n');

    const failures: string[] = [];

    // Check maintainability
    if (thresholds.minMaintainabilityIndex && 
        report.metrics.avgMaintainability < thresholds.minMaintainabilityIndex) {
      failures.push(
        `Maintainability too low: ${report.metrics.avgMaintainability} ` +
        `(minimum: ${thresholds.minMaintainabilityIndex})`
      );
    }

    // Check complexity
    if (thresholds.maxComplexity && 
        report.metrics.avgComplexity > thresholds.maxComplexity) {
      failures.push(
        `Complexity too high: ${report.metrics.avgComplexity} ` +
        `(maximum: ${thresholds.maxComplexity})`
      );
    }

    if (failures.length > 0) {
      console.log('⚠️  Quality thresholds not met:');
      for (const failure of failures) {
        console.log(`   ❌ ${failure}`);
      }

      if (thresholds.enforceOnFail) {
        console.error('\n❌ Build failed due to quality threshold violations');
        process.exit(1);
      }
    } else {
      console.log('   ✅ All quality thresholds met!\n');
    }
  } catch (error) {
    // Ignore errors in threshold checking
  }
}

/**
 * Run comprehensive runtime validation
 */
async function runComprehensiveValidation(state: ArchitectGraphState) {
  // Force runtime validation
  const tempState: ArchitectGraphState = {
    ...state,
    currentTask: {
      id: state.currentTask?.id || 'final-verification',
      name: state.currentTask?.name || 'Final Verification',
      type: state.currentTask?.type || 'feature',
      priority: state.currentTask?.priority || 1000,
      description: state.currentTask?.description || 'Final comprehensive validation',
      validationType: 'runtime',
      validationRequired: true,
    } as Task,
  };
  
  // Import and run runtimeValidate
  const { runtimeValidate } = await import('./runtimeValidate');
  const result = await runtimeValidate(tempState);
  
  return {
    violations: result.violations || [],
  };
}

/**
 * Group violations by type
 */
function groupViolationsByType(violations: any[]): Array<{type: string, violations: any[]}> {
  const groups = new Map<string, any[]>();
  
  violations.forEach(v => {
    const type = v.type || 'other';
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push(v);
  });
  
  return Array.from(groups.entries()).map(([type, violations]) => ({
    type,
    violations
  }));
}

/**
 * Get error priority by violation type
 */
function getErrorPriorityByType(type: string): number {
  const { TASK_PRIORITIES } = require('../state');
  
  const priorityMap: Record<string, number> = {
    'missing_file': TASK_PRIORITIES.ERROR_MISSING_ENTRY,
    'missing_dependency': TASK_PRIORITIES.ERROR_MISSING_DEPS,
    'config_error': TASK_PRIORITIES.ERROR_CONFIG,
    'type_error': TASK_PRIORITIES.ERROR_TYPE,
    'import_error': TASK_PRIORITIES.ERROR_IMPORT,
    'build_error': TASK_PRIORITIES.ERROR_BUILD,
    'syntax_error': TASK_PRIORITIES.ERROR_SYNTAX,
    'lint_error': TASK_PRIORITIES.ERROR_LINT,
  };
  
  return priorityMap[type] || TASK_PRIORITIES.ERROR_OTHER;
}

/**
 * Format error description for Error Task
 */
function formatErrorDescription(violations: any[]): string {
  return violations.map((v, idx) => {
    const parts = [`${idx + 1}. [${v.severity}] ${v.type}: ${v.message}`];
    if (v.file) parts.push(`   File: ${v.file}`);
    if (v.module) parts.push(`   Module: ${v.module}`);
    if (v.suggestedFix) parts.push(`   Suggested: ${v.suggestedFix}`);
    return parts.join('\n');
  }).join('\n\n');
}

/**
 * Generate failure report when Final Verification fails multiple times
 */
async function generateFailureReport(state: ArchitectGraphState, violations: any[]): Promise<EvaluationReport> {
  const { context } = state;
  const project = context.project;
  
  // Create a minimal report with error information
  const report: EvaluationReport = {
    timestamp: new Date().toISOString(),
    filesGenerated: state.files?.length || 0,
    totalLines: 0,
    metrics: {
      totalFiles: 0,
      totalLines: 0,
      avgComplexity: 0,
      avgMaintainability: 0,
      fileMetrics: [],
    },
    quality: 'FAILED',
    recommendations: [
      `⚠️ Final Verification failed after 3 attempts`,
      `🔍 ${violations.length} unresolved error(s)`,
      ...violations.slice(0, 5).map((v, idx) => 
        `${idx + 1}. [${v.type}] ${v.message}`
      ),
    ],
  };
  
  console.log('\n❌ FINAL VERIFICATION FAILED');
  console.log(`   Unresolved errors: ${violations.length}`);
  console.log(`   Please review the violations and try again\n`);
  
  return report;
}

