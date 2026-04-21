import { describe, it, expect } from 'vitest';
import { deriveArtifactPolicy } from '../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { ARTIFACT_PREFIX } from '@ant/shared';

// ---------------------------------------------------------------------------
// deriveArtifactPolicy
// ---------------------------------------------------------------------------

describe('deriveArtifactPolicy', () => {
  it('verification: undefined 반환', () => {
    expect(deriveArtifactPolicy('verification')).toBeUndefined();
  });

  it('ui taskType: uiSections -> context paths', () => {
    const result = deriveArtifactPolicy('ui', undefined, ['header', 'tokens', 'assets']);
    expect(result).toBeDefined();
    expect(result!.context).toBeDefined();
    expect(result!.refs).toBeUndefined();
    expect(result!.context).toContain(`${ARTIFACT_PREFIX.UI}tokens`);
    expect(result!.context).toContain(`${ARTIFACT_PREFIX.UI}assets`);
    expect(result!.context).toContain(`${ARTIFACT_PREFIX.UI_SPEC}header`);
  });

  it('design-system taskType: uiSections -> context paths', () => {
    const result = deriveArtifactPolicy('design-system', undefined, ['layout']);
    expect(result).toBeDefined();
    expect(result!.context).toContain(`${ARTIFACT_PREFIX.UI}tokens`);
    expect(result!.context).toContain(`${ARTIFACT_PREFIX.UI_SPEC}layout`);
  });

  it('ui taskType: no uiSections -> wildcard context', () => {
    const result = deriveArtifactPolicy('ui');
    expect(result).toBeDefined();
    expect(result!.context).toContain(`${ARTIFACT_PREFIX.UI}*`);
  });

  it('fe-/be- packages -> refs paths', () => {
    const result = deriveArtifactPolicy('feature', ['fe-main', 'be-auth']);
    expect(result).toBeDefined();
    expect(result!.refs).toContain(`${ARTIFACT_PREFIX.FE_SYSTEM}main.md`);
    expect(result!.refs).toContain(`${ARTIFACT_PREFIX.BE_SYSTEM}auth.md`);
    expect(result!.refs).toContain(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
  });

  it('shared package -> api-contract ref', () => {
    const result = deriveArtifactPolicy('feature', ['shared']);
    expect(result).toBeDefined();
    expect(result!.refs).toContain(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
  });

  it('active spec ref filename -> spec ref', () => {
    const result = deriveArtifactPolicy('feature', undefined, undefined, 'spec-login.md');
    expect(result).toBeDefined();
    expect(result!.refs).toContain(`${ARTIFACT_PREFIX.SPEC}spec-login.md`);
  });

  it('packages without shared -> still includes api-contract', () => {
    const result = deriveArtifactPolicy('feature', ['fe-main']);
    expect(result).toBeDefined();
    expect(result!.refs).toContain(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
  });

  it('no packages, no spec -> undefined', () => {
    const result = deriveArtifactPolicy('feature');
    expect(result).toBeUndefined();
  });
});
