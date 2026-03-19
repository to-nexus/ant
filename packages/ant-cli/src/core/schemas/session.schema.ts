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
 * SessionTurnInput Schema
 */
export const SessionTurnInputSchema = z.object({
  type: z.enum(['text', 'file', 'directive', 'design']),
  source: z.string().optional(),
  summary: z.string().max(200),
  hash: z.string().optional(),
  size: z.number().optional(),
});

/**
 * SessionTurnOutput Schema
 */
export const SessionTurnOutputSchema = z.object({
  // Design task outputs
  designPath: z.string().optional(),
  planSummary: z.string().optional(),    // Summary instead of full plan
  decisionCount: z.number().optional(),  // Count instead of full list
  
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
  job: z.enum(['design', 'code', 'learn', 'review', 'plan', 'doc']),
  timestamp: z.string().datetime(),
  input: SessionTurnInputSchema,
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
  activeBranch: z.string().optional(),
  keyDecisions: z.array(z.string()).optional(),
}).passthrough(); // Allow additional properties

/**
 * SessionState Schema
 * ✅ Execution state for resuming after recursion limit
 */
export const SessionStateSchema = z.object({
  taskQueue: z.array(z.any()).optional(),
  currentTask: z.any().optional(),
  completedTasks: z.array(z.string()).optional(),
  completedTasksDetails: z.array(z.any()).optional(), // ✅ NEW: Full task objects
  retries: z.number().optional(),
  maxRetries: z.number().optional(),
  previousAttempts: z.array(z.any()).optional(),
  enforcementHistory: z.array(z.any()).optional(),
  lastViolations: z.array(z.any()).optional(),
  previousFileCount: z.number().optional(),
  resolvedCategories: z.array(z.string()).optional(),
}).passthrough(); // Allow additional fields for flexibility

/**
 * Session Schema
 */
export const SessionSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().min(1),
  feature: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  turns: z.array(SessionTurnSchema),
  artifacts: SessionArtifactsSchema,
  state: SessionStateSchema.optional(),  // ✅ Added for resuming
});

/**
 * Type inference from schemas
 * (These should match the interfaces in core/types.ts)
 */
export type SessionZod = z.infer<typeof SessionSchema>;
export type SessionTurnZod = z.infer<typeof SessionTurnSchema>;
export type SessionTurnInputZod = z.infer<typeof SessionTurnInputSchema>;
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

