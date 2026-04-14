/**
 * Agent Registry
 * 
 * Data-driven registry for job capabilities and prerequisites.
 * All job definitions are loaded from YAML files.
 * 
 * KEY PRINCIPLE: This registry ONLY provides data.
 * LLM makes all classification decisions.
 */

import {
  getTriageDataLoader,
  JobDefinition,
  PrerequisiteCondition,
  PrerequisiteStatus,
  PrerequisiteCheckResult,
  DetectionCondition,
  DetectionItem,
} from '../../../../../core/data/triage/index.js';
import { WorkspaceState } from './types.js';

/**
 * Agent Registry
 * 
 * Provides data-driven access to job definitions and prerequisites.
 */
class AgentRegistryClass {
  private initialized = false;
  
  /**
   * Initialize the registry by loading YAML data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    const loader = getTriageDataLoader();
    await loader.load();
    this.initialized = true;
  }
  
  /**
   * Get all job definitions
   */
  getAllJobs(): JobDefinition[] {
    const loader = getTriageDataLoader();
    return loader.getAllJobs();
  }
  
  /**
   * Get a specific job definition
   */
  getJob(jobId: string): JobDefinition | null {
    const loader = getTriageDataLoader();
    return loader.getJob(jobId);
  }
  
  /**
   * Get all job IDs
   */
  getJobIds(): string[] {
    const loader = getTriageDataLoader();
    return loader.getJobIds();
  }
  
  /**
   * Check prerequisites for a job mode against workspace state
   */
  checkPrerequisites(
    jobId: string,
    modeId: string,
    workspaceState: WorkspaceState
  ): PrerequisiteStatus {
    const job = this.getJob(jobId);
    
    if (!job) {
      return {
        required: [],
        recommended: [],
        allRequiredMet: true,
        allRecommendedMet: true,
      };
    }
    
    const mode = job.modes.find(m => m.id === modeId);
    
    if (!mode) {
      return {
        required: [],
        recommended: [],
        allRequiredMet: true,
        allRecommendedMet: true,
      };
    }
    
    const requiredResults = mode.prerequisites.required.map(prereq => 
      this.checkCondition(prereq, workspaceState)
    );
    
    const recommendedResults = mode.prerequisites.recommended.map(prereq =>
      this.checkCondition(prereq, workspaceState)
    );
    
    return {
      required: requiredResults,
      recommended: recommendedResults,
      allRequiredMet: requiredResults.every(r => r.satisfied),
      allRecommendedMet: recommendedResults.every(r => r.satisfied),
    };
  }
  
  /**
   * Detect which mode should be used based on workspace state
   */
  detectMode(jobId: string, workspaceState: WorkspaceState): string | null {
    const job = this.getJob(jobId);
    if (!job) return null;
    
    for (const mode of job.modes) {
      if (this.matchesDetection(mode.detection, workspaceState)) {
        return mode.id;
      }
    }
    
    return job.modes[0]?.id || null;
  }
  
