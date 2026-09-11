/**
 * Builder handoffs stay bound to the definitions they front.
 *
 * `docs/guides/builder-handoff/*.md` let an external agent do a builtin
 * builder's job offline. They carry channel deltas only — the contract is the
 * shipped prose — so what can drift is exactly what this file pins: the
 * read-list (every shipped file named), quoted paths (exist), hooks (spelled
 * as hooks.yaml spells them), routes (the same set api-surface.md documents),
 * CLI commands (registered), and the seven-section skeleton (in order).
 * Prose is never pinned.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { DEFINITION_CLI_COMMANDS } from '../../src/cli/definition/commands';
import {
  BUILDER_HANDOFFS,
  composeBuilderHandoff,
  handoffReadList,
} from '../../src/core/customAgents/builderHandoff';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const HANDOFF_DIR = path.join(REPO_ROOT, 'docs/guides/builder-handoff');
const AGENTS_DIR = 'packages/ant-cli/src/core/data/agents';
const ROOTS = {
  agentsRoot: path.join(REPO_ROOT, AGENTS_DIR),
  docsRoot: path.join(REPO_ROOT, 'docs'),
  examplesRoot: path.join(REPO_ROOT, 'examples'),
};

// The table has ONE owner — the composer the route and the CLI serve from —
// so a handoff the menu offers is always one this suite has judged.
const HANDOFFS = BUILDER_HANDOFFS;

/** The human entry points, one per language; the handoffs themselves are the agent's. */
const INDEX_DOCS = ['README.md', 'README.ko.md'];

const SECTIONS = [
  '## What this is',
  '## Read, in this order',
  '## Working tree',
  '## Channel substitution table',
  '## Bring it in',
  '## Done when',
  '## Out of scope offline',
];

const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
const backticked = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);

function listFiles(relDir: string): string[] {
  const abs = path.join(REPO_ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(`${relDir}/${e.name}`) : [`${relDir}/${e.name}`],
  );
}

/** `METHOD /definitions/...` tokens, placeholders and query strings normalized so spellings compare. */
function routesOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of backticked(text)) {
    const m = /^(GET|POST|PUT|PATCH|DELETE) (\/definitions\/\S*)/.exec(token);
    if (!m) continue;
    const pathPart = m[2].split('?')[0].replace(/\{[^}]*\}/g, '{}').replace(/\*+/g, '{}');
    out.add(`${m[1]} ${pathPart}`);
  }
  return out;
}

