/**
 * Pipeline dispatch policy — structural guards for the invariants doc 46
 * declares: ONE dispatch owner (UniversalDispatchService), ONE gate rule set
 * (UniversalDispatchGate), the scheduler queue confined to
 * infrastructure/scheduling, and the `ant-jobs` attempts:1 contract untouched.
 * Source-reading policy test (cloud-seam-composition precedent) — one axis,
 * one file; add rows, not files.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('single dispatch owner', () => {
  it('RouteConfigurator.createExecuteJob delegates to UniversalDispatchService', () => {
    const rc = read('periphery/adapters/http/express/config/RouteConfigurator.ts');
    expect(rc).toMatch(/UniversalDispatchService/);
    // The extracted body must not resurface inline.
    expect(rc).not.toMatch(/jobQueue\.enqueue\(\{/);
  });

  it('the coordinator dispatches through UniversalDispatchService and the shared gates', () => {
    const coordinator = read('infrastructure/scheduling/PipelineRunCoordinator.ts');
    expect(coordinator).toMatch(/UniversalDispatchService/);
    expect(coordinator).toMatch(/resolveUniversalExecuteContext/);
    expect(coordinator).toMatch(/validateUniversalTurnMeta/);
    expect(coordinator).toMatch(/findDuplicateActiveJob/);
    expect(coordinator).toMatch(/checkStartCredits/);
  });
});

describe('scheduler confinement', () => {
  it('upsertJobScheduler / ant-pipelines appear only under infrastructure/scheduling', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file);
      if (rel.startsWith(`infrastructure${path.sep}scheduling${path.sep}`)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      if (/upsertJobScheduler|'ant-pipelines'/.test(content)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('ant-jobs keeps attempts: 1 (scheduler retries live on the control queue only)', () => {
    const bullmq = read('infrastructure/queue/BullMQJobQueue.ts');
    expect(bullmq).toMatch(/attempts:\s*1/);
  });
});

describe('approval funnel', () => {
  it('gate advance happens only after an NX-winning choice-resolved', () => {
    const chat = read('periphery/adapters/http/routes/chat.routes.ts');
    expect(chat).toMatch(/pipeline_approval' && result\.resolved/);
    const routes = read('periphery/adapters/http/routes/pipelines.routes.ts');
    // The pipelines approval route must delegate to the same ChatService resolve.
    expect(routes).toMatch(/appendChoiceResolved/);
    expect(routes).toMatch(/if \(!result\.resolved\)/);
  });
});
