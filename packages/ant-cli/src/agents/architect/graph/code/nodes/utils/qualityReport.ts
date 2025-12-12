/**
 * Quality Report Generation Utility
 * 
 * Extracted from evaluate.ts for reuse in learn node.
 * Generates code quality reports with metrics and recommendations.
 */

import * as path from 'path';
import { ArchitectGraphState } from '../../state';
import { analyzeFiles, categorizeQuality, generateRecommendations, AggregateMetrics } from '../../../../utils/codeMetrics';
import { GitPort } from '../../../../../../core/ports';

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
 * Generate quality evaluation report
 */
export async function generateQualityReport(
  state: ArchitectGraphState, 
  gitPort: GitPort
): Promise<EvaluationReport | null> {
  console.log('\n🔬 Generating code quality report...\n');

  try {
    // Collect generated files from state
    const generatedFiles = (state.projectCodeContext?.files || []).map(f => ({
      path: f.path,
      content: f.content
    }));
    
    if (generatedFiles.length === 0) {
      console.log('⚠️  No files to evaluate');
      return null;
    }

    // Analyze code metrics
    const metrics = analyzeFiles(generatedFiles);
    
    // Load requirements (if available)
    const featurePath = state.context.featurePath;
    if (!featurePath) {
      throw new Error('featurePath not available in context');
    }
    const requirements = await loadRequirements(state.context.project, state.context.featureFolder, featurePath, gitPort);

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
    const reportPath = await saveReport(state.context.project, state.context.featureFolder, featurePath, report, gitPort);
    console.log(`📄 Evaluation report saved: ${reportPath}`);

    // Print summary
    printSummary(report);

    // Check quality thresholds
    await checkQualityThresholds(state.context.project, state.context.featureFolder, featurePath, report, gitPort);

    return report;
  } catch (error: any) {
    console.error('⚠️  Quality report generation failed:', error.message);
    return null;
  }
}

/**
 * Load requirements checklist from eval directive
 */
async function loadRequirements(project: string, featureFolder: string, featurePath: string, gitPort: GitPort): Promise<RequirementChecklistItem[] | undefined> {
  try {
    const testsPath = path.join(featurePath, 'inputs/directives/eval/tests.json');

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
async function saveReport(project: string, featureFolder: string, featurePath: string, report: EvaluationReport, gitPort: GitPort): Promise<string> {
  const outputDir = path.join(featurePath, 'outputs/eval');
  
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
async function checkQualityThresholds(project: string, featureFolder: string, featurePath: string, report: EvaluationReport, gitPort: GitPort): Promise<void> {
  try {
    const thresholdsPath = path.join(featurePath, 'inputs/directives/eval/quality-thresholds.json');

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

    if (thresholds.minMaintainability && report.metrics.avgMaintainability < thresholds.minMaintainability) {
      failures.push(`Maintainability ${report.metrics.avgMaintainability} < ${thresholds.minMaintainability}`);
    }

    if (thresholds.maxComplexity && report.metrics.avgComplexity > thresholds.maxComplexity) {
      failures.push(`Complexity ${report.metrics.avgComplexity} > ${thresholds.maxComplexity}`);
    }

    if (failures.length > 0) {
      console.warn('⚠️  Quality thresholds not met:');
      failures.forEach(f => console.warn(`   - ${f}`));
      console.warn('');
    } else {
      console.log('✅ All quality thresholds met!\n');
    }
  } catch (error) {
    // Ignore errors in threshold checking
  }
}
