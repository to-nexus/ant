/**
 * Regression — `error/hooks/command.ts` must bypass itself in verify-mode.
 *
 * Bug (job `civil-flying-golem`): a Tier-2 self-verify error task's verify
 * cycle directed the LLM (via `_shared/verify/hooks/executeHook` +
 * `variants/verification/{base,rules}.md`) to self-validate with
 * tsc/build/test. The apply-phase guard kept firing on every gate command
 * because it only checked `activePhase !== 'plan'`, ignoring the
 * `ctx.verifyModeActive` signal the tool node had set. Result: every
 * verify cycle ended with a `[Policy] BLOCKED` and a non-empty fix plan,
 * `routeAfterDone` kept routing back to `plan`, and the task never reached
 * `checkTaskStatus` — infinite verify loop.
 *
 * The fix is a single line at the top of the guard: when
 * `ctx.verifyModeActive === true`, return `null` so the gate commands flow
 * through to actual execution. Same pattern as the Go-build verify-mode
 * bypass in `agents/common/tool/handlers/codeCommandPolicy.ts`.
 */

import { describe, it, expect } from 'vitest';
import { guard as errorGuard } from '../../../src/agents/architect/graph/code/tasks/error/hooks/command';
import type { ToolExecutionContext } from '../../../src/agents/common/tool/types';

function makeCtx(over: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    activePhase: 'execute',
    currentTaskType: 'error',
    verifyModeActive: false,
    ...over,
  } as unknown as ToolExecutionContext;
}

describe('error command guard — verify-mode 우회 (civil-flying-golem 회귀)', () => {
  it('apply-mode execute + verifies → 차단 (apply 단계 invariant 유지)', () => {
    const result = errorGuard(
      makeCtx({ verifyModeActive: false }),
      { command: 'npm run test', verifies: 'test' },
    );
    expect(result).not.toBeNull();
    expect(result!.content).toMatch(/\[Policy\]/);
    expect(result!.content).toMatch(/Error tasks apply fixes/);
  });

  it('verify-mode execute + verifies → 우회 (null 반환, 실제 실행으로 흘려보냄)', () => {
    const result = errorGuard(
      makeCtx({ verifyModeActive: true }),
      { command: 'npm run test', verifies: 'test' },
    );
    expect(result).toBeNull();
  });

  it('verify-mode execute + typecheck → 우회', () => {
    const result = errorGuard(
      makeCtx({ verifyModeActive: true }),
      { command: 'npx tsc --noEmit', verifies: 'typecheck' },
    );
    expect(result).toBeNull();
  });

  it('verify-mode execute + build → 우회', () => {
    const result = errorGuard(
      makeCtx({ verifyModeActive: true }),
      { command: 'npm run build', verifies: 'build' },
    );
    expect(result).toBeNull();
  });

  it('apply-mode plan phase + verifies → 차단 안 됨 (가드는 execute 페이즈에서만 fire)', () => {
    const result = errorGuard(
      makeCtx({ activePhase: 'plan', verifyModeActive: false }),
      { command: 'npm run test', verifies: 'test' },
    );
    expect(result).toBeNull();
  });

  it('verifyModeActive undefined → apply 모드로 간주 (방어적 기본값)', () => {
    const result = errorGuard(
      makeCtx({ verifyModeActive: undefined }),
      { command: 'npm run test', verifies: 'test' },
    );
    expect(result).not.toBeNull();
    expect(result!.content).toMatch(/BLOCKED/);
  });

  it('verifies 태그가 없는 명령은 phase / verify-mode 무관하게 통과 (apply-mode execute)', () => {
    // install 명령 등은 remediation plan이 요구할 수 있으므로 apply 단계에서도 허용.
    const result = errorGuard(
      makeCtx({ verifyModeActive: false }),
      { command: 'npm install lodash' },
    );
    expect(result).toBeNull();
  });
});
