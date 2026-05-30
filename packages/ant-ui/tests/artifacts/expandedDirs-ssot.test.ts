import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('guards first-populate with a ref so it runs at most once per workspace', () => {
    expect(sectionSource).toMatch(/initializedRef\.current\s*=\s*true/);
    // And the workspace-switch reset clears the ref so a new project gets a
    // fresh default expand.
    expect(sectionSource).toMatch(/initializedRef\.current\s*=\s*false/);
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
