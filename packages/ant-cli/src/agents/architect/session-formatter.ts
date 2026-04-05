import { Session, SessionRun, SessionRunOutput } from "../../core/types";

/**
 * Format session context for prompt inclusion
 * 
 * Converts session history into a readable string for LLM context.
 * Shows recent runs to maintain conversation continuity.
 * 
 * Role: Provides short-term memory (what was done in this feature)
 * Complements Vector memory (long-term knowledge across features)
 */
export function formatSessionContext(session: Session): string {
  if (!session || session.runs.length === 0) {
    return "";
  }
  
  const sections: string[] = [];
  
  sections.push(`
🔄 Current Feature Work History
${"=".repeat(50)}
Feature: ${session.feature}
Session ID: ${session.sessionId}
Started: ${new Date(session.createdAt).toLocaleString()}
Total Runs: ${session.runs.length}
`);
  
  for (const run of session.runs) {
    const inputLine = run.input.source 
      ? `Input: ${run.input.summary}\nSource: ${run.input.source}`
      : `Input: ${run.input.summary}`;
    
    sections.push(`
━━━ Run ${run.runId} (${run.job}) ━━━
Time: ${new Date(run.timestamp).toLocaleString()}
${inputLine}

Output:
${formatRunOutput(run.output)}
`);
  }
  
  // Key artifacts (현재 상태)
  if (session.artifacts.keyDecisions && session.artifacts.keyDecisions.length > 0) {
    sections.push(`
📌 Key Decisions Made:
${session.artifacts.keyDecisions.map(d => `  ${d}`).join('\n')}
`);
  }
  
  if (session.artifacts.latestDesign) {
    sections.push(`
📐 Latest Design: ${session.artifacts.latestDesign}
`);
  }
  
  if (session.artifacts.activeBranch) {
    sections.push(`
🌿 Active Branch: ${session.artifacts.activeBranch}
`);
  }
  
  return sections.join('\n');
}

/**
 * Format run output for readability
 */
function formatRunOutput(output: SessionRunOutput): string {
  const lines: string[] = [];
  
  // Design outputs
  if (output.designPath) {
    lines.push(`  📄 Design: ${output.designPath}`);
  }
  if (output.planSummary) {
    lines.push(`  📋 Plan: ${output.planSummary}`);
  }
  if (output.decisionCount !== undefined) {
    lines.push(`  ✅ Decisions: ${output.decisionCount} made`);
  }
  
  // Code outputs
  if (output.branch) {
    lines.push(`  🌿 Branch: ${output.branch}`);
  }
  if (output.files && output.files.length > 0) {
    lines.push(`  📝 Files Modified: ${output.files.slice(0, 10).join(', ')}${output.files.length > 10 ? '...' : ''}`);
  }
  if (output.modifications && output.modifications.length > 0) {
    lines.push(`  ✏️  Files Updated: ${output.modifications.join(', ')}`);
  }
  
  // Report
  if (output.reportPath) {
    lines.push(`  📊 Report: ${output.reportPath}`);
  }
  
  // Error
  if (output.error) {
    lines.push(`  ❌ Error: ${output.error}`);
  }
  
  return lines.length > 0 ? lines.join('\n') : '  (No detailed output)';
}

/**
 * Get summary of session for logging
 */
export function getSessionSummary(session: Session): string {
  return `Session ${session.sessionId.substring(0, 8)}... (${session.runs.length} runs)`;
}

