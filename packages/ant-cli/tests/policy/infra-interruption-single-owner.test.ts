import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * WS1 guard (code-job-flickering-sparkle): infrastructure-reason
 * `InterruptionDetails` must ONLY be built via the single owner
 * `buildInfrastructureInterruption` (@ant/shared/interruption.ts), which
 * applies the jobType→canResume gate. A hand-built object literal that pairs an
 * infra reason with a hardcoded `canResume` lets plan/visual falsely advertise
 * resume and lets the flag drift per site — exactly the divergence this refactor
 * removed. interruption.ts itself is the owner and is exempt.
 */
describe('infra interruption single owner', () => {
  it('no hand-built infra-reason InterruptionDetails outside buildInfrastructureInterruption', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    // Infra-reason object literal (`reason: '<infra>'`) with a hardcoded
    // `canResume:` within the next few lines — the shape the owner replaces.
    const pattern =
      "reason: '(server_crash|worker_stalled|server_shutdown|process_crash|system_sleep|lock_expired)'";
    let out = '';
    try {
      out = execFileSync(
        'rg',
        ['-n', '--type', 'ts', '-A4', pattern, srcDir, '-g', '!**/interruption.ts'],
        { encoding: 'utf-8' },
      );
    } catch (e: any) {
      // rg exits 1 when there are no matches at all — that is the pass case.
      if (e.status === 1) return;
      throw e;
    }
    const offending = out
      .split(/\n(?=[^\s])/) // group each match block
      .filter((block) => /canResume:/.test(block));
    expect(offending, `Hand-built infra interruption(s) found:\n${offending.join('\n---\n')}`).toHaveLength(0);
  });
});
