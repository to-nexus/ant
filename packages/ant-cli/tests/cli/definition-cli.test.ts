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
import { runCheckReport, PIPELINE_REPORT_SECTIONS, DEPENDENCY_REPORT_SECTIONS } from '../../src/cli/definition/checkReport';
import { runHandoff } from '../../src/cli/definition/handoff';

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
  it('names exactly the six subcommands the handoffs may quote', () => {
    expect([...DEFINITION_CLI_COMMANDS]).toEqual([
      'validate-agent',
      'validate-pipeline',
      'preview-fires',
      'check-review',
      'check-report',
      'handoff',
    ]);
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
    expect(result.json.advisories.open).toEqual([]);
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

  it('advisories print apart from warnings, and only --strict turns an OPEN one into a finding', () => {
    const gated = (extra = '', gateExtra = '') =>
      `version: 2\nname: Gated\nsteps:\n  - id: draft\n    customJobRef: ops-team/weekly-report\n    intent: report\n  - id: sign\n    type: approval\n    prompt: ok?\n${gateExtra}  - id: escalate\n    customJobRef: ops-team/weekly-report\n    intent: escalate\n${extra}`;
    const file = path.join(tmp, 'gated', 'pipeline.yaml');
    writeTree(path.dirname(file), { 'pipeline.yaml': gated() });
    const loose = runValidatePipeline(file, { agents: [EXAMPLES_AGENTS], builtin: false });
    expect(loose.json.catalogWarnings).toEqual([]);
    expect(loose.json.advisories.open.map((a) => a.code)).toEqual(['gate-waits-forever']);
    expect(loose.lines.some((l) => l.startsWith('advisory: '))).toBe(true);
    expect(loose.lines.some((l) => l.startsWith('warning: '))).toBe(false);
    expect(loose.exitCode).toBe(EXIT.CLEAN);
    expect(runValidatePipeline(file, { agents: [EXAMPLES_AGENTS], builtin: false, strict: true }).exitCode).toBe(EXIT.FINDINGS);

    writeTree(path.dirname(file), { 'pipeline.yaml': gated('acknowledged:\n  - code: gate-waits-forever\n    step: sign\n    reason: the owner reads the inbox daily\n') });
    const acked = runValidatePipeline(file, { agents: [EXAMPLES_AGENTS], builtin: false, strict: true });
    expect(acked.json.advisories.open).toEqual([]);
    expect(acked.json.advisories.acknowledged.map((a) => a.reason)).toEqual(['the owner reads the inbox daily']);
    expect(acked.lines.some((l) => l.startsWith('acknowledged: gate-waits-forever @ sign'))).toBe(true);
    expect(acked.exitCode).toBe(EXIT.CLEAN);

    writeTree(path.dirname(file), { 'pipeline.yaml': gated('acknowledged:\n  - code: gate-waits-forever\n    step: sign\n    reason: was by design\n', '    remindAfter: 4h\n') });
    const stale = runValidatePipeline(file, { agents: [EXAMPLES_AGENTS], builtin: false, strict: true });
    expect(stale.json.advisories.stale).toHaveLength(1);
    expect(stale.lines.some((l) => l.startsWith('stale: acknowledged gate-waits-forever @ sign'))).toBe(true);
    expect(stale.exitCode).toBe(EXIT.CLEAN);
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

describe('check-report', () => {
  // The committed example: ops-team declares weekly-report/{report,escalate}
  // (chat has no intent catalog) and weekly-ops.yaml runs both, so a report
  // that accounts for them is the clean pass.
  const FLOW_OK = [
    '# Weekly ops — weekly-ops',
    '',
    'pipelines: 1 · boundaries: 0 · intents: 2 · scheduled: 2 · not scheduled: 0',
    '',
    '## Flow',
    '- weekly-ops-report (cron) — no split',
    '',
    '## Intent coverage',
    '| agent/job/intent | runs at | note |',
    '|---|---|---|',
    '| ops-team/weekly-report/report | weekly-ops-report/draft | |',
    '| ops-team/weekly-report/escalate | weekly-ops-report/escalate | |',
    '',
    '## Seams',
    '- none',
    '## Relays',
    '- none',
    '## Substitutes',
    '- none',
    '## Intent changes this flow needs',
    '- none',
    '## Outcome coverage',
    '- weekly-ops-report / success: skips none',
    '## Run entry',
    '- weekly-ops-report/draft asks nobody',
    '## Judgment calls',
    '- none',
    '## Left to a person',
    '- enable and activate',
    '',
  ];
  const pipelineOpts = { pipelines: [EXAMPLES_PIPELINE], agents: [EXAMPLES_AGENTS] };
  const writeReport = (name: string, lines: string[]): string => {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, lines.join('\n'), 'utf-8');
    return file;
  };
  const kinds = (file: string, opts: Parameters<typeof runCheckReport>[1]) =>
    runCheckReport(file, opts).json.findings.map((f) => `${f.kind}: ${f.subject}`);

  it('the section lists are the shipped skeletons\' headings — the checker never invents a token', () => {
    const read = (agentId: string) =>
      fs.readFileSync(path.join(BUILTIN_DIR, agentId, 'jobs', 'author', 'intents', 'build', 'prompt.md'), 'utf-8');
    const pipelinePrompt = read('pipeline-builder');
    for (const h of PIPELINE_REPORT_SECTIONS) expect(pipelinePrompt).toContain(`\n## ${h}\n`);
    expect(pipelinePrompt).toContain('pipelines: N · boundaries: N−1 · intents: M · scheduled: K · not scheduled: M−K');
    const agentPrompt = read('agent-builder');
    for (const h of DEPENDENCY_REPORT_SECTIONS) expect(agentPrompt).toContain(`## ${h}\n`);
    expect(agentPrompt).toContain('jobs: J · intents: I · units mapped: U · dropped: D');
  });

  it('a flow report that accounts for the committed example passes clean', () => {
    const result = runCheckReport(writeReport('flow-ok.md', FLOW_OK), pipelineOpts);
    expect(result.json.findings).toEqual([]);
    expect(result.json.counts).toEqual({ pipelines: 1, intents: 2, scheduled: 2, 'not scheduled': 0, steps: 2 });
    expect(result.exitCode).toBe(EXIT.CLEAN);
    expect(result.lines.at(-1)).toMatch(/^ok: pipeline report/);
  });

  it('a dropped row is missing, an invented one is unknown, and the count line must still agree', () => {
    const lines = FLOW_OK.map((l) =>
      l.startsWith('| ops-team/weekly-report/escalate') ? '| ops-team/weekly-report/ghost | not scheduled | never existed |' : l,
    );
    const found = kinds(writeReport('flow-missing.md', lines), pipelineOpts);
    expect(found).toContain('missing: ops-team/weekly-report/escalate');
    expect(found).toContain('unknown: ops-team/weekly-report/ghost');
    expect(found).toContain('unaccounted-step: weekly-ops-report/escalate (runs ops-team/weekly-report/escalate)');
    expect(found).toContain('count-mismatch: scheduled: 2 (report) vs 1 (definitions)');
  });

  it('`not scheduled` without a reason, and a step that runs something else, are findings', () => {
    const lines = FLOW_OK.map((l) => {
      if (l.startsWith('| ops-team/weekly-report/report')) return '| ops-team/weekly-report/report | weekly-ops-report/escalate | |';
      if (l.startsWith('| ops-team/weekly-report/escalate')) return '| ops-team/weekly-report/escalate | not scheduled | |';
      return l;
    });
    const found = kinds(writeReport('flow-mismatch.md', lines), pipelineOpts);
    expect(found).toContain('mismatch: ops-team/weekly-report/report → weekly-ops-report/escalate: that step runs ops-team/weekly-report/escalate');
    expect(found).toContain('unreasoned: ops-team/weekly-report/escalate — not scheduled, no reason');
    expect(found).toContain('unaccounted-step: weekly-ops-report/draft (runs ops-team/weekly-report/report)');
  });

  it('a report on the pre-coverage skeleton names every section it lacks, and no table', () => {
    const legacy = writeReport('flow-legacy.md', ['# x — x', '', '## Substitutes', '- a', '## Human seams', '- b', '## Left to a person', '- c']);
    const found = kinds(legacy, pipelineOpts);
    expect(found).toContain('section-missing: ## Intent coverage');
    expect(found).toContain('section-missing: ## Judgment calls');
    expect(found).toContain('table-missing: ## Intent coverage — no table');
    expect(found.some((f) => f.startsWith('count-line-missing:'))).toBe(true);
  });

  it('a dependency report that maps every intent of the definition passes clean', () => {
    const report = writeReport('dep-ok.md', [
      '# Dependency Report — Ops team (ops-team)',
      '',
      'jobs: 2 · intents: 2 · units mapped: 2 · dropped: 1',
      '',
      'status: virtual · provided · wired',
      '',
      '## Incident tracker',
      '- used-by: weekly-report/report',
      '- status: wired',
      '',
      '## Mapping as built',
      '| work unit, as the material names it | performed by |',
      '|---|---|',
      '| weekly incident digest | weekly-report/report |',
      '| paging the on-call | weekly-report/escalate |',
      '| quarterly retro | dropped — no cadence in the material |',
      '',
      '## Hook decisions',
      '- weekly-report: report and escalate carry artifact hooks',
      '- chat: none — a conversation owes nothing',
      '',
      '## Deliverable contracts',
      '- reports/*.md: produced by report, consumed by escalate',
      '',
      '## Judgment calls',
      '- none',
    ]);
    const result = runCheckReport(report, { agent: path.join(EXAMPLES_AGENTS, 'ops-team') });
    expect(result.json.findings).toEqual([]);
    expect(result.json.counts).toEqual({ jobs: 2, intents: 2, 'units mapped': 2, dropped: 1 });
    expect(result.exitCode).toBe(EXIT.CLEAN);
  });

  it('an intent the mapping never names, a job Hook decisions skips, and an intent the definition lacks', () => {
    const report = writeReport('dep-gap.md', [
      '# Dependency Report — Ops team (ops-team)',
      '',
      'jobs: 2 · intents: 2 · units mapped: 1 · dropped: 0',
      '',
      '## Mapping as built',
      '| work unit | performed by |',
      '|---|---|',
      '| weekly incident digest | weekly-report/summarize |',
      '',
      '## Hook decisions',
      '- weekly-report: report carries an artifact hook',
      '',
      '## Deliverable contracts',
      '- none',
      '',
      '## Judgment calls',
      '- none',
    ]);
    const found = kinds(report, { agent: path.join(EXAMPLES_AGENTS, 'ops-team') });
    expect(found).toContain('unmapped-intent: weekly-report/report');
    expect(found).toContain('unmapped-intent: weekly-report/escalate');
    expect(found).toContain('unknown: weekly-report/summarize');
    expect(found).toContain('missing-job: ## Hook decisions names no line for job "chat"');
  });

  it('usage: one lane, not both; the agents are required for a flow report', () => {
    const report = writeReport('any.md', FLOW_OK);
    expect(runCheckReport(report, {}).exitCode).toBe(EXIT.USAGE);
    expect(runCheckReport(report, { pipelines: [EXAMPLES_PIPELINE], agent: EXAMPLES_AGENTS }).exitCode).toBe(EXIT.USAGE);
    expect(runCheckReport(report, { pipelines: [EXAMPLES_PIPELINE] }).exitCode).toBe(EXIT.USAGE);
    expect(runCheckReport(path.join(tmp, 'nope.md'), pipelineOpts).exitCode).toBe(EXIT.USAGE);
  });
});

describe('handoff', () => {
  const roots = {
    agentsRoot: BUILTIN_DIR,
    docsRoot: path.resolve(CLI_ROOT, '../../docs'),
    examplesRoot: path.resolve(CLI_ROOT, '../../examples'),
  };

  it('prints a self-contained bundle for a known builder intent', () => {
    const result = runHandoff('agent-builder', 'author', 'build', { roots });
    expect(result.exitCode).toBe(EXIT.CLEAN);
    expect(result.json?.files.length).toBeGreaterThan(5);
    expect(result.lines[0]).toContain('# Part 1 — Handoff');
    expect(result.lines[0]).toContain('## FILE: `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/prompt.md`');
  });

  it('--out writes the file and reports its size', () => {
    const out = path.join(tmp, 'bundles', 'review.md');
    const result = runHandoff('pipeline-builder', 'author', 'review', { out, roots });
    expect(result.exitCode).toBe(EXIT.CLEAN);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBe(result.json?.bytes);
  });

  it('an unknown triple is a usage error naming the known ones', () => {
    const result = runHandoff('assistant', 'chat', 'analysis', { roots });
    expect(result.exitCode).toBe(EXIT.USAGE);
    expect(result.lines[0]).toContain('agent-builder author build');
  });
});
