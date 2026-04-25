import { describe, it, expect } from 'vitest';
import { isDiagnosticInspectCommand } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/gates';

describe('isDiagnosticInspectCommand — deep-diagnostic inspect allow-list', () => {
  it('accepts file inspection commands', () => {
    expect(isDiagnosticInspectCommand('cat package.json')).toBe(true);
    expect(isDiagnosticInspectCommand('ls -la')).toBe(true);
    expect(isDiagnosticInspectCommand('head -n 20 tsconfig.json')).toBe(true);
    expect(isDiagnosticInspectCommand('tail -n 50 debug.log')).toBe(true);
  });

  it('accepts package-manager introspection', () => {
    expect(isDiagnosticInspectCommand('pnpm why react')).toBe(true);
    expect(isDiagnosticInspectCommand('npm why typescript')).toBe(true);
    expect(isDiagnosticInspectCommand('yarn why lodash')).toBe(true);
    expect(isDiagnosticInspectCommand('npm ls')).toBe(true);
    expect(isDiagnosticInspectCommand('pnpm list')).toBe(true);
  });

  it('accepts version/env introspection', () => {
    expect(isDiagnosticInspectCommand('node -v')).toBe(true);
    expect(isDiagnosticInspectCommand('tsc --version')).toBe(true);
    expect(isDiagnosticInspectCommand('npx tsc --version')).toBe(true);
    expect(isDiagnosticInspectCommand('env')).toBe(true);
  });

  it('rejects mutating commands even if prefix looks inspection-like', () => {
    expect(isDiagnosticInspectCommand('npm install react')).toBe(false);
    expect(isDiagnosticInspectCommand('pnpm add typescript')).toBe(false);
    expect(isDiagnosticInspectCommand('pnpm build')).toBe(false);
    expect(isDiagnosticInspectCommand('npm run build')).toBe(false);
    expect(isDiagnosticInspectCommand('npx tsc --noEmit')).toBe(false);
  });

  it('rejects unrelated commands', () => {
    expect(isDiagnosticInspectCommand('rm -rf dist')).toBe(false);
    expect(isDiagnosticInspectCommand('./run.sh')).toBe(false);
    expect(isDiagnosticInspectCommand('')).toBe(false);
  });
});
