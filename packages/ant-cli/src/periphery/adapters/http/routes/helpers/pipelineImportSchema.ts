/**
 * Body contract for `POST /api/definitions/pipelines/import`.
 *
 * The route carries file TEXT, so it owns its own field cap: an authenticated
 * route is not a budgeted one. Over-budget yaml answers a typed 413 through the
 * `httpStatus` issue param `validateBody` already understands, rather than a
 * generic 400 the client cannot tell from a malformed definition.
 */

import { z } from 'zod';
import { PIPELINE_YAML_MAX_BYTES } from '@ant/shared';

export const PipelineImportBodySchema = z.object({
  yaml: z
    .string()
    .min(1, 'body.yaml (pipeline.yaml contents) is required')
    .superRefine((value, ctx) => {
      // Bytes, not characters — a non-Latin definition is legitimate and its
      // UTF-8 length is what the process actually holds.
      const bytes = Buffer.byteLength(value, 'utf-8');
      if (bytes > PIPELINE_YAML_MAX_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: `pipeline.yaml is ${bytes} bytes, over the ${PIPELINE_YAML_MAX_BYTES} byte limit`,
          params: { code: 'PIPELINE_YAML_TOO_LARGE', httpStatus: 413 },
        });
      }
    }),
  id: z.string().max(200).optional(),
  overwrite: z.boolean().optional(),
});
