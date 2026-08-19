/**
 * WS3 — universal artifact dir policy axis. The universal `plan` dir allows
 * the `plan/{agentId}/{jobId}/` convention (subdirs legal) while keeping the
 * canonical plan's extension vocabulary; the codespace policy is untouched.
 * The panel wires the policy via ArtifactsSection's `resolveDirPolicy` prop
 * (default = canonical `getArtifactDirPolicy`, so codespace mounts change
 * nothing).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ARTIFACT_DIR_POLICIES,
  UNIVERSAL_ARTIFACT_DIR_POLICIES,
  getArtifactDirPolicy,
  getUniversalArtifactDirPolicy,
} from '@ant/shared';

const here = dirname(fileURLToPath(import.meta.url));

describe('UNIVERSAL_ARTIFACT_DIR_POLICIES', () => {
  it('plan allows subdirs (the plan/{agentId}/{jobId} convention) — canonical plan still blocks them', () => {
    expect(getUniversalArtifactDirPolicy('plan')?.allowSubdirs).toBe(true);
    expect(getArtifactDirPolicy('plan')?.allowSubdirs).toBe(false);
  });

  it('plan extension vocabulary is IDENTICAL to the canonical plan (single prompt-injectable set)', () => {
    expect(UNIVERSAL_ARTIFACT_DIR_POLICIES['plan'].acceptedExtensions).toEqual(
      ARTIFACT_DIR_POLICIES['plan'].acceptedExtensions,
    );
  });

  it('free-form dirs carry no policy on the universal plane', () => {
    expect(getUniversalArtifactDirPolicy('briefs')).toBeNull();
    expect(getUniversalArtifactDirPolicy('visual/ui')).toBeNull();
  });
});

describe('resolveDirPolicy prop wiring (source-level)', () => {
  const sectionSrc = readFileSync(
    resolve(here, '../../src/presentation/components/ArtifactsPanel/ArtifactsSection.tsx'),
    'utf-8',
  );
  const panelSrc = readFileSync(
    resolve(here, '../../src/presentation/components/UniversalArtifactsPanel.tsx'),
    'utf-8',
  );

  it('ArtifactsSection defaults to the canonical policy (codespace unchanged)', () => {
    expect(sectionSrc).toMatch(/resolveDirPolicy = getArtifactDirPolicy/);
  });

  it('every policy decision in ArtifactsSection routes through resolveDirPolicy', () => {
    // No remaining direct policy CALLS — the identifier appears only as the
    // prop's default value (no call parens).
    expect(sectionSrc).not.toMatch(/getArtifactDirPolicy\(/);
    expect((sectionSrc.match(/resolveDirPolicy\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('UniversalArtifactsPanel passes the universal policy table', () => {
    expect(panelSrc).toMatch(/resolveDirPolicy=\{getUniversalArtifactDirPolicy\}/);
  });

  it('refetches on every fileTree SSE tick, with no isRunning gate', () => {
    // The panel uses `fileTree` purely as a change ticker and pulls its own tree
    // over REST. Gating that refetch on `isRunning` dropped exactly the events
    // that matter when no job is running: the end-of-job broadcast (which races
    // `isRunning` flipping false), an artifact mutation from another tab, and a
    // post-job HTTP mutation.
    // The negative lookahead keeps the match from starting at an EARLIER
    // useEffect and swallowing the isRunning-gated one on its way here.
    const tickEffect = panelSrc.match(
      /useEffect\(\(\) => \{(?:(?!useEffect)[\s\S])*?\}, \[fileTreeTick\]\)/,
    );
    expect(tickEffect, 'a [fileTreeTick] effect must exist').not.toBeNull();
    expect(tickEffect![0]).not.toMatch(/isRunning/);
  });
});
