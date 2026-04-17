#!/usr/bin/env node
/**
 * `pnpm scenario` — Verification Scenario runner CLI.
 *
 * This file is intentionally thin: all orchestration lives in
 * `tests/verification-scenarios/runner.ts` so the library can be unit-tested
 * without re-parsing argv.
 *
 * Supported invocations (see docs/testing/verification-scenarios.md §3):
 *   pnpm scenario --list
 *   pnpm scenario S02
 *   pnpm scenario S01 S02 S03
 *   pnpm scenario --all [--keep=fail|all|none] [--max-runs=N] [--real-llm]
 */

import {
  listScenarios,
  resolveScenario,
  runScenario,
  ScenarioDescriptor,
  RunnerOptions,
  KeepPolicy,
} from '../tests/verification/scenarios/runner';
import type { ScenarioRunResult } from '@ant/shared';

interface ParsedArgs {
  list: boolean;
  all: boolean;
  ids: string[];
  keep?: KeepPolicy;
  maxRuns?: number;
  realLLM: boolean;
  verbose: boolean;
}

function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    list: false,
    all: false,
    ids: [],
    realLLM: false,
    verbose: false,
  };
  for (const raw of argv) {
    if (raw === '--list') out.list = true;
    else if (raw === '--all') out.all = true;
    else if (raw === '--real-llm') out.realLLM = true;
    else if (raw === '--verbose' || raw === '-v') out.verbose = true;
    else if (raw.startsWith('--keep=')) {
      const val = raw.split('=')[1];
      if (!['fail', 'all', 'none'].includes(val)) {
        throw new Error(`Invalid --keep value: ${val} (expected fail|all|none)`);
      }
      out.keep = val as KeepPolicy;
    } else if (raw.startsWith('--max-runs=')) {
      out.maxRuns = Number(raw.split('=')[1]);
      if (!Number.isFinite(out.maxRuns) || out.maxRuns <= 0) {
        throw new Error(`Invalid --max-runs value: ${raw}`);
      }
    } else if (raw.startsWith('-')) {
      throw new Error(`Unknown flag: ${raw}`);
    } else {
      out.ids.push(raw);
    }
  }
  return out;
}

function printList(): void {
  const all = listScenarios();
  const rows = all.map(s => ({
    id: s.id,
    name: s.config.name,
    mode: s.config.mode,
    description: s.config.description ?? '',
  }));
  console.log(JSON.stringify(rows, null, 2));
}

function formatResult(result: ScenarioRunResult): string {
  const icon = result.passed ? '✅' : '❌';
  const dur = `${(result.durationMs / 1000).toFixed(2)}s`;
  const suffix = result.diffSummary ? `\n    ${result.diffSummary.replace(/\n/g, '\n    ')}` : '';
  const warn = result.warnings ? `\n    ⚠️  ${result.warnings.join('; ')}` : '';
  return `${icon} ${result.scenarioId} ${result.name} (${dur})${warn}${suffix}`;
}

async function main(): Promise<void> {
  const args = parseArgv(process.argv.slice(2));

  if (args.list) {
    printList();
    return;
  }

  let scenarios: ScenarioDescriptor[];
  if (args.all) {
    scenarios = listScenarios();
    if (scenarios.length === 0) {
      console.error('No scenarios found under tests/verification/scenarios/scenarios');
      process.exit(1);
    }
  } else if (args.ids.length > 0) {
    scenarios = args.ids.map(id => resolveScenario(id));
  } else {
    console.error('Usage: pnpm scenario [--list | --all | <scenarioId>...] [--keep=fail|all|none] [--max-runs=N] [--real-llm]');
    process.exit(1);
  }

  const opts: RunnerOptions = {
    realLLM: args.realLLM,
    keep: args.keep,
    maxRuns: args.maxRuns,
    verbose: args.verbose,
  };

  const results: ScenarioRunResult[] = [];
  for (const descriptor of scenarios) {
    console.log(`\n▶ ${descriptor.id} ${descriptor.config.name} [${descriptor.config.mode}]`);
    try {
      const result = await runScenario(descriptor, opts);
      results.push(result);
      console.log(formatResult(result));
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(`❌ ${descriptor.id} runner error: ${message}`);
      results.push({
        scenarioId: descriptor.id,
        name: descriptor.config.name,
        passed: false,
        durationMs: 0,
        runDir: '',
        diffSummary: message,
      });
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(`\nResult: ${passed}/${results.length} passed${failed > 0 ? `, ${failed} failed` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
