/**
 * PromptRenderer - Template variable substitution
 * Periphery adapter for rendering templates with dynamic values
 */
export class PromptRenderer {
  /**
   * Render template string by replacing {{variable}} placeholders
   */
  render(template: string, vars: Record<string, string | null | undefined>): string {
    return Object.keys(vars).reduce((acc, key) => {
      const val = (vars[key] ?? "").toString();
      return acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
    }, template);
  }
}

