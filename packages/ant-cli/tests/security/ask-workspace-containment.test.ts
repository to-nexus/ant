/**
 * Ask workspace tools — containment (H-018).
 *
 * `read_workspace_file` / `list_workspace_files` used to do a lexical `..` check
 * and then a raw `fs.readFileSync`/`readdirSync` on `join(featurePath, rel)`,
 * which follows a symlink or a reparented feature root straight into another
 * workspace. They now descend from the service-owned physical base by descriptor
 * (O_NOFOLLOW), so a symlink out of the feature is refused rather than read into
 * the LLM prompt.
 *
 * Assertions are on the GATE (in-base read succeeds, out-of-base symlink is
 * refused), not on message prose. Descent is Linux-only, so the symlink-refusal
 * rows are gated on it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DESCENT_AVAILABLE } from '../../src/core/config/containedIo';
import {
  setWorkspaceFeaturePath,
  readWorkspaceFile,
  listWorkspaceFiles,
} from '../../src/agents/architect/graph/ask/tools';

const onLinuxDescent = DESCENT_AVAILABLE ? it : it.skip;

describe('Ask workspace tools are descriptor-contained (H-018)', () => {
  let base: string;
  let featurePath: string;
  let outside: string;
  const savedBase = process.env.ANT_WORKSPACE_BASE_PATH;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ant-ask-'));
    // The feature lives several segments under the physical base, like a real
    // tenant path — the feature name descends as a component, not the anchor.
    featurePath = path.join(base, 'org', 'user', 'project', 'features', 'feat');
    outside = path.join(base, 'secret');
    fs.mkdirSync(path.join(featurePath, 'plan'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(featurePath, 'plan', 'prd.md'), 'INSIDE', 'utf-8');
    fs.writeFileSync(path.join(outside, 'secret.md'), 'SERVICE-SECRET', 'utf-8');
    process.env.ANT_WORKSPACE_BASE_PATH = base;
    setWorkspaceFeaturePath(featurePath);
  });

  afterEach(() => {
    setWorkspaceFeaturePath(undefined);
    if (savedBase === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
    else process.env.ANT_WORKSPACE_BASE_PATH = savedBase;
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('reads a normal in-workspace file', async () => {
    const r = await readWorkspaceFile({ path: 'plan/prd.md' });
    expect(r.success).toBe(true);
    expect(r.content).toContain('INSIDE');
  });

  it('lists an in-workspace directory', async () => {
    const r = await listWorkspaceFiles({ path: 'plan' });
    expect(r.success).toBe(true);
    expect(r.content).toContain('prd.md');
  });

  it('refuses a lexical traversal', async () => {
    const r = await readWorkspaceFile({ path: '../../../../../secret/secret.md' });
    expect(r.success).toBe(false);
  });

  onLinuxDescent('refuses a symlink that points out of the workspace', async () => {
    // A link planted inside an allowed dir, pointing at another workspace.
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(featurePath, 'plan', 'leak.md'));
    const r = await readWorkspaceFile({ path: 'plan/leak.md' });
    expect(r.success).toBe(false);
    expect(r.content ?? '').not.toContain('SERVICE-SECRET');
  });

  onLinuxDescent('does not follow a symlinked directory out of the workspace', async () => {
    fs.symlinkSync(outside, path.join(featurePath, 'plan', 'jump'));
    const r = await listWorkspaceFiles({ path: 'plan/jump' });
    // Either refused, or (if listed) never surfaces the out-of-base entry.
    expect(r.content ?? '').not.toContain('secret.md');
  });
});
