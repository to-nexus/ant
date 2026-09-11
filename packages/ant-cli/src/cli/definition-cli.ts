#!/usr/bin/env node
/**
 * ant-cli definition — the offline half of the definition save funnel.
 *
 * An external agent authoring from `docs/guides/builder-handoff/` writes
 * folders instead of calling the API; these commands run the SAME validators
 * the server runs on the way in, so the folder that passes here is the folder
 * the import accepts and the enable gate honours. No server, no Redis.
 *
 *   pnpm --filter @ant/cli definition validate-agent <agentDir> [--job id] [--json]
 *   pnpm --filter @ant/cli definition validate-pipeline <pipeline.yaml> [--agents dir]... [--no-builtin] [--strict] [--json]
 *   pnpm --filter @ant/cli definition preview-fires "<cron>" [--tz zone] [--json]
 *   pnpm --filter @ant/cli definition check-review <report.md> <materialDir> [--json]
 *   pnpm --filter @ant/cli definition handoff <agentId> <jobId> <intentId> [--out file] [--json]
 *
 * Exit codes: 0 clean · 1 findings · 2 usage / IO.
 */

import { Command } from 'commander';
import type { CliResult } from './definition/commands';
import { runValidateAgent } from './definition/validateAgent';
import { runValidatePipeline } from './definition/validatePipeline';
import { runPreviewFires } from './definition/previewFires';
import { runCheckReview } from './definition/checkReview';
import { runHandoff } from './definition/handoff';

function emit(result: CliResult, json: boolean): void {
  process.stdout.write((json ? JSON.stringify(result.json, null, 2) : result.lines.join('\n')) + '\n');
  process.exitCode = result.exitCode;
}

const program = new Command();
program.name('ant-cli definition').description('Validate agent and pipeline definitions offline, with the server\'s own rules');

program
  .command('validate-agent')
  .argument('<agentDir>', 'the agent folder — its name is the agent id')
  .option('--job <id>', 'validate one job only')
  .option('--json', 'print the route-shaped result', false)
  .action((agentDir: string, opts: { job?: string; json: boolean }) => {
    emit(runValidateAgent(agentDir, { job: opts.job }), opts.json);
  });

program
  .command('validate-pipeline')
  .argument('<file>', 'a pipeline.yaml — under a folder named with the id, as on import')
  .option('--agents <dir...>', 'agent folders the pipeline runs (repeatable)')
  .option('--no-builtin', 'leave the shipped builtin agents out of the catalog')
  .option('--strict', 'treat catalog warnings as findings', false)
  .option('--json', 'print the route-shaped result', false)
  .action((file: string, opts: { agents?: string[]; builtin: boolean; strict: boolean; json: boolean }) => {
    emit(runValidatePipeline(file, { agents: opts.agents, builtin: opts.builtin, strict: opts.strict }), opts.json);
  });

program
  .command('preview-fires')
  .argument('<cron>', 'cron expression, quoted')
  .option('--tz <zone>', 'IANA timezone')
  .option('--json', 'print the route-shaped result', false)
  .action((cron: string, opts: { tz?: string; json: boolean }) => {
    emit(runPreviewFires(cron, opts.tz), opts.json);
  });

program
  .command('check-review')
  .argument('<report>', 'a review-report/*.md')
  .argument('<materialDir>', 'the material directory the review enumerated')
  .option('--json', 'print the result', false)
  .action((report: string, materialDir: string, opts: { json: boolean }) => {
    emit(runCheckReview(report, materialDir), opts.json);
  });

program
  .command('handoff')
  .argument('<agentId>', 'a builtin builder: agent-builder | pipeline-builder')
  .argument('<jobId>', 'its job (author)')
  .argument('<intentId>', 'build | review')
  .option('--out <file>', 'write the bundle to this file instead of stdout')
  .option('--json', 'print the manifest instead of the bundle', false)
  .action((agentId: string, jobId: string, intentId: string, opts: { out?: string; json: boolean }) => {
    emit(runHandoff(agentId, jobId, intentId, { out: opts.out }), opts.json);
  });

program.parse(process.argv);
