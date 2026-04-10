/**
 * Request Body Validation Middleware
 * 
 * Uses Zod schemas to validate req.body before route handlers execute.
 * Returns 400 with validation errors if schema fails.
 * 
 * Addresses CWE-20 (Improper Input Validation)
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

/**
 * Express middleware that validates req.body against a Zod schema.
 * On failure, returns 400 with field-level error details.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
      return;
    }
    // Replace body with parsed (coerced/defaulted) values
    req.body = result.data;
    next();
  };
}

// ========================================
// Schemas for critical routes
// ========================================

/**
 * POST /projects/:id/features/:feature/execute
 */
export const executeJobSchema = z.object({
  task: z.enum(['design', 'code', 'learn', 'plan', 'visual']),
  agent: z.string().optional(),
  mode: z.string().optional(),
  language: z.string().optional(),
  overrideDirective: z.string().optional(),
  chatSource: z.boolean().optional(),
  skipTriage: z.boolean().optional(),
  enableEvaluation: z.boolean().optional(),
  uiDocumentContext: z.any().optional(),
  designContext: z.any().optional(),
  actionMetadata: z.object({
    intent: z.string().optional(),
    target: z.array(z.string()).optional(),
    basis: z.string().optional(),
    refs: z.array(z.string()).optional(),
    context: z.array(z.string()).optional(),
    language: z.string().optional(),
  }).optional(),
}).passthrough();

/**
 * POST /projects
 */
export const createProjectSchema = z.object({
  id: z.string().min(1, 'Project ID is required').max(200),
  description: z.string().max(5000).optional(),
}).passthrough();

/**
 * POST /projects/:id/features/:feature/chat/user-message
 */
export const chatUserMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(100000),
  jobId: z.string().optional(),
}).passthrough();
