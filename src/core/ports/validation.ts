/**
 * Validation Port
 * Interface for code validation
 */

export interface ValidationPort {
  validate(filePath: string, content: string, original?: string): Promise<{ violations: string[]; score: number }>;
}

