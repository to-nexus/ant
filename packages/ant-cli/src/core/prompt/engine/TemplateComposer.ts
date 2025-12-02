import { PromptPort, ProfilePort } from "../../ports";
import { CodebaseProfile } from "../../types";
import { ProjectContext } from "../../types";
import { PromptModeConfig } from "./ModeController";
import { AssembledContext } from "./ContextAssembler";
import Handlebars from 'handlebars';

// Register Handlebars helpers
Handlebars.registerHelper('add', function(a: number, b: number) {
  return a + b;
});

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
    // 1. Load system prompt (cached)
    const system = await this.getSystemPrompt(modeConfig.task);
    
    // 2. Build profiles (if enabled)
    const profiles = modeConfig.flags.includeProfiles
      ? await this.buildProfileSection(assembled.codebaseProfile)
      : '';
    
    // ✅ 3. Determine design document to use
    // Priority: designDoc (backward compat) > filtered designDocs (environment-specific)
    let designDoc = assembled.designDoc || '';
    
    // If no designDoc but we have designDocs, filter by environment
    if (!designDoc && assembled.designDocs) {
      designDoc = this.selectDesignDocByEnvironment(
        assembled.designDocs,
        assembled.currentTask
      );
      
      if (designDoc) {
        console.log(`📄 [TemplateComposer] Using environment-filtered design documents`);
      }
    } else if (designDoc && assembled.designDocs) {
      // ✅ NEW: Even if we have designDoc, prefer filtered version for better token efficiency
      const filteredDoc = this.selectDesignDocByEnvironment(
        assembled.designDocs,
        assembled.currentTask
      );
      
      if (filteredDoc) {
        console.log(`📄 [TemplateComposer] Using environment-filtered docs (more efficient than unified doc)`);
        designDoc = filteredDoc;
      }
    }
    
    // 4. Render base template
    const base = await this.renderTemplate(
      modeConfig.templates.base,
      {
        project: context.project,
        modificationMode: assembled.stats.hasOriginalFiles
          ? 'MODIFICATION MODE: Copy original, then modify'
          : 'CREATION MODE: Build from scratch',
        currentCode: assembled.currentCode || '',
        designDoc,  // ✅ Use filtered design doc
        lastSectionNumber: assembled.lastSectionNumber ?? 0,  // ✅ Last chapter number
        currentTask: assembled.currentTask || null,
        projectPath: (context as any).projectPath || context.workingDir || '/path/to/project',
        referenceRequests: assembled.referenceRequests || []  // ✅ Reference projects for tool calling
      }
    );
    
    // 5. Render rules template
    const rules = await this.renderTemplate(
      modeConfig.templates.rules,
      {}
    );
    
    // 6. Build injections
    const injections = await this.buildInjections(
      modeConfig.templates.injections,
      assembled
    );
    
    // 7. Load examples (if enabled)
    const examples = modeConfig.flags.includeExamples
      ? await this.renderTemplate(`${modeConfig.task}/base/examples`, {})
      : '';
    
    // ✅ Debug: Verify examples loading
    if (modeConfig.flags.includeExamples) {
      if (examples && examples.length > 0) {
        console.log(`✅ [TemplateComposer] Examples loaded: ${examples.length} chars`);
      } else {
        console.error(`❌ [TemplateComposer] Examples enabled but empty!`);
      }
    }
    
    return {
      system,
      profiles,
      base,
      rules,
      injections,
      examples
    };
  }
  
  /**
   * Assemble all parts into final prompt string
   */
  assembleFinal(composed: ComposedPrompt, userLanguage?: string): string {
    const parts: string[] = [];
    
    // Always include system
    if (composed.system) {
      parts.push(composed.system);
    }
    
    // ✅ NEW: Add language instruction if non-English
    if (userLanguage && userLanguage !== 'en') {
      const { getLanguageInstruction } = require('../../utils/languageDetector');
      const languageInstruction = getLanguageInstruction(userLanguage);
      if (languageInstruction) {
        console.log(`🌍 [TemplateComposer] Adding ${userLanguage} language instruction`);
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
      console.log(`✅ [TemplateComposer] Including examples in final prompt: ${composed.examples.length} chars`);
      parts.push(composed.examples);
    } else if (composed.examples === '') {
      console.log(`ℹ️  [TemplateComposer] Examples explicitly disabled or empty`);
    }
    
    const finalPrompt = parts.join('\n\n');
    
    // ✅ NEW: Estimate and log token count
    this.logTokenEstimation(composed, finalPrompt);
    
    return finalPrompt;
  }
  
  /**
   * Estimate and log token count for the assembled prompt
   */
  private logTokenEstimation(composed: ComposedPrompt, finalPrompt: string): void {
    const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);
    
    const breakdown = {
      system: estimateTokens(composed.system),
      profiles: estimateTokens(composed.profiles),
      base: estimateTokens(composed.base),
      injections: estimateTokens(composed.injections),
      rules: estimateTokens(composed.rules),
      examples: estimateTokens(composed.examples),
      total: estimateTokens(finalPrompt)
    };
    
    console.log(`\n📊 [TemplateComposer] Token Estimation:`);
    console.log(`   System: ${breakdown.system.toLocaleString()} tokens`);
    if (breakdown.profiles > 0) {
      console.log(`   Profiles: ${breakdown.profiles.toLocaleString()} tokens`);
    }
    console.log(`   Base: ${breakdown.base.toLocaleString()} tokens`);
    console.log(`   Injections: ${breakdown.injections.toLocaleString()} tokens`);
    console.log(`   Rules: ${breakdown.rules.toLocaleString()} tokens`);
    if (breakdown.examples > 0) {
      console.log(`   Examples: ${breakdown.examples.toLocaleString()} tokens`);
    }
    console.log(`   ──────────────────────────────────────`);
    console.log(`   TOTAL: ${breakdown.total.toLocaleString()} tokens (${(finalPrompt.length / 1024).toFixed(1)} KB)`);
    console.log(``);
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
   * Select appropriate design document based on task environment
   * 
   * Strategy:
   * - Frontend: api-contract + (fe-system-design OR system-design)
   * - Backend: api-contract + (be-system-design OR system-design)
   * - Unknown: api-contract + all available
   */
  private selectDesignDocByEnvironment(
    designDocs: {
      apiContract?: string;
      feDesign?: string;
      beDesign?: string;
      unifiedDesign?: string;
    },
    currentTask?: {
      name: string;
      type: string;
      priority: number;
      description: string;
    }
  ): string {
    if (!currentTask) {
      // No task info - return all available
      return this.combineDesignDocs(designDocs, 'unknown');
    }
    
    // Detect environment from task name and description
    const taskText = `${currentTask.name} ${currentTask.description}`.toLowerCase();
    
    const isFrontend = 
      taskText.includes('frontend') ||
      taskText.includes('front-end') ||
      taskText.includes('fe') ||
      taskText.includes('ui') ||
      taskText.includes('component') ||
      taskText.includes('page') ||
      taskText.includes('view') ||
      taskText.includes('react') ||
      taskText.includes('vue') ||
      taskText.includes('angular');
    
    const isBackend =
      taskText.includes('backend') ||
      taskText.includes('back-end') ||
      taskText.includes('be') ||
      taskText.includes('api') ||
      taskText.includes('server') ||
      taskText.includes('database') ||
      taskText.includes('endpoint') ||
      taskText.includes('controller') ||
      taskText.includes('service') ||
      taskText.includes('repository');
    
    let environment: 'frontend' | 'backend' | 'unknown' = 'unknown';
    
    if (isFrontend && !isBackend) {
      environment = 'frontend';
    } else if (isBackend && !isFrontend) {
      environment = 'backend';
    }
    
    console.log(`📄 [TemplateComposer] Task environment detected: ${environment}`);
    console.log(`   Task: ${currentTask.name}`);
    
    return this.combineDesignDocs(designDocs, environment);
  }
  
  /**
   * Combine design documents based on environment
   */
  private combineDesignDocs(
    designDocs: {
      apiContract?: string;
      feDesign?: string;
      beDesign?: string;
      unifiedDesign?: string;
    },
    environment: 'frontend' | 'backend' | 'unknown'
  ): string {
    const parts: string[] = [];
    
    // ✅ ALWAYS include API contract (if exists)
    if (designDocs.apiContract) {
      parts.push('# API Contract\n\n' + designDocs.apiContract);
      console.log(`   ✅ Including api-contract.md`);
    }
    
    // ✅ Environment-specific system design
    if (environment === 'frontend') {
      // Frontend: prefer fe-system-design.md, fallback to system-design.md
      if (designDocs.feDesign) {
        parts.push('# Frontend System Design\n\n' + designDocs.feDesign);
        console.log(`   ✅ Including fe-system-design.md (frontend task)`);
      } else if (designDocs.unifiedDesign) {
        parts.push('# System Design\n\n' + designDocs.unifiedDesign);
        console.log(`   ✅ Including system-design.md (frontend fallback)`);
      }
      // ❌ DO NOT include be-system-design.md for frontend
      if (designDocs.beDesign) {
        console.log(`   ⊖ Skipping be-system-design.md (not needed for frontend)`);
      }
    } else if (environment === 'backend') {
      // Backend: prefer be-system-design.md, fallback to system-design.md
      if (designDocs.beDesign) {
        parts.push('# Backend System Design\n\n' + designDocs.beDesign);
        console.log(`   ✅ Including be-system-design.md (backend task)`);
      } else if (designDocs.unifiedDesign) {
        parts.push('# System Design\n\n' + designDocs.unifiedDesign);
        console.log(`   ✅ Including system-design.md (backend fallback)`);
      }
      // ❌ DO NOT include fe-system-design.md for backend
      if (designDocs.feDesign) {
        console.log(`   ⊖ Skipping fe-system-design.md (not needed for backend)`);
      }
    } else {
      // Unknown: include all available (decompose phase)
      if (designDocs.feDesign) {
        parts.push('# Frontend System Design\n\n' + designDocs.feDesign);
        console.log(`   ✅ Including fe-system-design.md (unknown env)`);
      }
      if (designDocs.beDesign) {
        parts.push('# Backend System Design\n\n' + designDocs.beDesign);
        console.log(`   ✅ Including be-system-design.md (unknown env)`);
      }
      if (designDocs.unifiedDesign && !designDocs.feDesign && !designDocs.beDesign) {
        parts.push('# System Design\n\n' + designDocs.unifiedDesign);
        console.log(`   ✅ Including system-design.md (unknown env)`);
      }
    }
    
    return parts.join('\n\n════════════════════════════════════════════════════════════════════════════════\n\n');
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
    assembled: AssembledContext
  ): Promise<string> {
    const injections: string[] = [];
    
    for (const path of injectionPaths) {
      console.log(`[TemplateComposer] Rendering injection: ${path}`);
      const vars = this.getInjectionVars(path, assembled);
      const rendered = await this.renderTemplate(path, vars);
      
      if (rendered) {
        console.log(`  ✅ Rendered (${rendered.length} chars)`);
        injections.push(rendered);
      } else {
        console.log(`  ⚠️  Empty or failed to render`);
      }
    }
    
    return injections.join('\n\n');
  }
  
  /**
   * Get variables for a specific injection template
   */
  private getInjectionVars(
    path: string,
    assembled: AssembledContext
  ): Record<string, any> {
    const filename = path.split('/').pop() || '';
    
    const varMap: Record<string, any> = {
      'directive': { content: assembled.directive },
      'design-doc': { content: assembled.designDoc || '' },
      'prd-spec': { content: this.truncate(assembled.prdSpec || '', 800) },
      'original-files': { files: assembled.originalFiles },
      'current-code': { content: this.truncate(assembled.currentCode || '', 500) },
      'lessons': { lessons: this.formatLessons(assembled.lessons) },
      'session-context': { sessionContext: this.formatSessionContext(assembled.sessionContext) },
      'modification-warning': {},
      'retry-context': { retryContext: assembled.retryContext }
    };
    
    return varMap[filename] || {};
  }
  
  /**
   * Render template with variables
   */
  private async renderTemplate(
    templatePath: string,
    vars: Record<string, any>
  ): Promise<string> {
    try {
      return await this.promptPort.render(templatePath, vars);
    } catch (error) {
      // ✅ Plan phase templates are deprecated (plan node doesn't use LLM)
      // Just return empty string silently
      if (templatePath.includes('phases/plan/')) {
        return '';
      }
      
      console.error(`[TemplateComposer] Failed to load template: ${templatePath}`);
      console.error(`[TemplateComposer] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`[TemplateComposer] Error message: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        console.error(`[TemplateComposer] Stack trace:`, error.stack.split('\n').slice(0, 5).join('\n'));
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
    recentTurns: Array<{
      turnId: number;
      directive: string;
      mode: string;
      output: string;
    }>;
    summary?: string;
    totalTurns: number;
    currentTurn: number;
    currentMode: string;
  }): string {
    if (!sessionContext || sessionContext.totalTurns === 0) {
      return 'This is the first turn of the session.';
    }
    
    let formatted = `You are on Turn ${sessionContext.currentTurn} of ${sessionContext.totalTurns}.\n\n`;
    
    // Recent turns
    if (sessionContext.recentTurns.length > 0) {
      formatted += '### Recent Work\n\n';
      for (const turn of sessionContext.recentTurns) {
        formatted += `**Turn ${turn.turnId}** (${turn.mode}):\n`;
        formatted += `- Request: ${turn.directive}\n`;
        if (turn.output) {
          formatted += `- Output: ${turn.output}\n`;
        }
        formatted += '\n';
      }
    }
    
    // Earlier summary
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

