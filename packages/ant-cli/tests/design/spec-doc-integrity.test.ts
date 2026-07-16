/**
 * Spec doc single-root invariant — unit tests for the completion-time
 * self-heal guard (plan spec-design-reflective-fox, Axis 3).
 *
 * Live incident: a rev-spec (refactor mode) run appended a full re-authored
 * document below the original via <append>, leaving TWO complete spec
 * documents (contradictory in one case) in one file that the code job then
 * consumed as a single authoritative ref. The guard keeps the LAST root
 * (refactor's contract is "output the FULL modified document") and flags —
 * without destroying — anything it cannot prove is a full document.
 */

import { describe, it, expect } from 'vitest';
import {
  healDuplicateSpecRoots,
  isSpecDocTask,
} from '../../src/agents/architect/graph/design/nodes/checkTaskStatus/specDocIntegrity';

const DOC_A = `# Spec: Wallet Login

## Overview

Old revision body.

## Acceptance Criteria

1. Old criterion.
`;

const DOC_B = `# Spec: Wallet Login

## Overview

New revision body with the responsive table.

## Acceptance Criteria

1. New criterion.
`;

describe('healDuplicateSpecRoots', () => {
  it('single root → none', () => {
    const r = healDuplicateSpecRoots(DOC_A);
    expect(r.action).toBe('none');
    expect(r.rootCount).toBe(1);
  });

  it('two concatenated documents → healed to the LAST full document', () => {
    const r = healDuplicateSpecRoots(DOC_A + '\n' + DOC_B);
    expect(r.action).toBe('healed');
    expect(r.rootCount).toBe(2);
    expect(r.healed).toContain('New revision body');
    expect(r.healed).not.toContain('Old revision body');
    expect(r.healed!.startsWith('# Spec: Wallet Login')).toBe(true);
  });

  it('preserves YAML frontmatter (consumed markers) on heal', () => {
    const fm = '---\nant:\n  status: consumed\n  consumedBy: some-job\n---\n';
    const r = healDuplicateSpecRoots(fm + DOC_A + '\n' + DOC_B);
    expect(r.action).toBe('healed');
    expect(r.healed!.startsWith('---\nant:')).toBe(true);
    expect(r.healed).toContain('New revision body');
    expect(r.healed).not.toContain('Old revision body');
  });

  it('ignores `# ` lines inside fenced code blocks', () => {
    const withFence = `# Spec: Only Root

## Setup

\`\`\`bash
# this is a shell comment, not a heading
echo hi
\`\`\`
`;
    const r = healDuplicateSpecRoots(withFence);
    expect(r.action).toBe('none');
    expect(r.rootCount).toBe(1);
  });

  it('flags (does not destroy) when the last segment is not a full document', () => {
    const addendum = '# Addendum note\n\njust one paragraph, no sections\n';
    const r = healDuplicateSpecRoots(DOC_A + '\n' + addendum);
    expect(r.action).toBe('flagged');
    expect(r.rootCount).toBe(2);
    expect(r.healed).toBeUndefined();
  });
});

describe('isSpecDocTask', () => {
  it('true for explicit architecture/spec targetDir (current prefix-less naming)', () => {
    expect(isSpecDocTask({ targetDir: 'architecture/spec', targetFile: 'landing-page.md' })).toBe(true);
  });

  it('true for legacy spec- prefixed file without targetDir (designDirOf fallback)', () => {
    expect(isSpecDocTask({ targetFile: 'spec-wallet-login.md' })).toBe(true);
  });

  it('false for system-design / ui docs and missing targetFile', () => {
    expect(isSpecDocTask({ targetDir: 'architecture/system', targetFile: 'fe-system-main.md' })).toBe(false);
    expect(isSpecDocTask({ targetFile: 'ui-spec.json', targetDir: 'visual/ui/ant' })).toBe(false);
    expect(isSpecDocTask(undefined)).toBe(false);
    expect(isSpecDocTask({})).toBe(false);
  });
});
