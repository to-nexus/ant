/**
 * Plan Contract Builder
 * 
 * Extracts and preserves key elements from the original plan
 */

import { ArchitectGraphState } from "../../state";

export interface PlanContract {
  summary: string;
  requiredElements: Array<{
    type: string;
    name: string;
    location?: string;
    purpose: string;
    implemented: boolean;
  }>;
}

/**
 * Extract key plan from THINKING section
 */
function extractKeyPlan(planText: string): string {
  // Extract THINKING section
  const thinkingMatch = planText.match(/===\s*THINKING\s*===([\s\S]*?)===\s*END THINKING\s*===/);
  if (!thinkingMatch) return '';
  
  const thinking = thinkingMatch[1];
  const keyParts: string[] = [];
  
  // Extract Solution section
  const solutionMatch = thinking.match(/\*\*Solution:\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (solutionMatch) {
    keyParts.push(solutionMatch[1].trim());
  }
  
  // Extract Execution Plan/Approach
  const planMatch = thinking.match(/\*\*(?:Execution Plan|Approach):\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (planMatch) {
    keyParts.push(planMatch[1].trim());
  }
  
  // Extract Files to modify/create
  const filesMatch = thinking.match(/\*\*Files to (?:Create\/)?Modify:\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (filesMatch) {
    keyParts.push(filesMatch[1].trim());
  }
  
  return keyParts.join('\n\n').substring(0, 500); // Limit length
}

/**
 * Build plan contract for preservation
 */
export function buildPlanContract(state: ArchitectGraphState): PlanContract | null {
  const planText = state.planText || '';
  
  // Extract summary
  const summary = extractKeyPlan(planText).substring(0, 300);
  
  // Extract required elements
  const requiredElements: Array<{
    type: string;
    name: string;
    location?: string;
    purpose: string;
    implemented: boolean;
  }> = [];
  
  // Extract functions from plan
  const functionMatches = planText.matchAll(/(?:use|call|invoke)\s+`([A-Za-z][A-Za-z0-9]*(?:WithFallback|Helper|Service)?(?:\.\w+)?)`/gi);
  const seenFunctions = new Set<string>();
  
  for (const match of functionMatches) {
    const funcName = match[1];
    if (!seenFunctions.has(funcName)) {
      seenFunctions.add(funcName);
      requiredElements.push({
        type: 'function',
        name: funcName,
        purpose: 'Core function from plan',
        implemented: false // Will be checked in template
      });
    }
  }
  
  // Extract imports
  const importMatches = planText.matchAll(/import.*?`([^`]+)`.*?from\s+[`']([^`']+)[`']/gi);
  for (const match of importMatches) {
    requiredElements.push({
      type: 'import',
      name: match[1],
      location: match[2],
      purpose: 'Required import',
      implemented: false
    });
  }
  
  return requiredElements.length > 0 ? {
    summary,
    requiredElements: requiredElements.slice(0, 5) // Top 5
  } : null;
}

/**
 * Extract key changes from generated files
 * Focus on package.json changes and new file types
 */
export function extractKeyChanges(files: Array<{ path: string; content: string }>): string[] {
  const changes: string[] = [];
  
  for (const file of files) {
    // Package.json changes - very important!
    if (file.path.includes('package.json')) {
      try {
        const pkg = JSON.parse(file.content);
        
        if (pkg.dependencies) {
          const deps = Object.keys(pkg.dependencies);
          if (deps.length > 0) {
            changes.push(`Added dependencies: ${deps.join(', ')}`);
          }
        }
        
        if (pkg.devDependencies) {
          const devDeps = Object.keys(pkg.devDependencies);
          if (devDeps.length > 0) {
            changes.push(`Added devDependencies: ${devDeps.join(', ')}`);
          }
        }
      } catch {
        changes.push('Modified package.json');
      }
    }
    
    // Config files
    else if (file.path.includes('tsconfig.json')) {
      changes.push('Created/modified tsconfig.json');
    }
    else if (file.path.includes('vite.config')) {
      changes.push('Created/modified vite.config');
    }
    else if (file.path.endsWith('.html')) {
      changes.push(`Created HTML entry: ${file.path}`);
    }
    // Component/source files
    else if (file.path.match(/\.(tsx?|jsx?)$/)) {
      changes.push(`Created component: ${file.path}`);
    }
  }
  
  return changes;
}

