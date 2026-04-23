/**
 * Render contract for the `jobs/code/base/injections/dep-self-contained`
 * partial. Asserts the principle, observation-target table, traps, and
 * package-manager matrix are present.
 */

import { describe, it, expect } from 'vitest';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATE = 'jobs/code/base/injections/dep-self-contained';

describe('jobs/code/base/injections/dep-self-contained', () => {
  const adapter = new FilePromptAdapter();

  it('renders the Self-Contained Dependency Principle header', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/## Self-Contained Dependency Principle/);
  });

  it('enumerates the core principle — declare + install within the task', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/declared in the project's dependency manifest/i);
    expect(out).toMatch(/installed/i);
    expect(out).toMatch(/within this task/i);
    expect(out).toMatch(/Do NOT defer to a future task/i);
  });

  it('lists the four observation target classes (import / typed global / augmentation / config key)', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/Import path/);
    expect(out).toMatch(/Typed runtime global/);
    expect(out).toMatch(/Runtime-only augmentation/);
    expect(out).toMatch(/Config key/);
  });

  it('names the typed-runner trap explicitly so the @types/jest class of bug is caught', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/@types\/\{runner\}|@types\/jest/);
    expect(out).toMatch(/Typed runner trap/i);
    // The @types gap surfaces as tsc failures on every test file, not on
    // the manifest — the partial must flag this misdirection.
    expect(out).toMatch(/tsc.*fails|typecheck/i);
  });

  it('names the config-key hallucination trap with the known Jest key family', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/Config-key hallucination trap/i);
    expect(out).toMatch(/setupFilesAfterFramework/);
    expect(out).toMatch(/setupFilesAfterEnv/);
    expect(out).toMatch(/silently ignore/i);
  });

  it('provides package manager detection rules covering every supported stack', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/pnpm-lock\.yaml/);
    expect(out).toMatch(/yarn\.lock/);
    expect(out).toMatch(/package-lock\.json/);
    expect(out).toMatch(/go\.mod/);
    expect(out).toMatch(/Cargo\.toml/);
    expect(out).toMatch(/pyproject\.toml/);
  });

  it('requires config-key verification against .d.ts / schema before writing (FPOP: observable over assumed)', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/\.d\.ts/);
    expect(out).toMatch(/published.*schema|published schema/i);
    expect(out).toMatch(/not memory/i);
  });
});
