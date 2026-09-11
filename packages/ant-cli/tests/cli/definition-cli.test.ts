/**
 * The offline `definition` CLI — the same validators the save funnel runs,
 * over folders on disk. Rows call the pure `run*` functions; the entry file is
 * argv parsing only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFINITION_CLI_COMMANDS, EXIT } from '../../src/cli/definition/commands';
import { runValidateAgent } from '../../src/cli/definition/validateAgent';
import { runValidatePipeline } from '../../src/cli/definition/validatePipeline';
import { runPreviewFires } from '../../src/cli/definition/previewFires';
import { runCheckReview, extractTracePaths } from '../../src/cli/definition/checkReview';

const CLI_ROOT = path.resolve(__dirname, '../..');
const BUILTIN_DIR = path.join(CLI_ROOT, 'src/core/data/agents');
const EXAMPLES_AGENTS = path.resolve(CLI_ROOT, '../../examples/custom-agents');
const EXAMPLES_PIPELINE = path.resolve(CLI_ROOT, '../../examples/pipelines/weekly-ops.yaml');

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'definition-cli-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
}

describe('definition CLI — command table', () => {
  it('names exactly the four subcommands the handoffs may quote', () => {
    expect([...DEFINITION_CLI_COMMANDS]).toEqual(['validate-agent', 'validate-pipeline', 'preview-fires', 'check-review']);
    expect(EXIT).toEqual({ CLEAN: 0, FINDINGS: 1, USAGE: 2 });
  });

  it('is registered as the `definition` package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts.definition).toBe('tsx src/cli/definition-cli.ts');
  });
});

describe('validate-agent', () => {
  it.each(fs.readdirSync(BUILTIN_DIR))('shipped %s passes with no findings', (agentId) => {
    const result = runValidateAgent(path.join(BUILTIN_DIR, agentId), { builtinRoot: BUILTIN_DIR });
    expect(result.json.errors).toEqual([]);
    expect(result.exitCode).toBe(EXIT.CLEAN);
    expect(result.json.jobs.length).toBeGreaterThan(0);
  });

  it('the committed example passes (it is the folder the handoff tells an agent to copy)', () => {
    const result = runValidateAgent(path.join(EXAMPLES_AGENTS, 'ops-team'), { builtinRoot: BUILTIN_DIR });
    expect(result.json.errors).toEqual([]);
    expect(result.exitCode).toBe(EXIT.CLEAN);
  });

  it('usage errors: not a folder, bad id, missing agent.yaml', () => {
    expect(runValidateAgent(path.join(tmp, 'nope')).exitCode).toBe(EXIT.USAGE);
    const badId = path.join(tmp, 'Bad_Id');
    writeTree(badId, { 'agent.yaml': 'id: Bad_Id\n' });
    expect(runValidateAgent(badId).exitCode).toBe(EXIT.USAGE);
    const noYaml = path.join(tmp, 'no-yaml');
    fs.mkdirSync(noYaml, { recursive: true });
    expect(runValidateAgent(noYaml).lines[0]).toContain('agent.yaml');
  });

  it('reports the loader H7 verdict and the whitelist verdict with the server wording', () => {
    const dir = path.join(tmp, 'hooked');
    writeTree(dir, {
      'agent.yaml': 'id: hooked\nname: Hooked\nversion: 1\n',
      'base/role.md': 'Role.\n',
      'jobs/run/job.yaml': 'id: run\nname: Run\nversion: 1\ntools:\n  builtin:\n    - read_file\n',
      'jobs/run/base/system.md': 'Do it.\n',
      'jobs/run/intents/go/infer.md': '---\n---\nWhen asked.\n',
      'jobs/run/intents/go/prompt.md': 'Write report/x.md\n',
      'jobs/run/intents/go/hooks.yaml': 'hooks:\n  stop:\n    - artifact: report/*.md\n',
      'notes/stray.txt': 'not a definition file\n',
    });
    const result = runValidateAgent(dir, { builtinRoot: BUILTIN_DIR });
    expect(result.exitCode).toBe(EXIT.FINDINGS);
    expect(result.json.errors.some((e) => e.includes('grants no artifact-write tool'))).toBe(true);
    expect(result.json.errors.some((e) => e.startsWith('notes/stray.txt:') && e.includes('outside the definition whitelist'))).toBe(true);
  });

  it('a folder named like a builtin is the 409 the import would answer', () => {
    const dir = path.join(tmp, 'clash', 'agent-builder');
    writeTree(dir, {
      'agent.yaml': 'id: agent-builder\nname: X\nversion: 1\n',
      'jobs/j/job.yaml': 'id: j\nname: J\nversion: 1\n',
    });
    const result = runValidateAgent(dir, { builtinRoot: BUILTIN_DIR });
    expect(result.json.errors.some((e) => e.includes('taken by a built-in agent'))).toBe(true);
  });

  it('--job narrows to one job and refuses an unknown one', () => {
    const ok = runValidateAgent(path.join(EXAMPLES_AGENTS, 'ops-team'), { job: 'weekly-report', builtinRoot: BUILTIN_DIR });
    expect(ok.exitCode).toBe(EXIT.CLEAN);
    const bad = runValidateAgent(path.join(EXAMPLES_AGENTS, 'ops-team'), { job: 'nope', builtinRoot: BUILTIN_DIR });
    expect(bad.exitCode).toBe(EXIT.USAGE);
  });
});

describe('validate-pipeline', () => {
  it('the committed example is valid against the committed example agents', () => {
    const result = runValidatePipeline(EXAMPLES_PIPELINE, { agents: [EXAMPLES_AGENTS], builtinRoot: BUILTIN_DIR });
    expect(result.json.errors).toEqual([]);
    expect(result.json.catalogWarnings).toEqual([]);
    expect(result.exitCode).toBe(EXIT.CLEAN);
  });

  it('without the agents the binding warns, and --strict turns that into a finding', () => {
    const loose = runValidatePipeline(EXAMPLES_PIPELINE, { builtinRoot: BUILTIN_DIR });
    expect(loose.json.errors).toEqual([]);
    expect(loose.json.catalogWarnings.length).toBeGreaterThan(0);
    expect(loose.exitCode).toBe(EXIT.CLEAN);
    expect(loose.lines.some((l) => l.startsWith('hint:'))).toBe(true);
    const strict = runValidatePipeline(EXAMPLES_PIPELINE, { strict: true, builtinRoot: BUILTIN_DIR });
    expect(strict.exitCode).toBe(EXIT.FINDINGS);
  });

  it('structural errors come back whole, like the save route', () => {
    const file = path.join(tmp, 'broken', 'pipeline.yaml');
    writeTree(path.dirname(file), { 'pipeline.yaml': 'version: 2\nname: Broken\nsteps:\n  - id: a\n    needs: [zzz]\n' });
    const result = runValidatePipeline(file, { builtin: false });
    expect(result.exitCode).toBe(EXIT.FINDINGS);
    expect(result.json.errors.length).toBeGreaterThan(0);
    expect(result.json.id).toBe('broken');
  });

  it('a name that cannot slug and no id folder is a warning naming the fix', () => {
    const file = path.join(tmp, 'korean.yaml');
    fs.writeFileSync(file, 'version: 2\nname: 월간 정산\nsteps:\n  - id: a\n    customJobRef: ops-team/weekly-report\n', 'utf-8');
    const result = runValidatePipeline(file, { agents: [EXAMPLES_AGENTS], builtin: false });
    expect(result.json.id).toBeNull();
    expect(result.json.catalogWarnings.some((w) => w.startsWith('id: cannot derive'))).toBe(true);
  });
});

describe('preview-fires', () => {
  it('answers five fires for a weekly cron', () => {
    const result = runPreviewFires('0 9 * * 1', 'Asia/Seoul');
    expect(result.exitCode).toBe(EXIT.CLEAN);
    expect(result.json.ok).toBe(true);
    expect(result.json.fires).toHaveLength(5);
  });

  it('refuses a cron under the minimum interval and a malformed one', () => {
    expect(runPreviewFires('* * * * *').json.ok).toBe(false);
    expect(runPreviewFires('not a cron').exitCode).toBe(EXIT.FINDINGS);
  });
});

describe('check-review', () => {
  it('diffs the Trace table against the material tree by suffix', () => {
    const material = path.join(tmp, 'material');
    writeTree(material, {
      'intent/work-a.md': '# A\n',
      'intent/work-b.md': '# B\n',
      'intent/deprecated/work-old.md': '# Old\n',
      'readme.txt': 'not markdown\n',
    });
    const report = path.join(tmp, 'review.md');
    fs.writeFileSync(
      report,
      [
        '# Review Report — x (x)',
        '',
        '## Trace',
        '',
        'files listed: 3 · rows: 3 · files without a row: 0',
        '',
        '| material path | unit | verdict | destination | claim | evidence | note |',
        '|---|---|---|---|---|---|---|',
        '| `intent/work-a.md` | A | carried | j/i | claimed | x | |',
        '| material/intent/deprecated/work-old.md | Old | retired-in-material | — | not-claimed | dep | |',
        '| intent/work-ghost.md | ghost | dropped | — | not-claimed | | |',
        '| {path} | {H1} | carried | | | | |',
        '',
        '## Reverse trace',
      ].join('\n'),
      'utf-8',
    );
    const result = runCheckReview(report, material);
    expect(result.json).toEqual({
      files: 3,
      rows: 3,
      missing: ['intent/work-b.md'],
      unknown: ['intent/work-ghost.md'],
    });
    expect(result.exitCode).toBe(EXIT.FINDINGS);
  });

  it('a report with no Trace table is a finding, not a pass', () => {
    const report = path.join(tmp, 'no-trace.md');
    fs.writeFileSync(report, '# Review\n\nnothing here\n', 'utf-8');
    expect(extractTracePaths(fs.readFileSync(report, 'utf-8'))).toBeNull();
    expect(runCheckReview(report, path.join(tmp, 'material')).exitCode).toBe(EXIT.FINDINGS);
  });
});
