/**
 * computeFileMeta — single source of truth for file meta evaluation.
 *
 * Every surface that ships a FileResourceMeta (HTTP GET/PUT, REST file tree,
 * SSE file tree broadcaster) routes meta computation through this helper.
 * Divergent inline logic is forbidden.
 */

import type { FileResourceMeta } from '@ant/shared';
import { getTemplateReason } from './templateDetector';

export interface ComputeFileMetaArgs {
  relativePath: string;
  content: string | null;
  size: number;
  mtime: number;
}

/**
 * Files under `inputs/sources/` are evaluated for template/empty state;
 * other paths report `isTemplate=false` unconditionally.
 */
const TEMPLATE_EVAL_PREFIX = 'inputs/sources/';

export function computeFileMeta(args: ComputeFileMetaArgs): FileResourceMeta {
  const shouldEvaluate = args.relativePath.startsWith(TEMPLATE_EVAL_PREFIX);
  if (!shouldEvaluate || args.content === null) {
    return {
      size: args.size,
      mtime: args.mtime,
      isTemplate: false,
      templateReason: null,
    };
  }

  const result = getTemplateReason(args.content, args.size);
  if (result.reason == null) {
    return {
      size: args.size,
      mtime: args.mtime,
      isTemplate: false,
      templateReason: null,
    };
  }

  return {
    size: args.size,
    mtime: args.mtime,
    isTemplate: true,
    templateReason: result.reason,
    templateContentLength: result.contentLength,
    templateThreshold: result.threshold,
  };
}

export function shouldEvaluateTemplate(relativePath: string): boolean {
  return relativePath.startsWith(TEMPLATE_EVAL_PREFIX);
}
