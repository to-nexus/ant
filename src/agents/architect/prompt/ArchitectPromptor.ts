import { PromptPort } from "../../../core/ports";
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
 * Orchestrates modular templates from templates/ directory
 */
export class ArchitectPromptor {
  private systemPromptCache: string | null = null;

  constructor(private promptPort: PromptPort) {}

  /**
   * Load and cache system prompt (shared between plan and code phases)
   */
  private async getSystemPrompt(): Promise<string> {
    if (!this.systemPromptCache) {
      this.systemPromptCache = await this.promptPort.render("common/system", {});
    }
    return this.systemPromptCache;
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
   * Build plan phase prompt by composing: system + phases/plan/base + phases/plan/rules
   */
  async buildUniversalPlanPrompt(context: ProjectContext, inputs: TaskInputs): Promise<string> {
    const system = await this.getSystemPrompt();
    const hasOriginalFiles = Boolean(inputs.originalFiles?.length);

    // Build dynamic injections
    const injections = {
      hasOriginalFilesWarning: await this.buildInjection(
        "phases/plan/injections/modification-warning",
        hasOriginalFiles
      ),
      directiveSection: await this.buildInjection(
        "common/injections/directive",
        Boolean(inputs.directive),
        { content: inputs.directive }
      ),
      originalFilesSection: await this.buildInjection(
        "common/injections/original-files",
        hasOriginalFiles,
        { files: inputs.originalFiles }
      ),
      currentCodeSection: await this.buildInjection(
        "common/injections/current-code",
        Boolean(inputs.currentCode),
        { content: this.truncate(inputs.currentCode || '', 1000) }
      ),
      designDocSection: await this.buildInjection(
        "common/injections/design-doc",
        Boolean(inputs.designDoc),
        { content: this.truncate(inputs.designDoc || '', 800) }
      ),
      prdSpecSection: await this.buildInjection(
        "common/injections/prd-spec",
        Boolean(inputs.prdSpec),
        { content: this.truncate(inputs.prdSpec || '', 800) }
      ),
      memorySection: await this.buildInjection(
        "common/injections/memory",
        Boolean(inputs.memory),
        { content: this.truncate(inputs.memory || '', 500) }
      )
    };

    // Render phases/plan/base with injections
    const renderedPlanBase = await this.promptPort.render("phases/plan/base", {
      project: context.project,
      ...injections
    });

    // Load phases/plan/rules
    const planRules = await this.promptPort.render("phases/plan/rules", {});

    // Compose
    return `${system}\n\n${renderedPlanBase}\n\n${planRules}`;
  }

  /**
   * Build code phase prompt by composing: system + phases/code/base + phases/code/rules + examples
   */
  async buildUniversalCodePrompt(context: ProjectContext, inputs: TaskInputs, plan: string): Promise<string> {
    const system = await this.getSystemPrompt();
    const hasOriginalFiles = Boolean(inputs.originalFiles?.length);

    // Build dynamic injections
    const injections = {
      modificationMode: hasOriginalFiles 
        ? 'MODIFICATION MODE: Copy original, then modify'
        : 'CREATION MODE: Build from scratch',
      originalFilesWarning: await this.buildInjection(
        "phases/code/injections/modification-details",
        hasOriginalFiles,
        { files: inputs.originalFiles }
      ),
      preOutputCheck: await this.buildInjection(
        "phases/code/injections/pre-output-check",
        hasOriginalFiles
      ),
      directiveSection: await this.buildInjection(
        "common/injections/directive",
        Boolean(inputs.directive),
        { content: inputs.directive }
      ),
      currentCodeSection: await this.buildInjection(
        "common/injections/current-code",
        !hasOriginalFiles && Boolean(inputs.currentCode),
        { content: this.truncate(inputs.currentCode || '', 500) }
      )
    };

    // Render phases/code/base with injections
    const renderedCodeBase = await this.promptPort.render("phases/code/base", {
      project: context.project,
      plan,
      ...injections
    });

    // Render phases/code/rules with response injection
    const responseSection = await this.buildInjection(
      "phases/code/injections/response",
      Boolean(inputs.directive)
    );
    const renderedCodeRules = await this.promptPort.render("phases/code/rules", {
      responseSection
    });

    // Load examples
    const examples = await this.promptPort.render("common/examples", {});

    // Compose
    return `${system}\n\n${renderedCodeBase}\n\n${renderedCodeRules}\n\n${examples}`;
  }
}
