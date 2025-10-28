import { z } from "zod";

/**
 * Session Schemas (Zod)
 * 
 * Provides runtime validation for session data.
 * Benefits:
 * - Runtime type checking
 * - Parsing with validation
 * - Clear error messages
 * - Type inference (TypeScript types from schemas)
 */

/**
 * SessionTurnOutput Schema
 */
export const SessionTurnOutputSchema = z.object({
  // Design task outputs
  designPath: z.string().optional(),
  planText: z.string().optional(),
  decisions: z.array(z.string()).optional(),
  
  // Code task outputs
  branch: z.string().optional(),
  filesWritten: z.number().optional(),
  files: z.array(z.string()).optional(),
  modifications: z.array(z.string()).optional(),
  
  // Common outputs
  reportPath: z.string().optional(),
  error: z.string().optional(),
}).passthrough(); // Allow additional properties for extensibility

/**
 * SessionTurn Schema
 */
export const SessionTurnSchema = z.object({
  turnId: z.number().int().positive(),
  task: z.enum(['design', 'code', 'learn', 'review', 'plan', 'doc']),
  timestamp: z.string().datetime(),
  input: z.string(),
  output: SessionTurnOutputSchema,
  reference: z.object({
    turnId: z.number().int().positive()
  }).optional()
});

/**
 * SessionArtifacts Schema
 */
export const SessionArtifactsSchema = z.object({
  latestDesign: z.string().optional(),
  latestPlan: z.string().optional(),
  activeBranch: z.string().optional(),
  keyDecisions: z.array(z.string()).optional(),
}).passthrough(); // Allow additional properties

/**
 * Session Schema
 */
export const SessionSchema = z.object({
  sessionId: z.string().uuid(),
  project: z.string().min(1),
  feature: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  turns: z.array(SessionTurnSchema),
  artifacts: SessionArtifactsSchema
});

/**
 * Type inference from schemas
 * (These should match the interfaces in core/types.ts)
 */
export type SessionZod = z.infer<typeof SessionSchema>;
export type SessionTurnZod = z.infer<typeof SessionTurnSchema>;
export type SessionTurnOutputZod = z.infer<typeof SessionTurnOutputSchema>;
export type SessionArtifactsZod = z.infer<typeof SessionArtifactsSchema>;

/**
 * Helper: Parse and validate session data
 */
export function parseSession(data: unknown): SessionZod {
  return SessionSchema.parse(data);
}

/**
 * Helper: Safely parse session data (returns null on error)
 */
export function safeParseSession(data: unknown): SessionZod | null {
  const result = SessionSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Helper: Validate session data without parsing
 */
export function validateSession(data: unknown): boolean {
  return SessionSchema.safeParse(data).success;
}

