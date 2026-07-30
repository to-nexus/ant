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
      expect(adapter.isAllowed('python script.py')).toBe(false);
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

    it('STILL rejects file-writing and arbitrary-interpreter commands', () => {
      // File creation must go through <file> tags, not shell redirection.
      expect(adapter.isAllowed("printf 'shamefully-hoist=true\\n' > .npmrc")).toBe(false);
      expect(adapter.isAllowed("tee .npmrc")).toBe(false);
      expect(adapter.isAllowed('ln -s /tmp/test .symlink_test')).toBe(false);
      // Arbitrary interpreters stay out (node -e already covers scripting needs).
      expect(adapter.isAllowed('python3 -c "import os"')).toBe(false);
      expect(adapter.isAllowed('cat x | python3 -c "import sys"')).toBe(false);
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
      expect(adapter.isAllowed('cat file | python -c "import os"')).toBe(false);
    });

    it('rejects if any segment in && is disallowed', () => {
      expect(adapter.isAllowed('ls && python evil.py')).toBe(false);
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
      expect(adapter.isAllowed('FOO="bar baz" python evil.py')).toBe(false);
    });
  });
});
