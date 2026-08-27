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
import { DIRECTIVE_MAX_CHARS } from '../routes/helpers/submitUserTurn';
import {
  ACTION_METADATA_MAX_PATHS,
  CHAT_ERROR_MESSAGE_MAX_CHARS,
  CHAT_ERROR_DETAILS_MAX_CHARS,
  CHOICE_ID_MAX_CHARS,
  CHOICE_LABEL_MAX_CHARS,
} from '@ant/shared';

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
 * A RAC artifact selection: a path RELATIVE to the caller's own feature root.
 *
 * `refs` / `context` reach `loadResolvedArtifacts`, which reads the file and
 * injects its content into the decompose prompt — so an absolute path or a
 * `..` segment would pull another workspace's files into the caller's job (and
 * on to the model provider). Normal selections (`plan/prd.md`,
 * `architecture/spec/`) are unaffected. The sink enforces the same rule, so a
 * queued or resumed job cannot bypass this by pre-dating the schema.
 */
const racPathSchema = z
  .string()
  .max(1024)
  .refine(
    p =>
      !p.startsWith('/') &&
      !/^[A-Za-z]:[\\/]/.test(p) &&
      !p.split(/[\\/]/).includes('..') &&
      !p.includes('\0'),
    { message: 'Artifact paths must be relative to the feature root (no absolute paths, no "..")' },
  );

/** A RAC slot: every entry path-checked, and the slot itself count-bounded. */
const racPathListSchema = z.array(racPathSchema).max(ACTION_METADATA_MAX_PATHS);

/**
 * `actionMetadata` carries the resolved-action context (intent + artifact
 * selection) the FE computed. Only the path-bearing fields are constrained —
 * the rest stays open so the RAC shape can evolve without a schema change.
 *
 * All THREE slots are constrained, `target` included. It used to be absent from
 * this object and rode `.passthrough()` completely unchecked — no traversal
 * test, no length cap, no count — while still reaching both the durable line and
 * the folder-compression walk (M-NEW-029). And the count matters as much as the
 * per-entry length: each entry is an independent root for that walk.
 */
const actionMetadataSchema = z
  .object({
    target: racPathListSchema.optional(),
    refs: racPathListSchema.optional(),
    context: racPathListSchema.optional(),
  })
  .passthrough();

/**
 * POST /projects/:id/features/:feature/execute
 */
export const executeJobSchema = z.object({
  task: z.enum(['design', 'code', 'learn', 'plan', 'visual', 'universal']),
  agent: z.string().optional(),
  /** universal only — `{agentId}/{jobId}` custom job definition ref. */
  customJobRef: z.string().optional(),
  mode: z.string().optional(),
  language: z.string().optional(),
  /**
   * Deliberately uncapped HERE. The ceiling lives with the durable turn writer
   * (`directiveTooLarge`), which the route applies before the append so all
   * three job-start directives — execute / inline-ask / continue — answer the
   * same typed 413 (M-NEW-029). A `.max()` here would shadow that with a
   * generic 400 and give the axis two owners.
   */
  overrideDirective: z.string().optional(),
  chatSource: z.boolean().optional(),
  skipTriage: z.boolean().optional(),
  enableEvaluation: z.boolean().optional(),
  uiDocumentContext: z.any().optional(),
  designContext: z.any().optional(),
  actionMetadata: actionMetadataSchema.optional(),
  /** chat SSOT §6 — pre-allocated turn id from /chat/user-message. */
  seedTurnId: z.string().optional(),
  /** universal only — explicit `@intent:` mentions (catalog-validated at accept). */
  intents: z.array(z.string().max(1024)).max(ACTION_METADATA_MAX_PATHS).optional(),
  /** universal only — explicit `@ctx:` artifact paths (existence-checked at accept). */
  context: racPathListSchema.optional(),
  /** universal only — `@plan` per-turn plan mode (adopted only when strictly true). */
  plan: z.boolean().optional(),
}).passthrough();

/**
 * POST /projects
 */
export const createProjectSchema = z.object({
  id: z.string().min(1, 'Project ID is required').max(200),
  description: z.string().max(5000).optional(),
  /** Workspace domain — persisted into `config.json` at creation; defaults to 'service'. */
  domain: z.enum(['service', 'game']).optional(),
}).passthrough();

/**
 * POST /projects/:id/features/:feature/chat/user-message
 *
 * `jobType` is the PERMANENT stamp on the durable `user_turn` line — the
 * worker's `recordUserTurn` copy dedupes by turnId and never corrects it,
 * so the submit-time value is what the turn is filed under forever.
 *
 * Left `.optional()` with NO default on purpose: an unset value must reach
 * `ensureSubmitUserTurn` as `undefined` so the universal probe and the
 * ChatService default still apply. A schema-level default would silently
 * overwrite both for every client that omits the field.
 */
export const chatUserMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(DIRECTIVE_MAX_CHARS),
  jobType: z
    .enum(['code', 'design', 'plan', 'learn', 'ask', 'inline-ask', 'visual', 'universal'])
    .optional(),
  actionMetadata: actionMetadataSchema.optional(),
}).passthrough();

/**
 * POST /projects/:id/features/:feature/chat/job-error
 *
 * Every field lands verbatim in a durable `assistant_message` line, so each one
 * is a ceiling of its own. `errorDetails` is checked on its SERIALIZED form
 * because that — not the object — is what the route concatenates into the line.
 *
 * Fields are `.optional()` here on purpose: PRESENCE is the route's 400 (with its
 * own message, which clients match on), SIZE is this schema's. One axis, one
 * owner — the same split `overrideDirective` uses above.
 */
export const chatJobErrorSchema = z.object({
  jobId: z.string().max(CHOICE_ID_MAX_CHARS).optional(),
  errorMessage: z.string().max(CHAT_ERROR_MESSAGE_MAX_CHARS).optional(),
  errorDetails: z
    .unknown()
    .refine(
      (v) => v === undefined || v === null || JSON.stringify(v ?? null).length <= CHAT_ERROR_DETAILS_MAX_CHARS,
      { message: `errorDetails must serialize to at most ${CHAT_ERROR_DETAILS_MAX_CHARS} characters` },
    )
    .optional(),
}).passthrough();

/**
 * POST /projects/:id/features/:feature/chat/choice-resolved
 *
 * `answer` is deliberately NOT capped here: the route applies the shared
 * directive ceiling to its serialized form and answers the typed 413 the FE
 * already handles. A `.max()` here would shadow that with a generic 400 and
 * give the axis two owners — the same reasoning as `overrideDirective` above.
 *
 * `evalType` becomes a directory segment under `meta/evals/`, so it is
 * constrained to a single safe segment rather than merely length-capped.
 */
export const choiceResolvedSchema = z.object({
  cardId: z.string().max(CHOICE_ID_MAX_CHARS).optional(),
  choiceSelected: z.string().max(CHOICE_ID_MAX_CHARS).optional(),
  resolvedLabel: z.string().max(CHOICE_LABEL_MAX_CHARS).optional(),
  answer: z
    .object({
      evalType: z
        .string()
        .max(64)
        .regex(/^[A-Za-z0-9._-]+$/, 'evalType must be a single path segment')
        .refine((v) => v !== '.' && v !== '..', { message: 'evalType must be a single path segment' })
        .optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();