describe('builder handoff binding', () => {
  // The entry docs are the human's — one per language. A translation that
  // drifts is a guide that sends someone to a route or a command that is not
  // there, so both are held to the same bindings.
  it.each(INDEX_DOCS)('%s names every handoff, and the directory holds exactly these files', (index) => {
    const readme = read(`docs/guides/builder-handoff/${index}`);
    for (const row of HANDOFFS) {
      expect(readme, `${index} does not list ${row.doc}`).toContain(`docs/guides/builder-handoff/${row.doc}`);
    }
    expect(fs.readdirSync(HANDOFF_DIR).sort()).toEqual([...INDEX_DOCS, ...HANDOFFS.map((h) => h.doc)].sort());
  });

  it.each(INDEX_DOCS)('%s quotes only repo paths that exist', (index) => {
    const paths = backticked(read(`docs/guides/builder-handoff/${index}`))
      .filter((t) => /^(packages|docs|examples)\//.test(t) && !/[{*]/.test(t));
    expect(paths.length).toBeGreaterThan(0);
    for (const rel of paths) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${index} names ${rel}, which does not exist`).toBe(true);
    }
  });

  it('every CLI command the handoffs quote is registered, and every registered command is documented', () => {
    const pkg = JSON.parse(read('packages/ant-cli/package.json')) as { scripts: Record<string, string> };
    const all = [...INDEX_DOCS, ...HANDOFFS.map((h) => h.doc)].map((d) => read(`docs/guides/builder-handoff/${d}`)).join('\n');
    const scripts = [...all.matchAll(/pnpm --filter @ant\/cli ([a-z:-]+)/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of new Set(scripts)) {
      expect(pkg.scripts[script], `package.json has no "${script}" script`).toBeDefined();
    }
    const subcommands = [...all.matchAll(/pnpm --filter @ant\/cli definition ([a-z-]+)/g)].map((m) => m[1]);
    for (const sub of new Set(subcommands)) {
      expect(DEFINITION_CLI_COMMANDS as readonly string[], `"definition ${sub}" is not a command`).toContain(sub);
    }
    for (const cmd of DEFINITION_CLI_COMMANDS) {
      expect(subcommands, `command "${cmd}" is documented in no handoff`).toContain(cmd);
    }
  });

  describe.each(HANDOFFS)('$doc', (row) => {
    const text = read(`docs/guides/builder-handoff/${row.doc}`);
    const agentRel = `${AGENTS_DIR}/${row.agentId}`;
    const hooksRel = `${agentRel}/jobs/${row.jobId}/intents/${row.intentId}/hooks.yaml`;

    it('carries the seven sections in order', () => {
      const positions = SECTIONS.map((h) => text.indexOf(`\n${h}\n`));
      for (const [i, pos] of positions.entries()) {
        expect(pos, `${SECTIONS[i]} missing`).toBeGreaterThan(0);
        if (i > 0) expect(pos).toBeGreaterThan(positions[i - 1]);
      }
    });

    const shipped = [
      ...listFiles(`${agentRel}/base`),
      ...listFiles(`${agentRel}/on-demand`),
      `${agentRel}/jobs/${row.jobId}/job.yaml`,
      ...listFiles(`${agentRel}/jobs/${row.jobId}/base`),
      ...listFiles(`${agentRel}/jobs/${row.jobId}/intents`),
    ];

    it('its read-list names every shipped file of the definition', () => {
      expect(shipped.length).toBeGreaterThan(5);
      const quoted = new Set(backticked(text));
      for (const rel of shipped) {
        expect(quoted.has(rel), `${row.doc} does not name ${rel}`).toBe(true);
      }
    });

    // The bundle is what a clone-less agent holds INSTEAD of these files, so
    // it must carry each of them byte-for-byte, plus the handoff itself and
    // the worked example — a partial bundle is a partial contract.
    it('the composed bundle inlines the handoff and every shipped file verbatim', () => {
      expect(new Set(handoffReadList(row, ROOTS.agentsRoot))).toEqual(new Set(shipped));
      const bundle = composeBuilderHandoff(row, ROOTS, new Date(0));
      expect(bundle).toContain(text.trimEnd());
      for (const rel of shipped) {
        const content = read(rel).trimEnd();
        expect(bundle, `bundle lacks ${rel}`).toContain(`## FILE: \`${rel}\``);
        expect(bundle, `bundle alters ${rel}`).toContain(content);
      }
      expect(bundle).toContain('# Part 3 — Worked example');
      expect(bundle).toContain('## FILE: `examples/custom-agents/ops-team/agent.yaml`');
      // The working-directory rule rides every bundle: outside the clone, or where the person says.
      expect(bundle).toContain('OUTSIDE any Ant clone');
    });

    it('every repo path it quotes exists', () => {
      // Placeholders (`{agentId}`) and globs (`src/**`) name families, not files.
      const paths = backticked(text).filter((t) => /^(packages|docs|examples)\//.test(t) && !/[{*]/.test(t));
      expect(paths.length).toBeGreaterThan(0);
      for (const rel of paths) {
        expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${row.doc} names ${rel}, which does not exist`).toBe(true);
      }
    });

    it('spells the intent hooks exactly as hooks.yaml does', () => {
      const doc = yaml.load(read(hooksRel)) as { hooks: { arm?: string; stop: Array<Record<string, string>> } };
      const quoted = new Set(backticked(text));
      if (doc.hooks.arm) expect(quoted.has(`arm: ${doc.hooks.arm}`), `arm: ${doc.hooks.arm}`).toBe(true);
      for (const hook of doc.hooks.stop) {
        const value = hook.action ?? hook.artifact;
        expect(quoted.has(value), `${row.doc} does not quote hook "${value}"`).toBe(true);
      }
    });

    it('quotes only routes the builder documents' + (row.routesComplete ? ', and all of them' : ''), () => {
      const surface = routesOf(read(`${agentRel}/on-demand/api-surface.md`));
      const quoted = routesOf(text);
      expect(surface.size).toBeGreaterThan(5);
      for (const route of quoted) {
        expect(surface.has(route), `${row.doc} quotes "${route}", which api-surface.md does not document`).toBe(true);
      }
      if (row.routesComplete) {
        for (const route of surface) {
          expect(quoted.has(route), `${row.doc} has no row for "${route}"`).toBe(true);
        }
      }
    });
  });
});
