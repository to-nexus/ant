/**
 * Builtin (shipped) custom-agent definitions — validity + scope-root wiring.
 *
 * discoverAgents is deliberately lenient (a broken definition is silently
 * skipped), so a malformed shipped sample would vanish from the hub without
 * failing anything. This suite is the fail-loud gate: every definition
 * committed under src/core/data/agents/ must load, and the builtin scope
 * root must stay wired as the lowest-priority readonly root.
 * Analogue of tests/prompt/prompt-smoke.test.ts for prompt assets.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverAgents,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../src/core/customAgents/CustomAgentLoader';
import { deriveCustomAgentScopeRoots } from '../../src/core/customAgents/scopeRoots';

const SRC_AGENTS_DIR = path.join(__dirname, '../../src/core/data/agents');

const builtinRoots: CustomAgentScopeRoot[] = [
  { scope: 'builtin', root: SRC_AGENTS_DIR, readonly: true },
];

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

const shippedAgents = listDirs(SRC_AGENTS_DIR);
const shippedPairs = shippedAgents.flatMap((agentId) =>
  listDirs(path.join(SRC_AGENTS_DIR, agentId, 'jobs')).map((jobId) => [agentId, jobId] as const),
);

describe('shipped builtin definitions — smoke', () => {
  it('at least one sample ships', () => {
    expect(shippedPairs.length).toBeGreaterThan(0);
  });

  it.each(shippedPairs)('%s/%s loads and honors the shipping policy', (agentId, jobId) => {
    const resolved = loadCustomJob(builtinRoots, agentId, jobId);

    // Shipping policy: no MCP servers (arbitrary code + host env deps), no
    // canonical-plane access, prose under the cap (no truncation footer).
    expect(Object.keys(resolved.mcpServers)).toEqual([]);
    expect(resolved.workspace).toBe('none');
    expect(resolved.prose).not.toContain('[... truncated');

    // Every advertised injection must exist where the TOC points.
    for (const entry of resolved.injectionsToc) {
      expect(fs.existsSync(entry.absolutePath), `missing injection: ${entry.absolutePath}`).toBe(true);
      expect(entry.summary.trim().length).toBeGreaterThan(0);
    }
  });

  it('lenient discovery lists every shipped agent with all of its jobs', () => {
    const agents = discoverAgents(builtinRoots);
    expect(agents.map((a) => a.id).sort()).toEqual(shippedAgents);
    for (const agent of agents) {
      expect(agent.readonly).toBe(true);
      expect(agent.scope).toBe('builtin');
      expect(agent.jobs.map((j) => j.id).sort()).toEqual(
        listDirs(path.join(SRC_AGENTS_DIR, agent.id, 'jobs')),
      );
    }
  });
});

describe('builtin scope root wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builtin is always the last root, readonly, under core/data/agents', () => {
    const roots = deriveCustomAgentScopeRoots('/ws/org/user/project');
    const last = roots[roots.length - 1];
    expect(last.scope).toBe('builtin');
    expect(last.readonly).toBe(true);
    expect(last.root.endsWith(path.join('core', 'data', 'agents'))).toBe(true);
  });

  it('full priority order is user → org → builtin when org is set', () => {
    vi.stubEnv('ANT_CUSTOM_AGENTS_DIR', path.join(os.tmpdir(), 'org-agents'));
    const roots = deriveCustomAgentScopeRoots('/ws/org/user/project');
    expect(roots.map((r) => r.scope)).toEqual(['user', 'org', 'builtin']);
  });

  it('builtin root follows ANT_CLI_ROOT (job-runner child processes)', () => {
    const fakeCliRoot = path.join(os.tmpdir(), 'fake-cli-root');
    vi.stubEnv('ANT_CLI_ROOT', fakeCliRoot);
    const roots = deriveCustomAgentScopeRoots('/ws/org/user/project');
    expect(roots[roots.length - 1].root).toBe(path.join(fakeCliRoot, 'core/data/agents'));
  });
});
