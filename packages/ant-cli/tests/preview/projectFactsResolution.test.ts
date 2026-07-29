/**
 * Locks `resolveProjectFacts` — the single owner of provenance precedence, shared
 * by `GET /status` and `GET /preview-config` so the two can never disagree.
 *
 * Three authority inversions this replaces:
 *   A. the LLM hint outranked the filesystem inside the structure detector
 *   B. hint and detection wrote the SAME PREVIEW_CONFIG field (last write wins)
 *   C. the frontend field-merged the two, producing chimeras like
 *      `language: go` + `framework: nextjs`
 */

import { describe, it, expect } from 'vitest';
import type { ProjectProfile } from '@ant/shared';
import { resolveProjectFacts, resolveSpawnLanguage } from '../../src/periphery/adapters/http/services/PreviewService/utils/projectFacts';
import type { DetectedProjectFacts } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ProjectProfileDetector';

const manifest: ProjectProfile = {
  language: 'go',
  framework: 'gin',
  structureType: 'backend-only',
  source: 'manifest',
};
const hint: ProjectProfile = {
  language: 'typescript',
  framework: 'nextjs',
  structureType: 'fullstack',
  source: 'techtier-hint',
};

const detectedFrom = (profile: ProjectProfile, canStart = true): DetectedProjectFacts => ({
  structureType: profile.structureType ?? 'frontend-only',
  profile,
  canStart,
});

describe('resolveProjectFacts', () => {
  it('fresh manifest wins over both persisted candidates', () => {
    const facts = resolveProjectFacts({
      detected: detectedFrom(manifest),
      runtime: { projectProfile: hint },
      cached: { projectProfile: hint },
      isBusy: false,
    });
    expect(facts.projectProfile).toEqual(manifest);
    expect(facts.structureType).toBe('backend-only');
  });

  it('a manifest in the LOWEST rank still beats a hint in the highest', () => {
    const facts = resolveProjectFacts({
      detected: detectedFrom(hint),
      runtime: null,
      cached: { projectProfile: manifest },
      isBusy: false,
    });
    expect(facts.projectProfile).toEqual(manifest);
  });

  it('rank breaks ties between equal provenance (runtime over cache)', () => {
    const newer: ProjectProfile = { ...manifest, framework: 'echo' };
    const facts = resolveProjectFacts({
      detected: null,
      runtime: { projectProfile: newer },
      cached: { projectProfile: manifest },
      isBusy: true,
    });
    expect(facts.projectProfile?.framework).toBe('echo');
  });

  it('the hint is used only when nothing was observed', () => {
    const facts = resolveProjectFacts({
      detected: null,
      runtime: null,
      cached: { projectProfile: hint },
      isBusy: false,
    });
    expect(facts.projectProfile).toEqual(hint);
    expect(facts.structureType).toBe('fullstack');
  });

  it('never field-merges across provenance — a manifest without a framework stays without one', () => {
    const noFramework: ProjectProfile = { language: 'python', structureType: 'backend-only', source: 'manifest' };
    const facts = resolveProjectFacts({
      detected: detectedFrom(noFramework),
      runtime: null,
      cached: { projectProfile: hint },
      isBusy: false,
    });
    expect(facts.projectProfile).toEqual(noFramework);
    expect(facts.projectProfile?.framework).toBeUndefined();
  });

  it('a legacy cached record with no `source` is treated as a hint', () => {
    const legacy = { language: 'typescript', framework: 'react' } as any;
    const facts = resolveProjectFacts({
      detected: detectedFrom(manifest),
      runtime: null,
      cached: { projectProfile: legacy },
      isBusy: false,
    });
    expect(facts.projectProfile).toEqual(manifest);
  });

  it('a cached record carrying only structureType is adopted, tagged as a hint', () => {
    const facts = resolveProjectFacts({
      detected: null,
      runtime: null,
      cached: { structureType: 'monorepo' },
      isBusy: false,
    });
    expect(facts.structureType).toBe('monorepo');
    expect(facts.projectProfile?.source).toBe('techtier-hint');
  });

  it('a cached profile without its own structureType inherits the sibling field', () => {
    const facts = resolveProjectFacts({
      detected: null,
      runtime: null,
      cached: { structureType: 'monorepo', projectProfile: { language: 'typescript', source: 'manifest' } },
      isBusy: false,
    });
    expect(facts.structureType).toBe('monorepo');
  });

  it('nothing anywhere → all null, canStart false', () => {
    expect(resolveProjectFacts({ isBusy: false })).toEqual({
      structureType: null,
      projectProfile: null,
      canStart: false,
    });
  });

  it('canStart comes only from fresh detection, and is false whenever busy', () => {
    expect(resolveProjectFacts({ detected: detectedFrom(manifest, true), isBusy: false }).canStart).toBe(true);
    expect(resolveProjectFacts({ detected: detectedFrom(manifest, true), isBusy: true }).canStart).toBe(false);
    expect(resolveProjectFacts({ cached: { projectProfile: manifest }, isBusy: false }).canStart).toBe(false);
  });
});

describe('resolveSpawnLanguage', () => {
  it("profile present with no language → 'unknown', NOT the Node branch", () => {
    // A Makefile-only project. Defaulting to typescript here would run
    // `npm run dev` in a directory with no package.json.
    expect(resolveSpawnLanguage({ source: 'manifest' })).toBe('unknown');
  });

  it("no profile at all → 'typescript' (legacy deploy rehydration default)", () => {
    expect(resolveSpawnLanguage(undefined)).toBe('typescript');
    expect(resolveSpawnLanguage(null)).toBe('typescript');
  });

  it('a real language is lowercased and passed through', () => {
    expect(resolveSpawnLanguage({ language: 'Go', source: 'manifest' })).toBe('go');
  });
});
