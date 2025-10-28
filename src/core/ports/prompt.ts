/**
 * Prompt Port
 * Interface for prompt template loading and rendering
 */

export interface PromptPort {
  /**
   * Load template and render with variables
   * @param templateName - Template file name (e.g., 'plan-base', 'code-rules')
   * @param vars - Variables to substitute in {{variable}} format
   * @returns Rendered template string
   */
  render(templateName: string, vars: Record<string, any>): Promise<string>;
}

