import { PromptPort, ProfilePort, CodebaseProfile } from "../../../core/ports";
import { ProjectContext } from "../types";

export interface TaskInputs {
  directive: string | null;
  currentCode: string | null;
  originalFiles: string | null;
  designDoc: string | null;
  prdSpec: string | null;
  memory: string | null;
}

/**
 * ArchitectPromptor - High-level prompt composition for architect agent
 * Orchestrates modular prompts from prompts/ directory
 * Dynamically injects language/framework profiles when detected
 */
export class ArchitectPromptor {
  private systemPromptCache: Record<string, string> = {};

  constructor(
    private promptPort: PromptPort,
    private profilePort?: ProfilePort
  ) {}

  /**
   * Load and cache system prompt per task (code/design/learn),
   * shared between plan and execute phases for that task
   */
  private async getSystemPrompt(task: "code" | "design" | "learn"): Promise<string> {
    if (!this.systemPromptCache[task]) {
      this.systemPromptCache[task] = await this.promptPort.render(`${task}/base/system`, {});
    }
    return this.systemPromptCache[task];
  }

  /**
   * Helper: Load an injection template conditionally
   */
  private async buildInjection(
    templatePath: string, 
    condition: boolean, 
    vars: Record<string, any> = {}
  ): Promise<string> {
    return condition ? await this.promptPort.render(templatePath, vars) : '';
  }

  /**
   * Helper: Truncate content with ellipsis
   */
  private truncate(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return `${content.substring(0, maxLength)}...\n[truncated]`;
  }

  /**
   * Helper: Build profile section from detected codebase profile
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
        sections.push(`<language_profile language="${profile.language}">\n${languageProfile}\n</language_profile>`);
      }
    }

    // Load framework profile
    if (profile.framework) {
      const frameworkProfile = await this.profilePort.loadFramework(profile.framework);
      if (frameworkProfile) {
        sections.push(`<framework_profile framework="${profile.framework}">\n${frameworkProfile}\n</framework_profile>`);
      }
    }

    return sections.length > 0 ? `\n\n${sections.join('\n\n')}\n\n` : '';
  }

  /**
   * Build plan phase prompt for a task by composing: system + {task}/phases/plan/base + rules
   */
  async buildPlanPrompt(
    task: "code" | "design" | "learn",
    context: ProjectContext,
    inputs: TaskInputs,
    mode?: string
  ): Promise<string> {
    const system = await this.getSystemPrompt(task);
    const hasOriginalFiles = Boolean(inputs.originalFiles?.length);
    const basePrefix = `${task}/base`;
    const planPrefix = `${task}/phases/plan`;

    // Build dynamic injections
    const injections = {
      hasOriginalFilesWarning: await this.buildInjection(
        `${planPrefix}/injections/modification-warning`,
        hasOriginalFiles
      ),
      directiveSection: await this.buildInjection(
        `${basePrefix}/injections/directive`,
        Boolean(inputs.directive),
        { content: inputs.directive }
      ),
      originalFilesSection: await this.buildInjection(
        `${basePrefix}/injections/original-files`,
        hasOriginalFiles,
        { files: inputs.originalFiles }
      ),
      currentCodeSection: await this.buildInjection(
        `${basePrefix}/injections/current-code`,
        Boolean(inputs.currentCode),
        { content: this.truncate(inputs.currentCode || '', 1000) }
      ),
      designDocSection: await this.buildInjection(
        `${basePrefix}/injections/design-doc`,
        Boolean(inputs.designDoc),
        { content: this.truncate(inputs.designDoc || '', 800) }
      ),
      prdSpecSection: await this.buildInjection(
        `${basePrefix}/injections/prd-spec`,
        Boolean(inputs.prdSpec),
        { content: this.truncate(inputs.prdSpec || '', 800) }
      ),
      memorySection: await this.buildInjection(
        `${basePrefix}/injections/memory`,
        Boolean(inputs.memory),
        { content: this.truncate(inputs.memory || '', 500) }
      )
    };

    // Render plan base with injections
    const renderedPlanBase = await this.promptPort.render(`${planPrefix}/base`, {
      project: context.project,
      ...injections
    });

    // Load plan rules
    const planRules = await this.promptPort.render(`${planPrefix}/rules`, {});

    // Compose
    return `${system}\n\n${renderedPlanBase}\n\n${planRules}`;
  }

