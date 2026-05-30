/**
 * Template Path SSOT — regression locker (3 axes).
 *
 *   1. Path-existence: every TEMPLATE_PATHS triple's `.base / .rules / .system`
 *      points at a real `.md` file on disk. Locks that future partial moves
 *      either update TEMPLATE_PATHS or fail the build.
 *
 *   2. Estimator zero-failed: every mapped intent runs end-to-end through
 *      `estimateBaseline`'s PromptBuilder.build call without producing
 *      `sections.failedTemplates`. Catches the origin-bug class — silent
 *      empty system/user strings — at CI time.
 *
 *   3. Raw-literal AST grep: no production builder under
 *      `packages/ant-cli/src/agents/**` reintroduces a raw
 *      `'jobs/.../nodes/.../(base|rules)(-keyword)?'` string literal.
 *      Forces every new prompt node site to import from TEMPLATE_PATHS
 *      so prod and estimator share a single SSOT.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TEMPLATE_PATHS } from '../../../src/core/prompt/builder/templatePaths';
import { HEAVIEST_NODE_BY_INTENT } from '../../../src/core/baselineEstimate/heaviestNode';
import { PromptBuilder } from '../../../src/core/prompt/builder/PromptBuilder';
import { FilePromptAdapter, initPartials } from '../../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_ROOT = path.resolve(
  __dirname,
  '../../../src/core/prompt/templates',
);

const AGENTS_ROOT = path.resolve(__dirname, '../../../src/agents');

const TEMPLATE_PATHS_FILE = path.resolve(
  __dirname,
  '../../../src/core/prompt/builder/templatePaths.ts',
);

describe('Template Path SSOT — path-existence lock', () => {
  it('every TEMPLATE_PATHS entry points at .md files that exist', () => {
    const missing: string[] = [];
    for (const [key, triple] of Object.entries(TEMPLATE_PATHS)) {
      for (const field of ['base', 'rules', 'system'] as const) {
        const value = (triple as Record<string, string | undefined>)[field];
        if (!value) continue;
        const file = path.join(TEMPLATES_ROOT, `${value}.md`);
        if (!fs.existsSync(file)) {
          missing.push(`TEMPLATE_PATHS.${key}.${field} → ${value}.md`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('Template Path SSOT — estimator zero-failed lock', () => {
  beforeAll(async () => {
    // Register all `.md` files under templates/ as Handlebars partials so
    // base.md's `{{> jobs/shared/injections/role-guide}}` etc. resolve at
    // render time (production wires this in server.ts / job-runner.ts).
    await initPartials(TEMPLATES_ROOT);
  });

  it('every mapped intent renders without failedTemplates', async () => {
    // Pass explicit baseDir so the test does not depend on
    // `ANT_CLI_ROOT` / cwd at vitest invocation time.
    const adapter = new FilePromptAdapter(TEMPLATES_ROOT);
    const builder = new PromptBuilder(adapter);
    const failures: Array<{ intent: string; failed: string[] }> = [];

    for (const [intent, mapping] of Object.entries(HEAVIEST_NODE_BY_INTENT)) {
      if (!mapping) continue;
      try {
        const built = await builder.build({
          templates: mapping.templates,
          intent: intent as any,
          techContext: {
            taskType: 'feature',
            mode: 'generate',
            resolvedAction: {
              intent: intent as any,
              mode: 'generate',
              refs: [],
              context: [],
              source: 'infer',
              hasExplicitFields: false,
            } as any,
          },
          pipeline: {
            sanitizeInput: false,
            applyPolicyGuardrails: false,
          },
          vars: {
            userMessage: '',
            userLanguage: 'en',
            workspaceState: undefined,
            resolvedAction: { intent, mode: 'generate' },
          },
        });
        if (built.sections.failedTemplates.length > 0) {
          failures.push({ intent, failed: built.sections.failedTemplates });
        }
      } catch (err) {
        failures.push({ intent, failed: [`THROW: ${(err as Error).message}`] });
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('Template Path SSOT — raw-literal AST grep lint', () => {
  /**
   * Recursively walk a directory, yielding TypeScript source paths.
   * Stops at `node_modules` and test folders.
   */
  function* walkTs(dir: string): IterableIterator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walkTs(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        yield full;
      }
    }
  }

  it('no production builder reintroduces a raw base/rules literal', () => {
    // Match `'jobs/{job}/nodes/{node}[/variants/{v}]/(base|rules)[-keyword]'`.
    // Quote-aware so substrings inside JSDoc / comments / interpolation are
    // generally ignored.
    const pattern = /'jobs\/[a-z-]+\/nodes\/[a-z-]+\/(variants\/[a-z-]+\/)?(base|rules)(-keyword)?'/;
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    for (const file of walkTs(AGENTS_ROOT)) {
      const content = fs.readFileSync(file, 'utf8');
      content.split('\n').forEach((line, idx) => {
        if (pattern.test(line)) {
          offenders.push({ file: path.relative(AGENTS_ROOT, file), line: idx + 1, text: line.trim() });
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('TEMPLATE_PATHS module is the only place that owns base/rules strings', () => {
    // Sanity: the SSOT module itself MUST contain the patterns.
    const src = fs.readFileSync(TEMPLATE_PATHS_FILE, 'utf8');
    const pattern = /'jobs\/[a-z-]+\/nodes\/[a-z-]+\/(variants\/[a-z-]+\/)?(base|rules)(-keyword)?'/g;
    const matches = src.match(pattern) ?? [];
    // Sanity floor: at least 20 path strings live here (current 28 entries
    // × ≥1 path each → ~70 total; floor leaves slack for future refactors).
    expect(matches.length).toBeGreaterThanOrEqual(20);
  });
});
