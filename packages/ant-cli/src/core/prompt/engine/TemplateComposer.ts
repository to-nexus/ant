import { PromptPort, ProfilePort } from "../../ports";
import { CodebaseProfile } from "../../types";
import { ProjectContext } from "../../types";
import { PromptModeConfig } from "./ModeController";
import { AssembledContext } from "./ContextAssembler";

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
    
    // 3. Render base template
    const base = await this.renderTemplate(
      modeConfig.templates.base,
      {
        project: context.project,
        modificationMode: assembled.stats.hasOriginalFiles
          ? 'MODIFICATION MODE: Copy original, then modify'
          : 'CREATION MODE: Build from scratch',
        currentCode: assembled.currentCode || '',
        designDoc: assembled.designDoc || '',
        lastSectionNumber: assembled.lastSectionNumber ?? 0,  // ✅ Last chapter number
        currentTask: assembled.currentTask || null,
        projectPath: (context as any).projectPath || context.workingDir || '/path/to/project'
      }
    );
    
    // 4. Render rules template
    const rules = await this.renderTemplate(
      modeConfig.templates.rules,
      {}
    );
    
    // 5. Build injections
    const injections = await this.buildInjections(
      modeConfig.templates.injections,
      assembled
    );
    
    // 6. Load examples (if enabled)
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
  assembleFinal(composed: ComposedPrompt): string {
    const parts: string[] = [];
    
    // Always include system
    if (composed.system) {
      parts.push(composed.system);
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
      'memory': { content: this.truncate(assembled.memory || '', 1000) },
      'session-history': { content: this.truncate(assembled.sessionHistory || '', 2000) },
      'modification-warning': {},
      'retry-context': { retryContext: assembled.retryContext }
      // ✅ REMOVED: modification-details, pre-output-check, previous-design (deleted files)
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
}

