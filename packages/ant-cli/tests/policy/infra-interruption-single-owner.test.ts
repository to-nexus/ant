import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * WS1 guard (code-job-flickering-sparkle): infrastructure-reason
 * `InterruptionDetails` must ONLY be built via the single owner
 * `buildInfrastructureInterruption` (@ant/shared/interruption.ts), which
 * applies the jobType→canResume gate. A hand-built object literal that pairs an
 * infra reason with a hardcoded `canResume` lets plan/visual falsely advertise
 * resume and lets the flag drift per site — exactly the divergence this refactor
 * removed. interruption.ts itself is the owner and is exempt.
 *
 * The scan is pure Node (no external `rg` binary) so it runs identically in CI,
 * where ripgrep is not on PATH.
 */

const SRC_DIR = path.resolve(__dirname, '../../src');

// Infra-reason object literal (`reason: '<infra>'`) — the shape the owner replaces.
const INFRA_REASON_RE =
  /reason:\s*'(server_crash|worker_stalled|server_shutdown|process_crash|system_sleep|lock_expired)'/;
// `-A4` window: the hardcoded `canResume:` typically sits within the next few lines.
const CONTEXT_LINES = 4;

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && entry.name !== 'interruption.ts') {
      results.push(full);
    }
  }
  return results;
}

describe('infra interruption single owner', () => {
  it('no hand-built infra-reason InterruptionDetails outside buildInfrastructureInterruption', () => {
    const offending: string[] = [];
    for (const file of collectTsFiles(SRC_DIR)) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((text, i) => {
        if (!INFRA_REASON_RE.test(text)) return;
        const window = lines.slice(i, i + 1 + CONTEXT_LINES).join('\n');
        if (/canResume:/.test(window)) {
          offending.push(`${path.relative(SRC_DIR, file)}:${i + 1}\n${window}`);
        }
      });
    }
    expect(
      offending,
      `Hand-built infra interruption(s) found:\n${offending.join('\n---\n')}`,
    ).toHaveLength(0);
  });
});
