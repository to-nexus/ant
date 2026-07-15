/**
 * Spec-surface detection must mirror the writer-side SSOT (SPEC_OUTPUTS —
 * gen-spec saves LLM-slug-named `*.md` with NO forced prefix). The old
 * `spec-*` prefix filter silently reported hasArchitectureSpec=false for
 * every post-prefix-drop spec (sharp-choking-glove RCA), starving triage's
 * rev-vs-gen signal and the rev-spec missingPrereq gate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { analyzeWorkspace } from '../../src/agents/common/graph/nodes/triage/workspaceAnalyzer';

let featurePath: string;

beforeEach(() => {
  featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-analyzer-'));
});

afterEach(() => {
  fs.rmSync(featurePath, { recursive: true, force: true });
});

function writeSpec(name: string) {
  const dir = path.join(featurePath, 'architecture', 'spec');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '# spec');
}

describe('analyzeWorkspace — architecture/spec detection', () => {
  it('detects slug-named specs (no spec- prefix)', async () => {
    writeSpec('defect-fixes.md');
    const ws = await analyzeWorkspace(featurePath);
    expect(ws.hasArchitectureSpec).toBe(true);
    expect(ws.specDocNames).toEqual(['defect-fixes.md']);
    expect(ws.specDocCount).toBe(1);
  });

  it('still detects legacy spec-*.md files', async () => {
    writeSpec('spec-auth.md');
    const ws = await analyzeWorkspace(featurePath);
    expect(ws.hasArchitectureSpec).toBe(true);
    expect(ws.specDocNames).toEqual(['spec-auth.md']);
  });

  it('ignores hidden files and non-markdown files', async () => {
    writeSpec('.hidden.md');
    writeSpec('notes.txt');
    const ws = await analyzeWorkspace(featurePath);
    expect(ws.hasArchitectureSpec).toBe(false);
    expect(ws.specDocNames).toBeUndefined();
  });

  it('reports false when the directory is absent', async () => {
    const ws = await analyzeWorkspace(featurePath);
    expect(ws.hasArchitectureSpec).toBe(false);
  });
});
