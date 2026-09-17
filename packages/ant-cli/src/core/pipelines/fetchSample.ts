/**
 * The bounded response sample the editor's preview shows (`PipelineFetchSampleNode`).
 * The poller never builds one — this exists so an author can SEE the response
 * and click the array / key / field they mean instead of guessing item-paths.
 * Every axis is capped: depth, array elements, object keys, string length, and
 * the serialized size as a whole, so a runaway source cannot inflate the reply.
 */

import type { PipelineFetchSampleNode } from '@ant/shared';

export interface FetchSampleLimits {
  maxDepth: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxStringChars: number;
  /** Serialized-size ceiling; past it, arrays and objects are cut harder until the sample fits. */
  maxBytes: number;
}

export const FETCH_SAMPLE_LIMITS: FetchSampleLimits = {
  maxDepth: 6,
  maxArrayItems: 3,
  maxObjectKeys: 40,
  maxStringChars: 160,
  maxBytes: 24 * 1024,
};

function prune(value: unknown, depth: number, limits: FetchSampleLimits): PipelineFetchSampleNode {
  if (value === null || value === undefined) return { t: 'null' };
  if (typeof value === 'string') {
    const cut = value.length > limits.maxStringChars;
    return { t: 'str', v: cut ? value.slice(0, limits.maxStringChars) : value, cut };
  }
  if (typeof value === 'number') return { t: 'num', v: Number.isFinite(value) ? value : 0 };
  if (typeof value === 'boolean') return { t: 'bool', v: value };
  if (Array.isArray(value)) {
    if (depth >= limits.maxDepth) return { t: 'arr', items: [], total: value.length };
    return { t: 'arr', items: value.slice(0, limits.maxArrayItems).map((v) => prune(v, depth + 1, limits)), total: value.length };
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (depth >= limits.maxDepth) return { t: 'obj', entries: [], more: keys.length };
    const kept = keys.slice(0, limits.maxObjectKeys);
    return {
      t: 'obj',
      entries: kept.map((k) => [k, prune((value as Record<string, unknown>)[k], depth + 1, limits)] as [string, PipelineFetchSampleNode]),
      more: keys.length - kept.length,
    };
  }
  return { t: 'str', v: String(value), cut: false };
}

/** Prune a parsed JSON body to a sample; tightens the per-node caps until the whole sample fits `maxBytes`. */
export function sampleOf(json: unknown, limits: FetchSampleLimits = FETCH_SAMPLE_LIMITS): PipelineFetchSampleNode {
  let current = { ...limits };
  for (;;) {
    const node = prune(json, 0, current);
    if (Buffer.byteLength(JSON.stringify(node), 'utf-8') <= limits.maxBytes) return node;
    if (current.maxDepth <= 1 && current.maxArrayItems <= 1 && current.maxObjectKeys <= 4) return node;
    current = {
      ...current,
      maxDepth: Math.max(1, current.maxDepth - 1),
      maxArrayItems: Math.max(1, Math.floor(current.maxArrayItems / 2)),
      maxObjectKeys: Math.max(4, Math.floor(current.maxObjectKeys / 2)),
      maxStringChars: Math.max(24, Math.floor(current.maxStringChars / 2)),
    };
  }
}
