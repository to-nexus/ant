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
 * SessionRunInput Schema
 */
export const SessionRunInputSchema = z.object({
  type: z.enum(['text', 'file', 'directive', 'design']),
  source: z.string().optional(),
  summary: z.string().max(200),
  hash: z.string().optional(),
  size: z.number().optional(),
});

/**
 * SessionRunOutput Schema
 */
export const SessionRunOutputSchema = z.object({
  // Design task outputs
  designPath: z.string().optional(),
  planSummary: z.string().optional(),
  decisionCount: z.number().optional(),
  
  // Code task outputs
  branch: z.string().optional(),
  filesWritten: z.number().optional(),
  files: z.array(z.string()).optional(),
  modifications: z.array(z.string()).optional(),
  
  // Common outputs
  reportPath: z.string().optional(),
  error: z.string().optional(),
}).passthrough();

/**
 * SessionRun Schema
 */
export const SessionRunSchema = z.object({
  runId: z.number().int().positive(),
  job: z.enum(['design', 'code', 'learn', 'review', 'plan', 'doc']),
  timestamp: z.string().datetime(),
  input: SessionRunInputSchema,
  output: SessionRunOutputSchema,
  reference: z.object({
    runId: z.number().int().positive()
  }).optional()
});

/**
 * SessionArtifacts Schema
 */
export const SessionArtifactsSchema = z.object({
  latestDesign: z.string().optional(),
  activeBranch: z.string().optional(),
  keyDecisions: z.array(z.string()).optional(),
}).passthrough();

/**
 * SessionState Schema
 */
export const SessionStateSchema = z.object({
  taskQueue: z.array(z.any()).optional(),
  currentTask: z.any().optional(),
  completedTasks: z.array(z.string()).optional(),
  completedTasksDetails: z.array(z.any()).optional(),
  retries: z.number().optional(),
  maxRetries: z.number().optional(),
  previousAttempts: z.array(z.any()).optional(),
  enforcementHistory: z.array(z.any()).optional(),
  lastViolations: z.array(z.any()).optional(),
  previousFileCount: z.number().optional(),
  resolvedCategories: z.array(z.string()).optional(),
}).passthrough();

/**
 * Session Schema
 */
export const SessionSchema = z.object({
  sessionId: z.string().min(1),
  project: z.string().min(1),
  feature: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  runs: z.array(SessionRunSchema),
  artifacts: SessionArtifactsSchema,
  state: SessionStateSchema.optional(),
});

/**
 * Type inference from schemas
 * (These should match the interfaces in core/types.ts)
 */
export type SessionZod = z.infer<typeof SessionSchema>;
export type SessionRunZod = z.infer<typeof SessionRunSchema>;
export type SessionRunInputZod = z.infer<typeof SessionRunInputSchema>;
export type SessionRunOutputZod = z.infer<typeof SessionRunOutputSchema>;
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
