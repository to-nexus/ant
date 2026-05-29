import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sectionPath = resolve(
  __dirname,
  '../../src/presentation/components/ArtifactsPanel/ArtifactsSection.tsx',
);
const panelPath = resolve(__dirname, '../../src/presentation/components/ArtifactsPanel.tsx');

const sectionSource = readFileSync(sectionPath, 'utf-8');
const panelSource = readFileSync(panelPath, 'utf-8');

/**
 * Static SSOT guards for the artifact-tree expand state.
 *
 * The expand bug ("file tree closes when a file is selected") was caused by
 * the spotlight `useEffect` reacting to `nodes` ref churn from the parent
 * (ArtifactsPanel re-rendered every store change, rebuilding the nodes
 * array, which fired the effect and reset `expandedDirs` to top-level
 * only). These tests lock the SSOT in place:
 *
 *  1. The effect that mutates `expandedDirs` based on `nodes` ref must
 *     only ever do so as a union (never as a wholesale replacement).
 *  2. The defunct "different section → close everything" branch must not
 *     return — ArtifactsSection has a single unified mount, so the branch
 *     is unreachable; reintroducing it would mask a future regression.
 *  3. ArtifactsPanel's derived values feeding into <ArtifactsSection>
 *     must stay ref-stable across re-renders (useMemo / useCallback).
 */
describe('ArtifactsSection — expandedDirs SSOT', () => {
  it('does not reset expandedDirs from a nodes-based wholesale replace', () => {
    // `setExpandedDirs(new Set(nodes.map(...)))` would discard user
    // expansions on every parent re-render. Allowed: `setExpandedDirs((prev)
    // => new Set([...prev, ...]))` (union form).
    expect(sectionSource).not.toMatch(/setExpandedDirs\(new Set\(nodes\.map/);
  });

  it('does not clear expandedDirs via empty-set replace', () => {
    // The legacy `!belongsToThisSection` branch did
    // `setExpandedDirs(new Set())`. With the unified single-section mount,
    // that branch is unreachable; the call site is removed so a future
    // copy-paste cannot resurrect a global-clear behaviour.
    expect(sectionSource).not.toMatch(/setExpandedDirs\(new Set\(\)\)/);
  });

  it('keeps the spotlight effect deps free of `nodes`', () => {
    // The spotlight effect must depend only on spotlightTarget +
    // sectionPrefix. Adding `nodes` (or its derivatives) re-runs the effect
    // on every parent re-render and undoes the fix.
    const spotlightBlock = sectionSource.match(
      /useEffect\(\(\) => \{\s*if \(!spotlightTarget\) return;[\s\S]*?\}, \[([^\]]*)\]\)/,
    );
    expect(spotlightBlock, 'spotlight effect must exist with the early-return form').not.toBeNull();
    const deps = (spotlightBlock![1] ?? '').split(',').map((s) => s.trim());
    expect(deps).toContain('spotlightTarget');
    expect(deps).toContain('sectionPrefix');
    expect(deps).not.toContain('nodes');
  });

  it('guards first-populate with a ref so it runs at most once', () => {
    expect(sectionSource).toMatch(/initializedRef\.current\s*=\s*true/);
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