  /**
   * Build execute phase prompt for a task by composing: system + profiles + {task}/phases/execute/* + examples
   */
  async buildExecutePrompt(
    task: "code" | "design" | "learn",
    context: ProjectContext,
    inputs: TaskInputs,
    plan: string,
    mode?: string,
    codebaseProfile?: CodebaseProfile | null
  ): Promise<string> {
    const system = await this.getSystemPrompt(task);
    const profileSection = await this.buildProfileSection(codebaseProfile);
    const hasOriginalFiles = Boolean(inputs.originalFiles?.length);
    const basePrefix = `${task}/base`;
    const execPrefix = `${task}/phases/execute`;

    // Build dynamic injections
    const injections = {
      modificationMode: hasOriginalFiles 
        ? 'MODIFICATION MODE: Copy original, then modify'
        : 'CREATION MODE: Build from scratch',
      originalFilesWarning: await this.buildInjection(
        `${execPrefix}/injections/modification-details`,
        hasOriginalFiles,
        { files: inputs.originalFiles }
      ),
      preOutputCheck: await this.buildInjection(
        `${execPrefix}/injections/pre-output-check`,
        hasOriginalFiles
      ),
      directiveSection: await this.buildInjection(
        `${basePrefix}/injections/directive`,
        Boolean(inputs.directive),
        { content: inputs.directive }
      ),
      currentCodeSection: await this.buildInjection(
        `${basePrefix}/injections/current-code`,
        !hasOriginalFiles && Boolean(inputs.currentCode),
        { content: this.truncate(inputs.currentCode || '', 500) }
      )
    };

    // Render execute base with injections
    const renderedCodeBase = await this.promptPort.render(`${execPrefix}/base`, {
      project: context.project,
      plan,
      ...injections
    });

    // Render execute rules with response injection
    const responseSection = await this.buildInjection(
      `${execPrefix}/injections/response`,
      Boolean(inputs.directive)
    );
    const renderedCodeRules = await this.promptPort.render(`${execPrefix}/rules`, {
      responseSection
    });

    // Load examples
    const examples = await this.promptPort.render(`${basePrefix}/examples`, {});

    // Compose: system + profiles + base + rules + examples
    return `${system}${profileSection}\n\n${renderedCodeBase}\n\n${renderedCodeRules}\n\n${examples}`;
  }

  /**
   * Build design plan prompt: design/base/system + design/phases/plan/*
   */
  async buildDesignPlanPrompt(
    context: ProjectContext,
    inputs: {
      directive?: string | null;
      previousDesign?: string | null;
      prdSpec?: string | null;
    }
  ): Promise<string> {
    const basePrefix = 'design/base';
    const planPrefix = 'design/phases/plan';

    // Load system prompt
    const system = await this.promptPort.render(`${basePrefix}/system`, {});

    // Build injections
    const directiveSection = await this.buildInjection(
      `${basePrefix}/injections/directive`,
      Boolean(inputs.directive),
      { content: inputs.directive }
    );
    const previousDesignSection = await this.buildInjection(
      `${basePrefix}/injections/previous-design`,
      Boolean(inputs.previousDesign),
      { content: this.truncate(inputs.previousDesign || '', 1000) }
    );
    const prdSpecSection = await this.buildInjection(
      `${basePrefix}/injections/prd-spec`,
      Boolean(inputs.prdSpec),
      { content: this.truncate(inputs.prdSpec || '', 800) }
    );

    // Render plan base with injections
    const taskDescription = inputs.directive
      ? 'Revise the previous design based on the feedback above. Address all requested changes while preserving unaffected parts.'
      : 'Create a comprehensive system design based on the PRD/specification above.';

    const renderedPlanBase = await this.promptPort.render(`${planPrefix}/base`, {
      project: context.project,
      directiveSection,
      previousDesignSection,
      prdSpecSection,
      taskDescription
    });

    // Load plan rules
    const planRules = await this.promptPort.render(`${planPrefix}/rules`, {});

    // Compose
    return `${system}\n\n${renderedPlanBase}\n\n${planRules}`;
  }

  /**
   * Build design execute prompt: design/base/system + design/phases/execute/*
   */
  async buildDesignExecutePrompt(
    context: ProjectContext,
    planText: string
  ): Promise<string> {
    const basePrefix = 'design/base';
    const execPrefix = 'design/phases/execute';

    // Load system prompt
    const system = await this.promptPort.render(`${basePrefix}/system`, {});

    // Render execute base with plan
    const renderedExecBase = await this.promptPort.render(`${execPrefix}/base`, {
      planText
    });

    // Load execute rules
    const execRules = await this.promptPort.render(`${execPrefix}/rules`, {});

    // Compose
    return `${system}\n\n${renderedExecBase}\n\n${execRules}`;
  }
}
