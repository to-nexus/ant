import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planArtifactAutoExpand } from '../../src/shared/utils/artifactExpansion';

const sectionPath = resolve(
  __dirname,
  '../../src/presentation/components/ArtifactsPanel/ArtifactsSection.tsx',
);
const panelPath = resolve(__dirname, '../../src/presentation/components/ArtifactsPanel.tsx');
const uiSlicePath = resolve(__dirname, '../../src/domain/store/slices/uiSlice.ts');
const uiTypesPath = resolve(__dirname, '../../src/domain/store/types.ts');

const sectionSource = readFileSync(sectionPath, 'utf-8');
const panelSource = readFileSync(panelPath, 'utf-8');
const uiSliceSource = readFileSync(uiSlicePath, 'utf-8');
const uiTypesSource = readFileSync(uiTypesPath, 'utf-8');

/**
 * Static SSOT guards for the artifact-tree expand state.
 *
 * Phase 1 fix targeted the spotlight `useEffect` that reset `expandedDirs`
 * whenever the parent rebuilt the `nodes` array (which happened on every
 * store change). Phase 2 lifted `expandedArtifactDirs` to the zustand
 * uiSlice so transient remounts of ArtifactsSection (e.g. when
 * ExplorerPanel's `connectionStatus` conditional render flickers) no
 * longer wipe the user's expansion. These tests lock both fixes:
 *
 *  1. ArtifactsSection no longer owns the expandedDirs useState — every
 *     mutation goes through ref-stable store actions with no-op guards.
 *  2. The spotlight effect deps stay free of `nodes` so data ref churn
 *     does not re-fire it.
 *  3. ArtifactsPanel's derived values feeding into <ArtifactsSection>
 *     stay ref-stable across re-renders (useMemo / useCallback).
 *  4. The uiSlice exposes the lifted channel + its mutation API.
 */
describe('ArtifactsSection — expandedDirs SSOT', () => {
  it('no longer owns expandedDirs as component-local useState', () => {
    // Lifted to uiSlice. Reintroducing a useState<Set<string>> here would
    // partition the SSOT and resurrect the unmount-wipe regression.
    expect(sectionSource).not.toMatch(/useState<Set<string>>/);
    expect(sectionSource).not.toMatch(/useState\([^)]*new Set/);
  });

  it('reads expandedDirs from the store and dispatches via lifted actions', () => {
    expect(sectionSource).toMatch(/useStore\(\(s\)\s*=>\s*s\.expandedArtifactDirs\)/);
    expect(sectionSource).toMatch(/unionExpandedArtifactDirs/);
    expect(sectionSource).toMatch(/toggleExpandedArtifactDir/);
    expect(sectionSource).toMatch(/removeExpandedArtifactDirs/);
  });

  it('keeps the spotlight effect deps free of `nodes`', () => {
    const spotlightBlock = sectionSource.match(
      /useEffect\(\(\) => \{\s*if \(!spotlightTarget\) return;[\s\S]*?\}, \[([^\]]*)\]\)/,
    );
    expect(spotlightBlock, 'spotlight effect must exist with the early-return form').not.toBeNull();
    const deps = (spotlightBlock![1] ?? '').split(',').map((s) => s.trim());
    expect(deps).toContain('spotlightTarget');
    expect(deps).toContain('sectionPrefix');
    expect(deps).not.toContain('nodes');
  });

  // The one-shot `initializedRef` first-populate is GONE. It auto-expanded the
  // top level once per workspace, so a root-level dir created mid-job (agent
  // mkdir / run_command output) stayed collapsed until a browser refresh
  // replayed the effect. Reveal is now per-tick and diffed against `seen`.
  it('has no one-shot first-populate ref', () => {
    expect(sectionSource).not.toMatch(/initializedRef/);
  });

  it('reveals new top-level dirs every tick, filtering out files', () => {
    const revealBlock = sectionSource.match(
      /useEffect\(\(\) => \{\s*revealNewArtifactTopLevelDirs\([\s\S]*?\}, \[([^\]]*)\]\)/,
    );
    expect(revealBlock, 'reveal effect must exist').not.toBeNull();
    // `nodes` in the deps is the point: the effect must re-run per tree update.
    expect(revealBlock![1]).toMatch(/nodes/);
    // Only directories belong in the expanded set — the universal root is
    // free-form and can hold files, whose paths would be dead keys.
    expect(revealBlock![0]).toMatch(/type === 'directory'/);
  });

  it('resets BOTH paired sets on workspace switch', () => {
    expect(sectionSource).toMatch(/resetArtifactExpansion\(\)/);
    // The single-set clear is the footgun this replaced.
    expect(sectionSource).not.toMatch(/setExpandedArtifactDirs\(new Set\(\)\)/);
  });
});