  /**
   * Generate prompt context for LLM
   * This provides all data LLM needs to make decisions
   */
  generatePromptContext(): string {
    const jobs = this.getAllJobs();
    const lines: string[] = [];
    
    lines.push('## AVAILABLE JOBS\n');
    
    for (const job of jobs) {
      lines.push(`### ${job.id} job (agent: ${job.agent})`);
      lines.push(`${job.description}\n`);
      
      for (const mode of job.modes) {
        lines.push(`#### Mode: ${mode.id}`);
        lines.push(`${mode.description}\n`);
        
        const requiredDescs = mode.prerequisites.required
          .map(p => this.formatPrereqDescription(p))
          .filter(Boolean);
        const recommendedDescs = mode.prerequisites.recommended
          .map(p => this.formatPrereqDescription(p))
          .filter(Boolean);
        
        if (requiredDescs.length > 0 || recommendedDescs.length > 0) {
          lines.push('**Prerequisites:**');
          if (requiredDescs.length > 0) {
            lines.push('- Required:');
            for (const desc of requiredDescs) {
              lines.push(`  - ${desc}`);
            }
          }
          if (recommendedDescs.length > 0) {
            lines.push('- Recommended:');
            for (const desc of recommendedDescs) {
              lines.push(`  - ${desc}`);
            }
          }
        }
        
        lines.push('\n**Scope:**');
        for (const scope of mode.scope) {
          lines.push(`- ${scope}`);
        }
        lines.push('');
      }
      
      lines.push('**Redirect signals:**');
      for (const [toJob, signal] of Object.entries(job.redirect_signals)) {
        lines.push(`- → ${toJob}: ${signal}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  /**
   * Generate rich knowledge content for Ask system prompt.
   * More detailed than generatePromptContext() — includes outputs, workflow guidance.
   */
  generateAskKnowledge(): string {
    const jobs = this.getAllJobs();
    const lines: string[] = [];

    lines.push('## Job Types\n');
    lines.push('| Job | Agent | Purpose |');
    lines.push('|-----|-------|---------|');
    for (const job of jobs) {
      const purpose = job.description.split('\n')[0].trim();
      lines.push(`| **${job.id}** | ${job.agent} | ${purpose} |`);
    }
    lines.push('');

    for (const job of jobs) {
      lines.push(`## ${job.id} Job\n`);
      lines.push(job.description.trim());
      lines.push('');

      for (const mode of job.modes) {
        lines.push(`### Mode: ${mode.id}\n`);
        lines.push(mode.description.trim());
        lines.push('');

        if (mode.outputs && mode.outputs.length > 0) {
          lines.push('**Outputs:**');
          for (const output of mode.outputs) {
            lines.push(`- \`${output.name}\`: ${output.description}`);
          }
          lines.push('');
        }

        if (mode.scope.length > 0) {
          lines.push('**Scope:**');
          for (const s of mode.scope) {
            lines.push(`- ${s}`);
          }
          lines.push('');
        }
      }
    }

    lines.push('## Workflow Decision Principles\n');
    lines.push('Workflow selection depends on observed input state:\n');
    for (const job of jobs) {
      for (const mode of job.modes) {
        const allDescs = mode.prerequisites.required
          .map(p => this.formatAskPrereqDescription(p))
          .filter(Boolean);
        if (allDescs.length > 0) {
          lines.push(`- ${allDescs.join(' + ')} → **${job.id}** (${mode.id})`);
        }
      }
    }
    lines.push('');
    lines.push('**Constraint**: Do NOT assume workflow. Observe actual inputs first.');

    return lines.join('\n');
  }

  /**
   * Detect language from user input
   */
  detectLanguage(input: string): 'ko' | 'en' {
    const loader = getTriageDataLoader();
    return loader.detectLanguage(input);
  }
  
  // Private methods

  /**
   * Format prerequisite for Ask knowledge — includes all prerequisites
   * including has_directive (unlike triage, ask needs full workflow explanation).
   */
  private formatAskPrereqDescription(prereq: PrerequisiteCondition): string {
    if (prereq.type === 'any_of' && prereq.items) {
      return prereq.items.map(item => item.description).join(' OR ');
    }
    return prereq.description;
  }

  /**
   * Resolve prerequisite description, handling `any_of` composites.
   * Filters out `has_directive` entirely — it's always true when a user
   * types anything, so it provides zero discriminative signal for triage.
   * Returns empty string when the prerequisite should be omitted.
   */
  private formatPrereqDescription(prereq: PrerequisiteCondition): string {
    if (prereq.type === 'has_directive') {
      return '';
    }
    if (prereq.type === 'any_of' && prereq.items) {
      const meaningful = prereq.items.filter(item => item.type !== 'has_directive');
      if (meaningful.length === 0) return '';
      return meaningful.map(item => item.description).join(' OR ');
    }
    return prereq.description;
  }
  
  private checkCondition(
    prereq: PrerequisiteCondition,
    ws: WorkspaceState
  ): PrerequisiteCheckResult {
    let satisfied = false;
    
    switch (prereq.type) {
      case 'file_with_content':
        if (prereq.path === 'inputs/prd.md') {
          satisfied = ws.hasPrd;
        }
        break;
        
      case 'directory_with_files':
        if (prereq.path === 'inputs/references') {
          satisfied = ws.hasScreens || ws.hasComponents;
        } else if (prereq.path === 'inputs/assets') {
          satisfied = ws.hasAssets;
        } else if (prereq.path === 'outputs/design') {
          satisfied = ws.hasDesignDoc;
        }
        break;
        
      case 'file_exists':
        if (prereq.path === 'inputs/sources/prd.md') {
          satisfied = ws.hasPrd;
        }
        break;
        
      case 'has_directive':
        satisfied = ws.hasDirective;
        break;
        
      case 'has_git_repository':
        satisfied = true; // Assume git repo exists if workspace exists
        break;
        
      case 'indexed_codebase':
        satisfied = ws.hasCodebase;
        break;

      case 'figma_config':
        satisfied = ws.hasFigmaConfig;
        break;
        
      case 'any_of':
        if (prereq.items) {
          satisfied = prereq.items.some(item => 
            this.checkCondition(item, ws).satisfied
          );
        }
        break;
    }
    
    return {
      id: prereq.id || prereq.type,
      description: prereq.description,
      satisfied,
      path: prereq.path,
    };
  }
  
  private matchesDetection(
    detection: DetectionCondition,
    ws: WorkspaceState
  ): boolean {
    if (detection.any_of) {
      return detection.any_of.some(item => this.matchesDetectionItem(item, ws));
    }
    
    if (detection.all_of) {
      return detection.all_of.every(item => this.matchesDetectionItem(item, ws));
    }
    
    return false;
  }
  
  private matchesDetectionItem(
    item: DetectionItem,
    ws: WorkspaceState
  ): boolean {
    if (!item) return false;
    
    // Handle nested conditions
    if (item.any_of) {
      return item.any_of.some(subItem => this.matchesDetectionItem(subItem, ws));
    }
    
    if (item.all_of) {
      return item.all_of.every(subItem => this.matchesDetectionItem(subItem, ws));
    }
    
    if (item.none_of) {
      return !item.none_of.some(subItem => this.matchesDetectionItem(subItem, ws));
    }
    
    // Handle leaf conditions
    const { path, type } = item;
    
    if (type === 'directory_with_files') {
      if (path === 'inputs/references') return ws.hasScreens || ws.hasComponents;
      if (path === 'inputs/assets') return ws.hasAssets;
      if (path === 'outputs/design') return ws.hasDesignDoc;
    }
    
    if (type === 'file_with_content') {
      if (path === 'inputs/prd.md') return ws.hasPrd;
    }
    
    if (type === 'file_exists') {
      if (path === 'inputs/sources/prd.md') return ws.hasPrd;
    }
    
    if (type === 'has_directive') {
      return ws.hasDirective;
    }
    
    if (type === 'has_git_repository') {
      return true;
    }
    
    if (type === 'indexed_codebase') {
      return ws.hasCodebase;
    }

    if (type === 'figma_config') {
      return ws.hasFigmaConfig;
    }
    
    return false;
  }
}

// Export singleton instance
export const AgentRegistry = new AgentRegistryClass();
