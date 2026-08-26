/**
 * Tests for NodeCommandAdapter.isAllowed().
 *
 * Validates:
 * - Basic allowed/disallowed commands
 * - Compound commands (&&, ||, ;, |)
 * - Quoted strings containing pipe-like characters
 * - Backslash-escaped pipes (grep BRE alternation)
 * - Newly added commands (cargo, tsx, nodemon, vite, bun, tsc, turbo)
 * - Relative binary paths (./app)
 *
 * The `shellParser` primitives this adapter is built on (splitOnShellOperators /
 * tokenizeShellSegment / hasActualPipe) are unit-tested by their owner,
 * `tests/utils/shellParser.test.ts`. This file previously carried a second copy
 * of all three; asserting a pure function in two suites is how the copies drift.
 * Cases here must go through `isAllowed`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NodeCommandAdapter } from '../../src/periphery/adapters/command/NodeCommandAdapter.js';

let adapter: NodeCommandAdapter;

describe('NodeCommandAdapter.isAllowed', () => {
  beforeEach(() => {
    delete process.env.ANT_UNSAFE_ALLOW_ALL_COMMANDS;
    adapter = new NodeCommandAdapter();
  });
  describe('basic commands', () => {
    it('allows simple whitelisted commands', () => {
      expect(adapter.isAllowed('ls')).toBe(true);
      expect(adapter.isAllowed('grep -rn "foo" src/')).toBe(true);
      expect(adapter.isAllowed('npm install')).toBe(true);
      expect(adapter.isAllowed('git status')).toBe(true);
    });

    it('rejects unknown commands', () => {
      expect(adapter.isAllowed('perl script.pl')).toBe(false);
      expect(adapter.isAllowed('ruby script.rb')).toBe(false);
      expect(adapter.isAllowed('bash -c "rm -rf /"')).toBe(false);
    });

    it('rejects empty commands', () => {
      expect(adapter.isAllowed('')).toBe(false);
      expect(adapter.isAllowed('   ')).toBe(false);
    });
  });

  describe('newly added commands', () => {
    it('allows cargo (Rust)', () => {
      expect(adapter.isAllowed('cargo run')).toBe(true);
      expect(adapter.isAllowed('cargo build --release')).toBe(true);
      expect(adapter.isAllowed('cargo test')).toBe(true);
    });

    it('allows tsx (TypeScript execution)', () => {
      expect(adapter.isAllowed('tsx server.ts')).toBe(true);
      expect(adapter.isAllowed('tsx watch src/index.ts')).toBe(true);
    });

    it('allows nodemon', () => {
      expect(adapter.isAllowed('nodemon app.js')).toBe(true);
    });

    it('allows vite (direct invocation)', () => {
      expect(adapter.isAllowed('vite')).toBe(true);
      expect(adapter.isAllowed('vite preview')).toBe(true);
      expect(adapter.isAllowed('vite build')).toBe(true);
    });

    it('allows bun (Bun runtime)', () => {
      expect(adapter.isAllowed('bun run build')).toBe(true);
      expect(adapter.isAllowed('bun test')).toBe(true);
    });

    it('allows tsc (TypeScript compiler)', () => {
      expect(adapter.isAllowed('tsc --noEmit')).toBe(true);
    });

    it('allows turbo (Turborepo)', () => {
      expect(adapter.isAllowed('turbo run build')).toBe(true);
    });

    it('allows the Python runtime (python3/python/uv)', () => {
      // cyan-healing-drake regression: these exact shapes were blocked mid-job.
      expect(adapter.isAllowed('python3 codebase/gen_report.py')).toBe(true);
      expect(adapter.isAllowed('python3 -c "import os"')).toBe(true);
      expect(adapter.isAllowed('cat x | python3 -c "import sys"')).toBe(true);
      expect(adapter.isAllowed('python script.py')).toBe(true);
      expect(adapter.isAllowed('uv sync')).toBe(true);
      expect(adapter.isAllowed('uv run pytest')).toBe(true);
    });

    it('allows read-only encoding/checksum utilities', () => {
      expect(adapter.isAllowed('base64 -w 0 "codebase/스크린샷.png" | wc -c')).toBe(true);
      expect(adapter.isAllowed('od -c file.bin | head')).toBe(true);
      expect(adapter.isAllowed('xxd file.bin | head')).toBe(true);
      expect(adapter.isAllowed('sha256sum dist/app.tgz')).toBe(true);
      expect(adapter.isAllowed('shasum -a 256 dist/app.tgz')).toBe(true);
      expect(adapter.isAllowed('md5sum dist/app.tgz')).toBe(true);
      expect(adapter.isAllowed("printf '%s\\n' done")).toBe(true);
    });

    it('allows archive tools', () => {
      expect(adapter.isAllowed('tar -xzf assets.tgz -C codebase/assets')).toBe(true);
      expect(adapter.isAllowed('gunzip data.json.gz')).toBe(true);
      expect(adapter.isAllowed('gzip -k data.json')).toBe(true);
      expect(adapter.isAllowed('unzip fonts.zip -d codebase/fonts')).toBe(true);
      expect(adapter.isAllowed('zip -r out.zip dist/')).toBe(true);
    });

    it('allows read-only system diagnostics', () => {
      expect(adapter.isAllowed('uname -a')).toBe(true);
      expect(adapter.isAllowed('id')).toBe(true);
      expect(adapter.isAllowed('whoami')).toBe(true);
      expect(adapter.isAllowed('hostname')).toBe(true);
      expect(adapter.isAllowed('nproc')).toBe(true);
    });
  });

  describe('wrapper commands check the wrapped command', () => {
    it('allows timeout/env wrapping an allowlisted command', () => {
      expect(adapter.isAllowed('timeout 30 go test ./...')).toBe(true);
      expect(adapter.isAllowed('timeout 5s curl http://localhost:4100/api/health')).toBe(true);
      expect(adapter.isAllowed('env FOO=1 node script.js')).toBe(true);
      expect(adapter.isAllowed('env timeout 10 npm test')).toBe(true);
      expect(adapter.isAllowed('env')).toBe(true);
    });

    it('rejects timeout/env wrapping a disallowed command', () => {
      expect(adapter.isAllowed('timeout 30 bash -c "ls"')).toBe(false);
      expect(adapter.isAllowed('env bash -c "ls"')).toBe(false);
      expect(adapter.isAllowed('env FOO=1 perl evil.pl')).toBe(false);
    });
  });

  describe('relative binary paths (./app)', () => {
    it('allows simple relative binaries', () => {
      expect(adapter.isAllowed('./main')).toBe(true);
      expect(adapter.isAllowed('./app')).toBe(true);
      expect(adapter.isAllowed('./server')).toBe(true);
      expect(adapter.isAllowed('./my-app')).toBe(true);
      expect(adapter.isAllowed('./my_app.bin')).toBe(true);
    });

    it('allows compiled binary after build chain', () => {
      expect(adapter.isAllowed('go build -o app && ./app')).toBe(true);
      expect(adapter.isAllowed('cd codebase && ./main')).toBe(true);
      expect(adapter.isAllowed('cargo build --release && ./target/release/app')).toBe(false);
    });

    it('rejects path traversal or subdirectories', () => {
      expect(adapter.isAllowed('../app')).toBe(false);
      expect(adapter.isAllowed('./sub/dir/app')).toBe(false);
      expect(adapter.isAllowed('./-flaglike')).toBe(false);
    });
  });

  describe('project-local node_modules/.bin binaries', () => {
    it('allows a locally-installed CLI invoked directly', () => {
      expect(adapter.isAllowed('node_modules/.bin/vitest --version')).toBe(true);
      expect(adapter.isAllowed('./node_modules/.bin/tsc --noEmit')).toBe(true);
      expect(adapter.isAllowed('cd apps/admin && node_modules/.bin/vitest --version 2>&1 || true')).toBe(true);
    });

    it('still rejects path traversal or arbitrary nested binaries', () => {
      expect(adapter.isAllowed('node_modules/.bin/../../evil')).toBe(false);
      expect(adapter.isAllowed('some/other/path/bin')).toBe(false);
    });
  });

  describe('read-only diagnostics (Fix 2)', () => {
    it('allows POSIX test/[ conditionals and path/file inspection', () => {
      expect(adapter.isAllowed('test -d codebase/node_modules && echo installed || echo missing')).toBe(true);
      expect(adapter.isAllowed('readlink node_modules/typescript 2>&1 || echo "not a symlink"')).toBe(true);
      expect(adapter.isAllowed('[ -f package.json ] && echo yes')).toBe(true);
      expect(adapter.isAllowed('stat package.json')).toBe(true);
      expect(adapter.isAllowed('realpath ./src')).toBe(true);
      expect(adapter.isAllowed('basename /a/b/c.ts')).toBe(true);
      expect(adapter.isAllowed('dirname /a/b/c.ts')).toBe(true);
    });

    it('allows read-only text/data pipes', () => {
      expect(adapter.isAllowed('cat pnpm-lock.yaml | jq .')).toBe(true);
      expect(adapter.isAllowed('cat package.json | jq -r .name')).toBe(true);
      expect(adapter.isAllowed('echo a:b:c | cut -d: -f2')).toBe(true);
      expect(adapter.isAllowed('cat f | tr a-z A-Z')).toBe(true);
    });

    it('STILL rejects write-policy bypass and shell-escape commands', () => {
      // tee/ln bypass the write-target policy; sh/bash -c bypasses this allowlist.
      expect(adapter.isAllowed('tee .npmrc')).toBe(false);
      expect(adapter.isAllowed('ln -s /tmp/test .symlink_test')).toBe(false);
      expect(adapter.isAllowed('sh -c "ls"')).toBe(false);
      expect(adapter.isAllowed('dd if=/dev/zero of=big.bin')).toBe(false);
    });
  });

  describe('compound commands', () => {
    it('allows piped commands when both sides are whitelisted', () => {
      expect(adapter.isAllowed('grep -rn "foo" src/ | head -20')).toBe(true);
      expect(adapter.isAllowed('cat file.txt | sort | uniq')).toBe(true);
      expect(adapter.isAllowed('ls -la | grep test')).toBe(true);
    });

    it('allows && chained commands', () => {
      expect(adapter.isAllowed('cd codebase && npm install')).toBe(true);
      expect(adapter.isAllowed('mkdir -p dir && cd dir && npm init -y')).toBe(true);
    });

    it('allows ; separated commands', () => {
      expect(adapter.isAllowed('echo "done"; ls')).toBe(true);
    });

    it('rejects if any segment in a pipe is disallowed', () => {
      expect(adapter.isAllowed('cat file | perl -e "print"')).toBe(false);
    });

    it('rejects if any segment in && is disallowed', () => {
      expect(adapter.isAllowed('ls && perl evil.pl')).toBe(false);
    });
  });

  describe('quoted strings with pipe-like characters (regression)', () => {
    it('allows grep with BRE alternation (\\|) in double quotes', () => {
      expect(adapter.isAllowed('grep -n "CandlestickData\\|addCandlestickSeries" src/file.ts')).toBe(true);
    });

    it('allows grep with BRE alternation (\\|) in single quotes', () => {
      expect(adapter.isAllowed("grep -rn 'export\\|import' src/")).toBe(true);
    });

    it('allows grep -E with ERE alternation (|) in double quotes', () => {
      expect(adapter.isAllowed('grep -E "foo|bar|baz" file.txt')).toBe(true);
    });

    it('allows grep -E with ERE alternation (|) in single quotes', () => {
      expect(adapter.isAllowed("grep -E 'CandlestickData|addCandlestickSeries' src/")).toBe(true);
    });

    it('allows grep with multiple \\| alternations in pattern', () => {
      expect(adapter.isAllowed('grep -n "foo\\|bar\\|baz\\|qux" file.ts')).toBe(true);
    });

    it('allows grep with \\| pattern piped to head', () => {
      expect(adapter.isAllowed('grep -rn "export\\|import" src/ | head -20')).toBe(true);
    });

    it('allows grep -E with | pattern piped to head', () => {
      expect(adapter.isAllowed('grep -E "foo|bar" src/ | head -5')).toBe(true);
    });
  });

  describe('backslash-escaped pipe outside quotes', () => {
    it('treats backslash-escaped pipe as literal, not shell operator', () => {
      expect(adapter.isAllowed('grep -n foo\\|bar file.ts')).toBe(true);
    });
  });

  describe('env var assignments', () => {
    it('allows env var prefix before whitelisted command', () => {
      expect(adapter.isAllowed('NODE_ENV=production npm run build')).toBe(true);
      expect(adapter.isAllowed('FOO=bar BAZ=qux npm test')).toBe(true);
    });

    it('handles quoted values in env assignments', () => {
      expect(adapter.isAllowed('FOO="bar" npm install')).toBe(true);
    });

    it('handles quoted values with spaces in env assignments', () => {
      expect(adapter.isAllowed('FOO="bar baz" npm install')).toBe(true);
      expect(adapter.isAllowed("MSG='hello world' echo done")).toBe(true);
    });

    it('handles multiple quoted env vars', () => {
      expect(adapter.isAllowed('A="x y" B="1 2" npm run build')).toBe(true);
    });

    it('rejects disallowed command after quoted env var', () => {
      expect(adapter.isAllowed('FOO="bar baz" perl evil.pl')).toBe(false);
    });
  });

  describe('rejection guidance', () => {
    it('names the head-token rule and the allowed binaries', () => {
      const guidance = adapter.notAllowedGuidance();
      expect(guidance).toContain('must start with an allowlisted binary');
      expect(guidance).toContain('base64');
      expect(guidance).toContain('python3');
      expect(guidance).toContain('node_modules/.bin/');
    });
  });

  describe('shell control flow (navy-dropping-crowd)', () => {
    it('allows loops/conditionals whose body commands are allowlisted', () => {
      expect(adapter.isAllowed('for f in *.png; do base64 "$f"; done')).toBe(true);
      expect(adapter.isAllowed('for f in codebase/assets/*.png; do sha256sum "$f"; done')).toBe(true);
      expect(adapter.isAllowed('while true; do curl localhost:3000; done')).toBe(true);
      expect(adapter.isAllowed('until curl localhost:3000; do sleep 1; done')).toBe(true);
      expect(adapter.isAllowed('if [ -f package.json ]; then echo yes; fi')).toBe(true);
      expect(adapter.isAllowed('if ! grep -q marker file.txt; then echo miss; fi')).toBe(true);
      expect(adapter.isAllowed('if [ -d dist ]; then ls dist; else echo none; fi')).toBe(true);
    });

    it('allows multi-line loops (newline statement boundaries)', () => {
      expect(adapter.isAllowed('for f in a.png b.png\ndo\n  cmp "$f" "backup/$f"\ndone')).toBe(true);
      expect(adapter.isAllowed('while true\ndo\n  perl x.pl\ndone')).toBe(false);
    });

    it('validates loop BODY heads against the allowlist (the core contract)', () => {
      expect(adapter.isAllowed('for f in *.txt; do perl "$f"; done')).toBe(false);
      expect(adapter.isAllowed('while true; do bash -c "x"; done')).toBe(false);
      expect(adapter.isAllowed('if [ -f x ]; then sh -c "ls"; fi')).toBe(false);
      expect(adapter.isAllowed('for f in *; do cat "$f" | perl -e 1; done')).toBe(false);
    });

    it('keeps unparseable constructs fail-closed', () => {
      expect(adapter.isAllowed('case "$x" in a) ls;; esac')).toBe(false);
      expect(adapter.isAllowed('select opt in a b; do echo "$opt"; done')).toBe(false);
      expect(adapter.isAllowed('[[ -f x ]] && echo yes')).toBe(false);
      expect(adapter.isAllowed('"do" something')).toBe(false); // quoted keyword is not a keyword
    });

    it('does not split backslash line-continuations into bogus statement lines', () => {
      expect(adapter.isAllowed('npm install \\\n  --save-dev vitest')).toBe(true);
    });

    it('keeps heredoc commands on the single-string head check (bodies are data)', () => {
      expect(adapter.isAllowed('cat <<EOF\nhello world\nEOF')).toBe(true);
    });

    it('firstDisallowedHead names the offending token; null means allowed', () => {
      expect(adapter.firstDisallowedHead('cd codebase && npm install')).toBeNull();
      expect(adapter.firstDisallowedHead('for f in *.png; do base64 "$f"; done')).toBeNull();
      expect(adapter.firstDisallowedHead('case "$x" in a) ls;; esac')).toBe('case');
      expect(adapter.firstDisallowedHead('cat x | perl -e 1')).toBe('perl');
      expect(adapter.firstDisallowedHead('for f in *; do perl "$f"; done')).toBe('perl');
      expect(adapter.firstDisallowedHead('')).toBe('(empty command)');
      // isAllowed must stay exactly the null-check over firstDisallowedHead.
      for (const cmd of ['ls', 'perl x.pl', 'grep -rn "foo" src/ | head -20', 'timeout 30 bash -c "ls"']) {
        expect(adapter.isAllowed(cmd)).toBe(adapter.firstDisallowedHead(cmd) === null);
      }
    });
  });
});
