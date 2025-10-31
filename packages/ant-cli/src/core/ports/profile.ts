/**
 * Profile Port
 * Interface for loading language and framework profiles
 */

export interface ProfilePort {
  /**
   * Load language-specific guidelines and best practices
   * Returns empty string if profile not found (graceful degradation)
   * 
   * @param language - Language identifier ('typescript', 'javascript', 'golang')
   * @returns Language profile as markdown text for prompt injection
   * 
   * @example
   * const profile = await profilePort.loadLanguage('typescript');
   * // → "## TypeScript Profile\n### Type Safety\n..."
   */
  loadLanguage(language: string): Promise<string>;
  
  /**
   * Load framework-specific patterns and conventions
   * Returns empty string if profile not found (graceful degradation)
   * 
   * @param framework - Framework identifier ('react', 'nextjs', 'react-native', 'gin')
   * @returns Framework profile as markdown text for prompt injection
   * 
   * @example
   * const profile = await profilePort.loadFramework('react');
   * // → "## React Profile\n### Component Patterns\n..."
   */
  loadFramework(framework: string): Promise<string>;
}

