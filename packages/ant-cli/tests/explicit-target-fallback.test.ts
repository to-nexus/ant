/**
 * dusk-mounding-pilot regression — explicit-branch default target fallback.
 *
 * The failure: a chat-driven `gen-plan` submit landed in BE detect with
 * `actionMetadata: { intent: 'gen-plan', explicit: true, target: undefined }`.
 * The explicit branch trusted `metadata.target` verbatim, which produced
 * `RAC.target = undefined`. That value rode through the session checkpoint
 * and back into resume; the generate node's `buildSystemPrompt` then
 * dropped the "Target Path" section entirely (`{{#if targetPath}}` gate),
 * the LLM hallucinated `outputs/documents/prd.md`, and the disk writer
 * silently skipped because `targetRelPath` was undefined. 7.7KB of PRD
 * body survived only inside `chat.jsonl`.
 *
 * The fix routes the explicit branch through `getDefaultTargetPaths`
 * (action-config-matrix SSOT) so every `kind: 'generate'` intent inherits
 * the same canonical target the FE's `ActionConfigView` produces. This
 * test pins both layers:
 *
 *   1. Pure unit on `getDefaultTargetPaths` for matrix coverage —
 *      generate w/ outputs / generate w/o outputs / non-generate.
 *   2. Integration on `createDetectNode` — wires the helper into the
 *      explicit branch and re-asserts on the populated `RAC.target` for
 *      the regression-trigger intent (`gen-plan`) and a representative
 *      multi-output peer (`gen-sys-fe`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDefaultTargetPaths } from '@ant/shared';
import type { ActionMetadata } from '@ant/shared';
import { createDetectNode } from '../src/agents/common/graph/nodes/detect/index.js';
import type { DetectStrategy, DetectableState } from '../src/agents/common/graph/nodes/detect/types.js';
import { isSafeStagingPath } from '../src/agents/planner/graph/plan/nodes/generate/index.js';

// ============================================
// 1) Pure unit — matrix-derived defaults
// ============================================

describe('getDefaultTargetPaths — matrix-derived defaults', () => {
  it('gen-plan → ["inputs/sources/prd.md"] (single non-pattern output)', () => {
    expect(getDefaultTargetPaths('gen-plan')).toEqual(['inputs/sources/prd.md']);
  });

  it('gen-sys-fe → expanded fe-system pattern under SYS_DIR', () => {
    expect(getDefaultTargetPaths('gen-sys-fe')).toEqual([
      'outputs/design/system/fe-system-*.md',
    ]);
  });

  it('gen-sys-full → multi-output expansion preserves matrix order', () => {
    expect(getDefaultTargetPaths('gen-sys-full')).toEqual([
      'outputs/design/system/fe-system-*.md',
      'outputs/design/system/be-system-*.md',
      'outputs/design/system/api-contract-*.md',
    ]);
  });

  it('gen-visual-logo → falls back to dir when outputs is empty', () => {
    // Visual gen intents define `outputs: []` because the asset filename
    // is decided at runtime by the model. The matrix dir is still the
    // canonical staging location.
    expect(getDefaultTargetPaths('gen-visual-logo')).toEqual(['inputs/assets/gen']);
  });

  it('rev-plan → undefined (kind: revise has no synthesisable target)', () => {
    expect(getDefaultTargetPaths('rev-plan')).toBeUndefined();
  });

  it('gen-code-sys → undefined (kind: codebase has no file target)', () => {
    expect(getDefaultTargetPaths('gen-code-sys')).toBeUndefined();
  });

  it('explain-plan → undefined (kind: chat-only)', () => {
    expect(getDefaultTargetPaths('explain-plan')).toBeUndefined();
  });
});

// ============================================
// 2) Integration — detect node explicit branch
// ============================================

function makeNoopStrategy(): DetectStrategy<DetectableState> {
  return {
    // The explicit branch never hits run/onResume/isAwaitingInput, but
    // we still need a non-null strategy to instantiate the node.
    async run() {
      throw new Error('strategy.run should not be called on explicit path');
    },
  };
}

function makeState(metadata: ActionMetadata, featurePath: string): DetectableState {
  return {
    featurePath,
    context: { featurePath },
    actionMetadata: metadata,
  };
}

describe('createDetectNode — explicit branch default-target invariant', () => {
  let featurePath: string;

  beforeAll(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-detect-explicit-'));
    // No files needed; the explicit branch with empty refs/context never
    // touches the filesystem beyond resolveFeaturePath.
  });

  afterAll(() => {
    fs.rmSync(featurePath, { recursive: true, force: true });
  });

  it('gen-plan + explicit:true + target:undefined → RAC.target = ["inputs/sources/prd.md"]', async () => {
    const node = createDetectNode(makeNoopStrategy());
    const state = makeState(
      { intent: 'gen-plan', explicit: true, domain: 'game' },
      featurePath,
    );

    const result = await node(state);

    expect(result.resolvedAction).toBeDefined();
    expect(result.resolvedAction!.intent).toBe('gen-plan');
    expect(result.resolvedAction!.source).toBe('explicit');
    expect(result.resolvedAction!.target).toEqual(['inputs/sources/prd.md']);
    // Sanity: hasExplicitFields should now be true because target was
    // populated by the fallback. Downstream prompts gate `{{#if
    // targetPath}}` on this — proving the regression channel is closed.
    expect(result.resolvedAction!.hasExplicitFields).toBe(true);
  });

  it('explicit-supplied target wins over the matrix default (no clobbering)', async () => {
    const node = createDetectNode(makeNoopStrategy());
    const userTarget = ['inputs/sources/custom-prd.md'];
    const state = makeState(
      { intent: 'gen-plan', explicit: true, target: userTarget, domain: 'service' },
      featurePath,
    );

    const result = await node(state);

    expect(result.resolvedAction!.target).toEqual(userTarget);
  });

  it('gen-sys-fe + explicit:true + target:undefined → matrix-expanded fe-system path', async () => {
    const node = createDetectNode(makeNoopStrategy());
    const state = makeState(
      { intent: 'gen-sys-fe', explicit: true, domain: 'service' },
      featurePath,
    );

    const result = await node(state);

    expect(result.resolvedAction!.target).toEqual([
      'outputs/design/system/fe-system-*.md',
    ]);
  });

  it('rev-plan (kind: revise) + target:undefined → RAC.target stays undefined', async () => {
    // Revise intents have no synthesisable file target — the FE picks the
    // ref-as-target via locked refsSingleSelect. Fallback must NOT invent
    // a path here.
    const node = createDetectNode(makeNoopStrategy());
    const state = makeState(
      { intent: 'rev-plan', explicit: true, domain: 'service' },
      featurePath,
    );

    const result = await node(state);

    expect(result.resolvedAction!.target).toBeUndefined();
  });
});

// ============================================
// 3) Writer fallback — `isSafeStagingPath` whitelist
// ============================================
//
// Even with the detect-branch fallback in place, the writer in
// `planner/.../generate/index.ts` keeps a defence-in-depth fallback that
// uses the LLM-emitted `<file>` path when RAC.target is empty. The
// safety predicate must:
//
//   - Allow only feature-relative paths under whitelisted prefixes.
//   - Reject absolute paths (no `/etc/...` escapes).
//   - Reject any normalised form that climbs out of the feature root.
//
// The original dusk-mounding-pilot LLM emitted
// `outputs/documents/prd.md` — under the `outputs/` prefix → currently
// permitted. That is intentional: the writer must not silently drop
// data, even into a non-canonical-but-feature-local location.
//
describe('isSafeStagingPath — writer fallback whitelist', () => {
  it('allows canonical inputs/sources path', () => {
    expect(isSafeStagingPath('inputs/sources/prd.md')).toBe(true);
  });

  it('allows canonical outputs paths (canonical and ad-hoc subdirs)', () => {
    expect(isSafeStagingPath('outputs/design/system/fe-system-main.md')).toBe(true);
    // The dusk-mounding-pilot LLM-emitted path itself — a non-canonical
    // sibling of outputs/ — must still be admitted so the body lands
    // somewhere instead of vanishing. Operators can grep `outputs/**`
    // to find recoverable artifacts after a rare regression.
    expect(isSafeStagingPath('outputs/documents/prd.md')).toBe(true);
  });

  it('rejects absolute paths', () => {
    expect(isSafeStagingPath('/etc/passwd')).toBe(false);
    expect(isSafeStagingPath('/Users/probe/dev/ant')).toBe(false);
  });

  it('rejects paths that traverse out of the feature root', () => {
    expect(isSafeStagingPath('../escape/prd.md')).toBe(false);
    expect(isSafeStagingPath('inputs/sources/../../escape/prd.md')).toBe(false);
    expect(isSafeStagingPath('outputs/../../etc/passwd')).toBe(false);
  });

  it('rejects paths outside whitelisted prefixes', () => {
    expect(isSafeStagingPath('sessions/planner/plan.json')).toBe(false);
    expect(isSafeStagingPath('arbitrary/dir/file.md')).toBe(false);
    expect(isSafeStagingPath('prd.md')).toBe(false);
  });

  it('rejects empty / non-string inputs', () => {
    expect(isSafeStagingPath('')).toBe(false);
    // @ts-expect-error — runtime guard keeps the predicate total.
    expect(isSafeStagingPath(undefined)).toBe(false);
    // @ts-expect-error
    expect(isSafeStagingPath(null)).toBe(false);
  });
});
