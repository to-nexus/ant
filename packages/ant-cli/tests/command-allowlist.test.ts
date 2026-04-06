/**
 * Tests for NodeCommandAdapter.isAllowed() and shell parsing utilities.
 *
 * Validates:
 * - Basic allowed/disallowed commands
 * - Compound commands (&&, ||, ;, |)
 * - Quoted strings containing pipe-like characters
 * - Backslash-escaped pipes (grep BRE alternation)
 * - Newly added commands (cargo, tsx, nodemon, vite, bun, tsc, turbo)
 * - Relative binary paths (./app)
 * - Shell parser utilities (splitOnShellOperators, hasActualPipe)
 */

import { describe, it, expect } from 'vitest';
import { NodeCommandAdapter } from '../src/periphery/adapters/command/NodeCommandAdapter.js';
import { splitOnShellOperators, hasActualPipe } from '../src/core/utils/shellParser.js';

const adapter = new NodeCommandAdapter();

describe('NodeCommandAdapter.isAllowed', () => {
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
  });
});

describe('splitOnShellOperators', () => {
  it('splits on && outside quotes', () => {
    expect(splitOnShellOperators('cd dir && npm install')).toEqual(['cd dir ', ' npm install']);
  });

  it('splits on | outside quotes', () => {
    expect(splitOnShellOperators('grep foo | head')).toEqual(['grep foo ', ' head']);
  });

  it('splits on ; outside quotes', () => {
    expect(splitOnShellOperators('echo a; echo b')).toEqual(['echo a', ' echo b']);
  });

  it('splits on || outside quotes', () => {
    expect(splitOnShellOperators('cmd1 || cmd2')).toEqual(['cmd1 ', ' cmd2']);
  });

  it('does not split on | inside double quotes', () => {
    expect(splitOnShellOperators('grep -E "foo|bar" file')).toEqual(['grep -E "foo|bar" file']);
  });

  it('does not split on | inside single quotes', () => {
    expect(splitOnShellOperators("grep -E 'foo|bar' file")).toEqual(["grep -E 'foo|bar' file"]);
  });

  it('does not split on escaped pipe', () => {
    expect(splitOnShellOperators('grep foo\\|bar file')).toEqual(['grep foo\\|bar file']);
  });

  it('handles mixed: quoted | and real pipe', () => {
    const result = splitOnShellOperators('grep -E "a|b" file | head');
    expect(result).toEqual(['grep -E "a|b" file ', ' head']);
  });

  it('handles multiple operators', () => {
    const result = splitOnShellOperators('cd dir && grep test | head; echo done');
    expect(result).toEqual(['cd dir ', ' grep test ', ' head', ' echo done']);
  });
});

describe('hasActualPipe', () => {
  it('returns true for real pipe', () => {
    expect(hasActualPipe('grep foo | head')).toBe(true);
    expect(hasActualPipe('cat file | sort | uniq')).toBe(true);
  });

  it('returns false for no pipe', () => {
    expect(hasActualPipe('npm install')).toBe(false);
    expect(hasActualPipe('cd dir && npm install')).toBe(false);
  });

  it('returns false for pipe only inside quotes', () => {
    expect(hasActualPipe('grep -E "foo|bar" file')).toBe(false);
    expect(hasActualPipe("grep -E 'a|b|c' src/")).toBe(false);
  });

  it('returns false for escaped pipe', () => {
    expect(hasActualPipe('grep foo\\|bar file')).toBe(false);
  });

  it('returns false for || (logical OR, not pipe)', () => {
    expect(hasActualPipe('cmd1 || cmd2')).toBe(false);
  });

  it('returns true when real pipe coexists with quoted pipe', () => {
    expect(hasActualPipe('grep -E "foo|bar" file | head')).toBe(true);
  });
});
