/**
 * Artifact Injection Audit Tests (Reverse Direction)
 *
 * Static analysis that verifies:
 *   2-A. All build() callsites pass config.artifacts
 *   2-B. All decompose nodes set artifactPolicy
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'fs';

const SRC_DIR = join(__dirname, '../src');

// ============================================
// 2-A: build() callsites must pass artifacts
// ============================================

const MUST_PASS_ARTIFACTS = [
  'agents/architect/graph/code/nodes/execute/buildMessages.ts',
  'agents/architect/graph/design/nodes/docGen/intent/system.ts',
  'agents/architect/graph/design/nodes/docGen/intent/spec.ts',
];

describe('build() callsites pass config.artifacts', () => {
  it.each(MUST_PASS_ARTIFACTS)('%s contains artifacts in config', (file) => {
    const content = readFileSync(join(SRC_DIR, file), 'utf-8');
    expect(content).toMatch(/artifacts\s*[,:]/);
  });
});

// ============================================
// 2-B: decompose nodes must set artifactPolicy
// ============================================

const MUST_SET_POLICY = [
  'agents/architect/graph/code/nodes/decompose/responseParser.ts',
  'agents/architect/graph/design/nodes/decompose/uiDesignDecompose.ts',
  'agents/architect/graph/design/nodes/decompose/systemDesignDecompose.ts',
  'agents/architect/graph/design/nodes/decompose/specDecompose.ts',
];

describe('decompose nodes set artifactPolicy', () => {
  it.each(MUST_SET_POLICY)('%s contains artifactPolicy', (file) => {
    const content = readFileSync(join(SRC_DIR, file), 'utf-8');
    expect(content).toMatch(/artifactPolicy/);
  });
});
