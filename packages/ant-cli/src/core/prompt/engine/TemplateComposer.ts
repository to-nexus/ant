import { PromptPort, ProfilePort } from "../../ports";
import { CodebaseProfile } from "../../types";
import { ProjectContext } from "../../types";
import { PromptModeConfig } from "./ModeController";
import { AssembledContext } from "./ContextAssembler";
import { formatGitDiffForPrompt } from "../../codebase/GitDiffSummary";
import { getLanguageInstruction, UserLanguage } from "../../utils/languageDetector";
import { sanitizeInjectionVars } from "./InputSanitizer";

/**
 * Composed prompt parts
 */
export interface ComposedPrompt {
  system: string;              // System prompt
  profiles: string;            // Language/framework profiles
  base: string;                // Base prompt template
  rules: string;               // Rules and constraints
  injections: string;          // Dynamic context injections
  examples: string;            // Few-shot examples
  failedTemplates: string[];   // Templates that failed to render (for diagnostics)
}

/**
 * TemplateComposer - Layer 4
 * Assembles prompt from templates and context
 * 
 * Responsibilities:
 * - Load and cache templates
 * - Inject variables into templates
 * - Compose all sections
 * - Handle conditional injections
 */
export class TemplateComposer {
  private systemPromptCache: Record<string, string> = {};
  
  constructor(
    private promptPort: PromptPort,
    private profilePort?: ProfilePort
  ) {}
  
  /**
   * Compose complete prompt from config and context
   */
  async compose(
    modeConfig: PromptModeConfig,
    context: ProjectContext,
    assembled: AssembledContext
  ): Promise<ComposedPrompt> {
    const failedTemplates: string[] = [];

    // 1. Load system prompt (cached)
    const system = await this.getSystemPrompt(modeConfig.job);
    
    // 2. Build profiles (if enabled)
    const profiles = modeConfig.flags.includeProfiles
      ? await this.buildProfileSection(assembled.codebaseProfile)
      : '';
    
    // 4. Render base template
    // User-controlled fields (directive, document content) are wrapped
    // in boundary tags by sanitizeInjectionVars to mitigate prompt injection.
    const base = await this.renderTemplate(
      modeConfig.templates.base,
      sanitizeInjectionVars({

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Variables used by code/phases/execute/base.md and design/phases/execute/base-system-design.md
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
        // ✅ Used in multiple conditionals ({{#if currentTask}}, {{currentTask.type}}, etc.)
        currentTask: assembled.currentTask || null,
        
        directive: assembled.directive || '',
        
        // ✅ Used in {{#if (eq modificationMode "MODIFICATION MODE: ...")}}
        modificationMode: assembled.projectCodeContext?.files && assembled.projectCodeContext.files.length > 0
          ? 'MODIFICATION MODE: Modify existing code'
          : 'CREATION MODE: Build from scratch',
        
        // ✅ Used in {{#if referenceRequests}} and {{#each referenceRequests}}
        referenceRequests: assembled.referenceRequests || [],
        
        // ✅ Used in {{#if lastSectionNumber}} for design job continuation
        lastSectionNumber: assembled.lastSectionNumber ?? undefined,
        
        // ✅ Used in {{#if sectionPattern}} for structure pattern enforcement
        sectionPattern: assembled.sectionPattern ?? undefined,
        
        // ✅ Used in {{#unless isLastTaskForDocument}} to skip metadata output
        isLastTaskForDocument: assembled.isLastTaskForDocument || false,
        
        // ✅ Used in {{#if sectionScope}} for exclusive section assignments
        sectionScope: assembled.sectionScope || undefined,
        
        // ✅ Used in {{#if filteredCatalog}} — replaces full catalog partial with assigned-only guide
        filteredCatalog: assembled.filteredCatalog || undefined,
        
        hasUiInDocuments: (assembled.documents || []).some(d => d.path?.includes('ui-')),
        isSpecDriven: assembled.isSpecDriven || false,
        figmaAvailable: assembled.figmaAvailable || false,
        figmaStartNodeId: assembled.figmaStartNodeId || undefined
      }),
      failedTemplates,
      true // critical: base template failure = job must fail
    );
    
    // 5. Render rules template
    const rules = await this.renderTemplate(
      modeConfig.templates.rules,
      {
        lastSectionNumber: assembled.lastSectionNumber ?? undefined,
        sectionPattern: assembled.sectionPattern ?? undefined,
        currentTask: assembled.currentTask || null,
        isLastTaskForDocument: assembled.isLastTaskForDocument || false
      },
      failedTemplates,
      true // critical: rules template failure = job must fail
    );
    
    // 6. Build injections
    const injections = await this.buildInjections(
      modeConfig.templates.injections,
      assembled,
      context
    );
    
    // 7. Load examples (if enabled)
    const examples = modeConfig.flags.includeExamples
      ? await this.renderTemplate(`${modeConfig.job}/base/examples`, {}, failedTemplates)
      : '';
    
    if (failedTemplates.length > 0) {
      console.error(`🚨 [TemplateComposer] ${failedTemplates.length} template(s) failed: ${failedTemplates.join(', ')}`);
    }

    return {
      system,
      profiles,
      base,
      rules,
      injections,
      examples,
      failedTemplates
    };
  }
  
