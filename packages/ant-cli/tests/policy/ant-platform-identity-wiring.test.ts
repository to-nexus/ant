/**
 * Ant platform identity — wiring policy.
 *
 * Every LLM surface must receive the shared `ant-platform-identity`
 * injection so models never interpret the user's Ant vocabulary
 * ("universal job", "custom agent", "앤트") as third-party products
 * (incident: universal agent answered from web material about the
 * Anthropic SDK).
 *
 * Two wiring paths, both guarded here:
 *   1. build() surfaces — PromptBuilder.resolveInjections pushes the
 *      partial unconditionally (asserted via the injections list).
 *   2. render()-only nodes — their templates carry an explicit
 *      `{{> jobs/shared/injections/ant-platform-identity}}` include;
 *      each row asserts the include resolves (no literal `{{>` left and
 *      the partial's heading is inlined). The heading is DERIVED from the
 *      partial source, not pinned, so wording can change freely.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { PromptBuilder } from '../../src/core/prompt/builder/PromptBuilder';
import { TEMPLATE_PATHS } from '../../src/core/prompt/builder/templatePaths';

const TEMPLATES_DIR = path.resolve(__dirname, '../../src/core/prompt/templates');
const PARTIAL = 'jobs/shared/injections/ant-platform-identity';

/** render()-only nodes (PromptBuilder.build never runs for these) — each
 * template carries the include manually. Deliberately absent: visual
 * direct/engrave/sketch/render (image-generation payloads) and learn
 * decompose (raw fs read, no user-vocabulary interpretation). */
const RENDER_ONLY_GAP_TEMPLATES = [
  'jobs/code/nodes/decompose/variants/default/rules',
  'jobs/code/nodes/plan/base',
  'jobs/code/nodes/revise/variants/default/base',
  'jobs/design/nodes/revise/variants/default/base',
  'jobs/design/nodes/execute/variants/ui-design-by-figma/base',
  'jobs/design/nodes/execute/variants/ui-design-by-desc/base',
  'jobs/design/nodes/execute/variants/ui-design-by-handoff/base',
  'jobs/design/nodes/execute/variants/game-art-by-figma/base',
  'jobs/design/nodes/execute/variants/game-art-by-desc/base',
  'jobs/design/nodes/execute/variants/game-art-by-handoff/base',
  'jobs/visual/nodes/explain/variants/default/base',
];

describe('ant-platform-identity wiring', () => {
  let adapter: FilePromptAdapter;
  let heading: string;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
    const source = fs.readFileSync(path.join(TEMPLATES_DIR, `${PARTIAL}.md`), 'utf-8');
    heading = source.split('\n')[0].trim();
    expect(heading.length).toBeGreaterThan(0);
  });

  it('build() surfaces receive the injection unconditionally (seam: resolveInjections)', async () => {
    const promptBuilder = new PromptBuilder(adapter);
    const result = await promptBuilder.build({
      templates: TEMPLATE_PATHS.universalAgent,
      vars: {},
    });
    expect(result.injections).toContain(PARTIAL);
    expect(result.system).toContain(heading);
  });

  for (const tpl of RENDER_ONLY_GAP_TEMPLATES) {
    it(`render()-only gap: ${tpl} inlines the partial`, async () => {
      const out = await adapter.render(tpl, {});
      expect(out).toContain(heading);
      expect(out).not.toContain('{{>');
    });
  }
});
