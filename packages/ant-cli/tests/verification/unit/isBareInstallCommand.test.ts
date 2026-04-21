/**
 * `isBareInstallCommand` — decides whether a package-manager install command
 * is "bare" (no explicit package argument, no reinstall-intent flag) and thus
 * eligible for the run-command skip guard.
 *
 * Regression guard for the `slim-burning-melon` retry loop: when the LLM
 * invoked `pnpm install --force` to restore a missing optional native
 * binding, the skip guard must recognise `--force` as reinstall intent and
 * let the command run. Blocking it permanently trapped the LLM in a loop
 * where neither the version nor the binding could be recovered.
 */

import { describe, it, expect } from 'vitest';
import { isBareInstallCommand } from '../../../src/agents/common/tool/handlers/runCommand';

describe('isBareInstallCommand', () => {
  describe('bare install commands (skip-guard eligible)', () => {
    it('detects plain `pnpm install`', () => {
      expect(isBareInstallCommand('pnpm install')).toBe(true);
    });

    it('detects plain `npm install` and `npm i` and `npm ci`', () => {
      expect(isBareInstallCommand('npm install')).toBe(true);
      expect(isBareInstallCommand('npm i')).toBe(true);
      expect(isBareInstallCommand('npm ci')).toBe(true);
    });

    it('detects plain `yarn install` and bare `yarn`', () => {
      expect(isBareInstallCommand('yarn install')).toBe(true);
      expect(isBareInstallCommand('yarn')).toBe(true);
    });

    it('detects `pip install -r requirements.txt`', () => {
      expect(isBareInstallCommand('pip install -r requirements.txt')).toBe(true);
    });

    it('detects `poetry install` / `bundle install`', () => {
      expect(isBareInstallCommand('poetry install')).toBe(true);
      expect(isBareInstallCommand('bundle install')).toBe(true);
    });
  });

  describe('reinstall-intent flags (skip-guard bypass)', () => {
    it('treats `pnpm install --force` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --force')).toBe(false);
    });

    it('treats `pnpm install --no-frozen-lockfile` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --no-frozen-lockfile')).toBe(false);
    });

    it('treats `pnpm install --frozen-lockfile=false` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --frozen-lockfile=false')).toBe(false);
    });

    it('treats `pnpm install --fix-lockfile` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --fix-lockfile')).toBe(false);
    });

    it('treats `pnpm install --shamefully-hoist` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --shamefully-hoist')).toBe(false);
    });

    it('treats `pnpm install -f` (short flag) as non-bare', () => {
      expect(isBareInstallCommand('pnpm install -f')).toBe(false);
    });

    it('treats `npm install --force` as non-bare', () => {
      expect(isBareInstallCommand('npm install --force')).toBe(false);
    });
  });

  describe('install with package arg (not bare)', () => {
    it('`pnpm add pkg` is not an install command', () => {
      expect(isBareInstallCommand('pnpm add react')).toBe(false);
    });

    it('`pnpm install some-pkg` is not bare (has positional arg)', () => {
      // Regex anchors on `($|--|-\s)` so a package name after `install` fails.
      expect(isBareInstallCommand('pnpm install react')).toBe(false);
    });

    it('`npm install lodash` is not bare', () => {
      expect(isBareInstallCommand('npm install lodash')).toBe(false);
    });
  });

  describe('non-install commands', () => {
    it('build / test / arbitrary commands are not install', () => {
      expect(isBareInstallCommand('pnpm run test')).toBe(false);
      expect(isBareInstallCommand('pnpm run build')).toBe(false);
      expect(isBareInstallCommand('tsc --noEmit')).toBe(false);
      expect(isBareInstallCommand('echo hi')).toBe(false);
    });

    it('go / cargo dep commands are explicitly excluded', () => {
      expect(isBareInstallCommand('go mod tidy')).toBe(false);
      expect(isBareInstallCommand('go mod download')).toBe(false);
      expect(isBareInstallCommand('go get ./...')).toBe(false);
      expect(isBareInstallCommand('cargo build')).toBe(false);
    });
  });
});