  /**
   * Assemble all parts into final prompt string
   */
  assembleFinal(composed: ComposedPrompt, userLanguage?: UserLanguage): string {
    const parts: string[] = [];
    
    // Always include system
    if (composed.system) {
      parts.push(composed.system);
    }
    
    // Add language instruction if non-English
    if (userLanguage && userLanguage !== 'en') {
      const languageInstruction = getLanguageInstruction(userLanguage);
      if (languageInstruction) {
        parts.push(languageInstruction);
      }
    }
    
    // Add profiles if present
    if (composed.profiles) {
      parts.push(composed.profiles);
    }
    
    // Add base prompt
    if (composed.base) {
      parts.push(composed.base);
    }
    
    // Add injections
    if (composed.injections) {
      parts.push(composed.injections);
    }
    
    // Add rules
    if (composed.rules) {
      parts.push(composed.rules);
    }
    
    // Add examples at the end
    if (composed.examples) {
      parts.push(composed.examples);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Get cached system prompt
   */
  private async getSystemPrompt(task: string): Promise<string> {
    if (!this.systemPromptCache[task]) {
      this.systemPromptCache[task] = await this.promptPort.render(
        `${task}/base/system`,
        {}
      );
    }
    return this.systemPromptCache[task];
  }

  /**
   * Build language/framework profile section
   */
  private async buildProfileSection(profile?: CodebaseProfile | null): Promise<string> {
    if (!this.profilePort || !profile) {
      return '';
    }
    
    const sections: string[] = [];
    
    // Load language profile
    if (profile.language) {
      const languageProfile = await this.profilePort.loadLanguage(profile.language);
      if (languageProfile) {
        sections.push(
          `<language_profile language="${profile.language}">\n${languageProfile}\n</language_profile>`
        );
      }
    }
    
    // Load framework profile
    if (profile.framework) {
      const frameworkProfile = await this.profilePort.loadFramework(profile.framework);
      if (frameworkProfile) {
        sections.push(
          `<framework_profile framework="${profile.framework}">\n${frameworkProfile}\n</framework_profile>`
        );
      }
    }
    
    return sections.length > 0 ? sections.join('\n\n') : '';
  }
  
  /**
   * Build all injections
   */
  private async buildInjections(
    injectionPaths: string[],
    assembled: AssembledContext,
    context?: ProjectContext
  ): Promise<string> {
    const injections: string[] = [];
    
    for (const path of injectionPaths) {
      const vars = this.getInjectionVars(path, assembled, context);
      const rendered = await this.renderTemplate(path, vars);
      
      if (rendered) {
        injections.push(rendered);
      }
    }
    
    return injections.join('\n\n');
  }
  
  /**
   * Get variables for a specific injection template
   * 
   * ✅ CRITICAL: Variable names MUST match template expectations exactly!
   * Each injection template declares its own variable names (e.g., {{directive}}, {{resolvedAction}})
   * This mapping ensures the correct variables are passed to each template.
   */
  private getInjectionVars(
    path: string,
    assembled: AssembledContext,
    context?: ProjectContext
  ): Record<string, any> {
    const filename = path.split('/').pop() || '';
    
    // ✅ Variable names match template expectations (verified against all .md files)
    const varMap: Record<string, any> = {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Common injections (common/injections/*.md)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      
      // directive.md expects: {{directive}}
      'directive': { 
        directive: assembled.directive 
      },
      
      // memory.md expects: {{content}} (generic placeholder for any content)
      'memory': { 
        content: this.formatLessons(assembled.lessons) || 'No relevant lessons found.' 
      },
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Code-specific injections (code/base/injections/*.md)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      
      // git-diff.md expects: {{gitDiff}}
      'git-diff': { 
        gitDiff: assembled.projectCodeContext?.gitDiff 
          ? formatGitDiffForPrompt(assembled.projectCodeContext.gitDiff) 
          : '' 
      },
      
      // retrieved-code.md expects: {{files}}, {{stats}}, {{filePaths}}
      'retrieved-code': { 
        files: assembled.projectCodeContext?.files || [],
        filePaths: assembled.projectCodeContext?.filePaths || [],
        stats: assembled.projectCodeContext?.stats
      },
      
      // reference-code.md expects: {{contexts}}
      'reference-code': {
        contexts: assembled.referenceCodeContexts || []
      },
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Execute phase injections (code/phases/execute/injections/*.md)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      
      // lessons.md expects: {{lessons}}
      'lessons': { 
        lessons: this.formatLessons(assembled.lessons) 
      },
      
      // session-context.md expects: {{sessionContext}}
      'session-context': { 
        sessionContext: this.formatSessionContext(assembled.sessionContext) 
      },
      
      // retry-context.md expects: {{retryContext}}
      'retry-context': { 
        retryContext: assembled.retryContext 
      },
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Special injections (no variables)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      
      // document-language.md expects: {{userLanguage}}
      'document-language': {
        userLanguage: context?.userLanguage || 'en',
      },
      
      'modification-warning': {},
      'text-format-compact': {},
      'tool-calling-rules-compact': {},
      'port-management': {},  // ✅ Port management guide (no vars needed)
      'system-design-guide': {},
      'ui-design-guide': {},
      'api-contract-guide': {
        filteredCatalog: assembled.filteredCatalog || undefined,
      },
      'backend-guide': {
        filteredCatalog: assembled.filteredCatalog || undefined,
      },
      'frontend-guide': {
        filteredCatalog: assembled.filteredCatalog || undefined,
      },
      'game-guide': {},
      'service-guide': {},
      'game-domain-guide': {},
      'service-domain-guide': {},
      'preview-setup': {},
      'preview-env-contract': {},
      'hints': {},

      'ui-design-policy': {},

      // RAC injection templates
      'action-context': {
        resolvedAction: assembled.resolvedAction || null,
      },
      'basis-guidance': {
        resolvedAction: assembled.resolvedAction || null,
      },
      'refactor-guidance': {
        resolvedAction: assembled.resolvedAction || null,
      },

    };
    
    const vars = varMap[filename] || {};
    return sanitizeInjectionVars(vars);
  }
  
  /**
   * Render template with variables
   */
  private async renderTemplate(
    templatePath: string,
    vars: Record<string, any>,
    failedTemplates?: string[],
    critical: boolean = false
  ): Promise<string> {
    try {
      return await this.promptPort.render(templatePath, vars);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (critical) {
        throw new Error(`[TemplateComposer] Critical template failed: ${templatePath} → ${errorMsg}`);
      }

      console.warn(`⚠️ [TemplateComposer] Non-critical template failed: ${templatePath} → ${errorMsg}`);
      if (failedTemplates) {
        failedTemplates.push(templatePath);
      }
      return '';
    }
  }
  
  /**
   * Truncate content
   */
  private truncate(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return `${content.substring(0, maxLength)}...\n[truncated]`;
  }
  
  /**
   * Format session context for prompt injection
   */
  private formatSessionContext(sessionContext?: {
    recentRuns: Array<{
      runId: number;
      directive: string;
      mode: string;
      output: string;
    }>;
    summary?: string;
    totalRuns: number;
    currentRun: number;
    currentMode: string;
  }): string {
    if (!sessionContext || sessionContext.totalRuns === 0) {
      return 'This is the first run of the session.';
    }
    
    let formatted = `You are on Run ${sessionContext.currentRun} of ${sessionContext.totalRuns}.\n\n`;
    
    if (sessionContext.recentRuns.length > 0) {
      formatted += '### Recent Work\n\n';
      for (const run of sessionContext.recentRuns) {
        formatted += `**Run ${run.runId}** (${run.mode}):\n`;
        formatted += `- Request: ${run.directive}\n`;
        if (run.output) {
          formatted += `- Output: ${run.output}\n`;
        }
        formatted += '\n';
      }
    }
    
    if (sessionContext.summary) {
      formatted += `### Earlier Work\n${sessionContext.summary}\n\n`;
    }
    
    formatted += '**Important**: Build upon your previous work. Maintain consistency with earlier decisions.\n';
    
    return formatted;
  }
  
  /**
   * Format lessons for prompt
   */
  private formatLessons(lessons?: Array<{
    content: string;
    score: number;
    relatedFiles: string[];
    tags: string[];
    timestamp: string;
    directive?: string;
  }>): string {
    if (!lessons || lessons.length === 0) {
      return 'No relevant lessons found.';
    }
    
    const relevantLessons = lessons.filter(l => l.score >= 0.7);
    
    if (relevantLessons.length === 0) {
      return 'No highly relevant lessons found (threshold: 0.7).';
    }
    
    return relevantLessons.map((lesson, idx) => {
      const tags = lesson.tags.length > 0 ? `[${lesson.tags.join(', ')}]` : '';
      const files = lesson.relatedFiles.length > 0 
        ? `\nRelated files: ${lesson.relatedFiles.slice(0, 3).join(', ')}${lesson.relatedFiles.length > 3 ? '...' : ''}`
        : '';
      
      return `## Lesson ${idx + 1} (score: ${lesson.score.toFixed(2)}) ${tags}\n${lesson.content}${files}`;
    }).join('\n\n---\n\n');
  }
}

