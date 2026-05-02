/**
 * `_shared/verify/cacheReplay` — pure detector for build-tool cache replay
 * markers in gate command output.
 *
 * Many monorepo build tools (Turbo, Nx, Lerna) skip task re-execution and
 * "replay" the prior task's logs when their input hash hasn't changed.
 * The shell exit code is 0 in both real-execution and replay paths, so a
 * verification gate that consumes only `exitCode === 0` cannot tell
 * whether the gate actually validated the post-fix state. The gleam-
 * growing-grace post-mortem documented this hole — `pnpm build` with
 * `cache hit, replaying logs` was treated as a passing gate even though
 * the prior log pre-dated the applied fix.
 *
 * This helper extracts the signal so the gate runner / plan prompt can
 * mark a replayed gate observation as untrusted and re-run with a
 * cache-bypass flag.
 *
 * Detection is conservative: the function returns `replayed: true` ONLY
 * when a known marker matches. Unknown tools return
 * `{ replayed: false, tool: null }` — false negatives are acceptable
 * (they fall back to the existing exit-code gate), false positives are
 * not (they would force unnecessary rebuilds).
 */

export type CacheReplayTool = 'turbo' | 'nx' | 'lerna';

export interface CacheReplayResult {
  replayed: boolean;
  tool: CacheReplayTool | null;
}

const PATTERNS: ReadonlyArray<{ tool: CacheReplayTool; pattern: RegExp }> = [
  // turbo: "@scope/pkg:task: cache hit, replaying logs <hash>"
  { tool: 'turbo', pattern: /cache hit, replaying logs/i },
  // nx: "Existing outputs match the cache, left as is."
  // and the "[local cache]" / "[remote cache]" annotation
  { tool: 'nx', pattern: /\[local cache\]|\[remote cache\]|existing outputs match the cache/i },
  // lerna: "lerna info from cache" / "cache hit"
  { tool: 'lerna', pattern: /lerna info from cache|cache hit(?!,)/i },
];

export function detectCacheReplay(stdout: string | undefined | null): CacheReplayResult {
  if (!stdout) return { replayed: false, tool: null };
  for (const { tool, pattern } of PATTERNS) {
    if (pattern.test(stdout)) {
      return { replayed: true, tool };
    }
  }
  return { replayed: false, tool: null };
}