describe('uiSlice — expandedArtifactDirs lifted channel', () => {
  it('declares expandedArtifactDirs in the UIState type', () => {
    expect(uiTypesSource).toMatch(/expandedArtifactDirs:\s*ReadonlySet<string>/);
  });

  it('exposes set / union / remove / toggle actions', () => {
    expect(uiSliceSource).toMatch(/setExpandedArtifactDirs:/);
    expect(uiSliceSource).toMatch(/unionExpandedArtifactDirs:/);
    expect(uiSliceSource).toMatch(/removeExpandedArtifactDirs:/);
    expect(uiSliceSource).toMatch(/toggleExpandedArtifactDir:/);
  });

  it('declares seenArtifactTopLevelDirs alongside it in the UIState type', () => {
    expect(uiTypesSource).toMatch(/seenArtifactTopLevelDirs:\s*ReadonlySet<string>/);
  });

  it('exposes the reveal-new / paired-reset actions', () => {
    expect(uiSliceSource).toMatch(/revealNewArtifactTopLevelDirs:/);
    expect(uiSliceSource).toMatch(/resetArtifactExpansion:/);
  });

  it('mutates both paired sets in ONE patch, and resets both together', () => {
    // Two sets expressing one invariant: splitting their owners (or their
    // patches) is how they drift and force-reopen user-collapsed dirs.
    // Requiring `set(` targets the REDUCER, not the same-named line in the
    // actions interface; the lookahead bounds it at the next reducer.
    const reveal = uiSliceSource.match(
      /revealNewArtifactTopLevelDirs:[^=]*=>\s*\{\s*set\([\s\S]*?(?=\n  resetArtifactExpansion:)/,
    );
    expect(reveal, 'reveal reducer must exist').not.toBeNull();
    expect(reveal![0]).toMatch(/planArtifactAutoExpand/);
    // Both sets are touched, and by exactly ONE `set(` call — that single patch
    // is the invariant. Assert identifiers, not punctuation, so reformatting the
    // reducer doesn't fail the build.
    expect(reveal![0]).toMatch(/seenArtifactTopLevelDirs/);
    expect(reveal![0]).toMatch(/expandedArtifactDirs/);
    expect(reveal![0].match(/\bset\(/g)).toHaveLength(1);
    // No-op guard: a tick that changes nothing returns `{}`.
    expect(reveal![0]).toMatch(/return \{\}/);

    const reset = uiSliceSource.match(
      /resetArtifactExpansion:[^=]*=>\s*\{\s*set\([\s\S]*?\}\);/,
    );
    expect(reset, 'reset reducer must exist').not.toBeNull();
    expect(reset![0]).toMatch(/expandedArtifactDirs/);
    expect(reset![0]).toMatch(/seenArtifactTopLevelDirs/);
    expect(reset![0].match(/\bset\(/g)).toHaveLength(1);
  });

  it('clears both sets on logout', () => {
    const resetSliceSource = readFileSync(
      resolve(__dirname, '../../src/domain/store/slices/resetSlice.ts'),
      'utf-8',
    );
    expect(resetSliceSource).toMatch(/expandedArtifactDirs:\s*new Set/);
    expect(resetSliceSource).toMatch(/seenArtifactTopLevelDirs:\s*new Set/);
  });

  it('union/remove reducers ship a no-op guard so subscribers stay ref-stable', () => {
    // Both reducers compute `changed` and return `{}` (no state diff) when
    // the requested mutation is a no-op. This is the property that keeps
    // mid-render dispatches from re-rendering every subscriber.
    const unionBlock = uiSliceSource.match(
      /unionExpandedArtifactDirs:\s*\(paths[^)]*\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;?\s*\}/,
    );
    expect(unionBlock, 'union reducer must exist').not.toBeNull();
    expect(unionBlock![0]).toMatch(/changed\s*\?\s*\{\s*expandedArtifactDirs:/);
    expect(unionBlock![0]).toMatch(/:\s*\{\}/);

    const removeBlock = uiSliceSource.match(
      /removeExpandedArtifactDirs:\s*\(paths[^)]*\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;?\s*\}/,
    );
    expect(removeBlock, 'remove reducer must exist').not.toBeNull();
    expect(removeBlock![0]).toMatch(/changed\s*\?\s*\{\s*expandedArtifactDirs:/);
    expect(removeBlock![0]).toMatch(/:\s*\{\}/);
  });
});

describe('ArtifactsPanel — derived value ref stability', () => {
  const required = [
    'topLevelByName',
    'planTemplateFiles',
    'visibleTopLevelDirNodes',
    'permissionsByDomain',
    'getNodePermissions',
    'mergedIndicators',
  ];

  for (const name of required) {
    it(`memoises \`${name}\``, () => {
      // Match `const NAME = useMemo` or `const NAME = useCallback`
      // (anything else after, including generics, is allowed).
      const pattern = new RegExp(`const\\s+${name}\\s*=\\s*(?:useMemo|useCallback)\\b`);
      expect(panelSource).toMatch(pattern);
    });
  }
});

/**
 * Behavior table for the auto-expand decision itself.
 *
 * The static guards above lock the WIRING; this locks the RULE. A workspace
 * project's artifact root is free-form, so a root dir can appear mid-job — it
 * must expand without a browser refresh, and a dir the user collapsed must not
 * be force-reopened on the next SSE tick.
 */
describe('planArtifactAutoExpand', () => {
  const S = (...p: string[]) => new Set(p);

  it('first populate expands the whole top level (unchanged behavior)', () => {
    const plan = planArtifactAutoExpand(S(), ['plan', 'sessions']);
    expect(plan).not.toBeNull();
    expect(plan!.fresh.sort()).toEqual(['plan', 'sessions']);
    expect([...plan!.nextSeen].sort()).toEqual(['plan', 'sessions']);
  });

  it('is a no-op when the top level is unchanged (ref-stability contract)', () => {
    expect(planArtifactAutoExpand(S('plan', 'sessions'), ['plan', 'sessions'])).toBeNull();
  });

  it('expands ONLY the genuinely-new dir', () => {
    const plan = planArtifactAutoExpand(S('plan', 'sessions'), ['plan', 'research', 'sessions']);
    expect(plan).not.toBeNull();
    expect(plan!.fresh).toEqual(['research']);
  });

  it('does not resurrect a dir the user collapsed', () => {
    // `seen` already contains `plan`, so a tick that still lists `plan` yields
    // nothing to expand — the user's collapse survives.
    expect(planArtifactAutoExpand(S('plan', 'sessions'), ['plan', 'sessions'])).toBeNull();
  });

  it('ignores a transient empty tree instead of rebasing `seen`', () => {
    // A failed fetch / project-switch render must not clear `seen`, which would
    // force-expand everything on the next tick.
    expect(planArtifactAutoExpand(S('plan', 'sessions'), [])).toBeNull();
  });

  it('rebases `seen` when a dir vanishes, so recreating it expands again', () => {
    // Rebase, not accumulate. Step 1: `old` disappears — nothing to expand, but
    // `seen` must drop it.
    const shrink = planArtifactAutoExpand(S('old', 'plan', 'sessions'), ['plan', 'sessions']);
    expect(shrink, 'a vanished dir must still rebase `seen`').not.toBeNull();
    expect(shrink!.fresh).toEqual([]);
    expect([...shrink!.nextSeen].sort()).toEqual(['plan', 'sessions']);

    // Step 2: recreated → it is a NEW directory and expands.
    const recreated = planArtifactAutoExpand(shrink!.nextSeen, ['old', 'plan', 'sessions']);
    expect(recreated).not.toBeNull();
    expect(recreated!.fresh).toEqual(['old']);
  });
});
