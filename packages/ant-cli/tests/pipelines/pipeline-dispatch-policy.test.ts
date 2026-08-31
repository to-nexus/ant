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

  it('the coordinator has chat/tracker parity with the HTTP path (user turn before enqueue, stateTracker forwarded)', () => {
    const coordinator = read('infrastructure/scheduling/PipelineRunCoordinator.ts');
    expect(coordinator).toMatch(/appendUserTurn/);
    // Parity means the HTTP path's WHOLE contract, ceiling included. This row
    // used to require only the append — pinning the uncapped call in place
    // while `/execute` and `/inline-ask` were being capped (M-NEW-029).
    expect(coordinator).toMatch(/DIRECTIVE_MAX_CHARS/);
    expect(coordinator).toMatch(/stateTracker:\s*this\.deps\.stateTracker/);
    // The pipeline is exempt from its own project lock — the coordinator
    // never reads the mutual-exclusion gate.
    expect(coordinator).not.toMatch(/findProjectPipelineActivation/);
  });
});

describe('pipeline↔project mutual exclusion', () => {
  it('every interactive job-start path re-judges the pipeline-owned gate', () => {
    const routes = read('periphery/adapters/http/routes/job.routes.ts');
    expect(routes).toMatch(/findProjectPipelineActivation/);
    // execute + resume + continue + inline-ask all answer the same code.
    expect(routes.match(/project-pipeline-active/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('the availability machine binds the write surface (edit/delete/promote disabled-only, activate enabled-only, disable holder-gated)', () => {
    const routes = read('periphery/adapters/http/routes/pipelines.routes.ts');
    // PUT + DELETE + promote all funnel through the same enabled refusal.
    expect(routes.match(/refuseWhileEnabled\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4); // decl + 3 call sites
    expect(routes).toMatch(/code:\s*'pipeline-enabled'/);
    expect(routes).toMatch(/code:\s*'pipeline-disabled'/);
    // Disable never cascades: it refuses while ANY activation exists.
    expect(routes.match(/code:\s*'pipeline-has-activations'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('deactivation has ONE authority: route and delete/rename cascade both call deactivatePipelineBinding', () => {
    const routes = read('periphery/adapters/http/routes/pipelines.routes.ts');
    const projectService = read('periphery/adapters/http/services/ProjectService/index.ts');
    expect(routes).toMatch(/deactivatePipelineBinding\(/);
    expect(projectService).toMatch(/deactivatePipelineBinding\(/);
    expect(projectService).toMatch(/'pipelineCleanup'/);
    // The leg sequence must not resurface as an inline copy anywhere else.
    for (const file of walk(SRC)) {
      if (file.endsWith(path.join('infrastructure', 'scheduling', 'deactivateBinding.ts'))) continue;
      const src = fs.readFileSync(file, 'utf-8');
      if (src.includes('deleteActivationRecord(') && src.includes('.removeCron(')) {
        throw new Error(`inline deactivation leg copy in ${path.relative(SRC, file)}`);
      }
    }
  });

  it('the fire path resolves definitions ONLY at the activation-pinned scope (no closest-wins)', () => {
    const coordinator = read('infrastructure/scheduling/PipelineRunCoordinator.ts');
    expect(coordinator).toMatch(/resolveDefRoot\(this\.tenantCtx\(owner\), activation\.pipelineScope\)/);
    const reconciler = read('infrastructure/scheduling/PipelineReconciler.ts');
    expect(reconciler).toMatch(/resolveDefRoot\(\{ workspacesPath: deps\.workspacesPath, \.\.\.owner \}, activation\.pipelineScope\)/);
  });

  it('a stale fire is skipped when the project switched pipelines (activation is the authority)', () => {
    const coordinator = read('infrastructure/scheduling/PipelineRunCoordinator.ts');
    expect(coordinator).toMatch(/activation\.pipelineId !== pipelineId/);
  });

  it('activation requires a quiet project (live-job gate) and a universal project', () => {
    const routes = read('periphery/adapters/http/routes/pipelines.routes.ts');
    expect(routes).toMatch(/project-has-live-job/);
    expect(routes).toMatch(/project-has-active-pipeline/);
    expect(routes).toMatch(/project-not-universal/);
    expect(routes).toMatch(/findDuplicateActiveJob/);
  });

  // A definition is a user|org scoped TEMPLATE, activated onto many projects —
  // so its routes are cross-project, and they sit in the `/api/definitions`
  // family beside agents (same scope roots, same ACL store, same promote flow).
  it('pipeline routes mount in the definitions family, never project-scoped', () => {
    const rc = read('periphery/adapters/http/express/config/RouteConfigurator.ts');
    expect(rc).toMatch(/'\/api\/definitions\/pipelines'/);
    expect(rc).not.toMatch(/'\/api\/projects\/:projectId\/pipelines'/);
    // The one project-scoped read stays project-scoped: the chat lock signal.
    expect(rc).toMatch(/'\/api\/projects\/:projectId\/active-pipeline'/);
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

describe('clarify funnel', () => {
  it('a clarify seal parks the step instead of failing the run (v1 restriction retired)', () => {
    const coordinator = read('infrastructure/scheduling/PipelineRunCoordinator.ts');
    expect(coordinator).not.toMatch(/awaiting_clarify_unsupported/);
    expect(coordinator).toMatch(/enterAwaitingClarify/);
    // Session seal read goes through the sessionPaths SSOT, never a hand-rolled join.
    expect(coordinator).toMatch(/getSessionFilePath\(/);
    expect(coordinator).not.toMatch(/join\(containerPath, 'sessions'/);
  });

  it('the answer re-dispatches the SAME step through the single dispatch owner', () => {
    const coordinator = read('infrastructure/scheduling/PipelineRunCoordinator.ts');
    expect(coordinator).toMatch(/async applyClarifyAnswer\(/);
    // applyClarifyAnswer must end in dispatchJobStep (jobId re-pointing rides
    // the normal dispatch: reverse map + step→running + step_dispatched).
    expect(coordinator).toMatch(/applyClarifyAnswer[\s\S]*?dispatchJobStep\(/);
    // The wait is open-ended: no clarify timeout arm exists.
    expect(coordinator).not.toMatch(/cto-/);
  });

  it('both funnels exist: chat clarify-card branch (NX-first) and the account-scoped clarify route', () => {
    const chat = read('periphery/adapters/http/routes/chat.routes.ts');
    expect(chat).toMatch(/clarifying' && result\.resolved/);
    const routes = read('periphery/adapters/http/routes/pipelines.routes.ts');
    expect(routes).toMatch(/\/runs\/:runId\/steps\/:stepId\/clarify/);
    // Own-run check parity with run detail/cancel.
    expect(routes).toMatch(/clarify-already-resolved/);
  });

  it('cancel sweeps awaiting_clarify and stale outcomes cannot clobber a waiting step', () => {
    const coordinator = read('infrastructure/scheduling/PipelineRunCoordinator.ts');
    expect(coordinator).toMatch(/'awaiting_clarify'/);
    // cancelRun sweep includes the clarify wait.
    expect(coordinator).toMatch(/s\.status === 'awaiting_clarify' \|\| s\.status === 'dispatched'/);
    // applyOutcome refuse list includes the clarify wait.
    expect(coordinator).toMatch(/'succeeded', 'failed', 'skipped', 'cancelled', 'awaiting_clarify'/);
  });
});

describe('pipeline run-log graft (read-only)', () => {
  it('the merged view resolves and grafts the pipeline-runs node from the paths SSOT', () => {
    const container = read('core/customAgents/universalContainer.ts');
    expect(container).toMatch(/UNIVERSAL_PIPELINE_RUNS_NODE/);
    expect(container).toMatch(/getPipelineRunsRootOf/);
    expect(container).toMatch(/PIPELINE_ACTIVATIONS_DIRNAME/);
  });

  it('every artifact mutation route blocks the pipeline-runs prefix (delete included — no root-clear)', () => {
    const routes = read('periphery/adapters/http/routes/customAgents.routes.ts');
    expect(routes).toMatch(/reservedRootViolation/);
    expect(routes.match(/reserved-name-pipeline-runs/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

/**
 * L-031 — the account-wide concurrent-run cap.
 *
 * It used to READ a count, COMPARE it, and only reserve much later (the
 * per-activation NX lock), so two activations firing at once both passed an
 * N-1 cap. Exactly the `SCAN`-then-`SETEX` shape M-005 replaced for SSE slots,
 * and the fix is the same primitive: count and reserve in one Lua body.
 */
describe('account concurrent-run cap is reserved atomically', () => {
  const coordinator = read('infrastructure/scheduling/PipelineRunCoordinator.ts');

  it('reserves through the atomic slot primitive', () => {
    expect(coordinator).toMatch(/reserveSlot\(/);
    expect(coordinator).toMatch(/RUN_SLOTS\(/);
    expect(coordinator).toMatch(/maxConcurrentRuns/);
  });

  it('no longer counts live runs by walking activations first', () => {
    // The read-then-compare helper is gone, not merely unused: leaving it
    // available is how the shape comes back.
    expect(coordinator).not.toMatch(/countLiveRuns/);
  });

  it('releases the slot on every path that gives up the activation', () => {
    // A reservation that outlives its run permanently consumes the account's
    // cap — the failure mode a TTL only bounds, never prevents.
    const releases = coordinator.match(/releaseSlot\(/g) ?? [];
    expect(releases.length).toBeGreaterThanOrEqual(2);
  });
});
