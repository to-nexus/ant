import { describe, it, expect, beforeAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { FilePromptAdapter, initPartials, collectResolvedPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

async function collectTemplateNames(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      names.push(...await collectTemplateNames(join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      names.push(rel.replace(/\.md$/, ''));
    }
  }
  return names;
}

/**
 * Comprehensive sample context covering variables used across all templates.
 * Templates use Handlebars {{#if var}} so most variables just need to exist.
 */
const SAMPLE_VARS: Record<string, any> = {
  // Common
  directive: 'Build a REST API',
  spec: 'Build a REST API',
  prdSpec: '# PRD\n## Overview\nSample PRD',
  designDoc: '# System Design\nSample design doc',
  currentTask: { id: 'task-1', type: 'feature', description: 'Sample task', targetFile: 'src/index.ts', name: 'task-1', priority: 'high' },
  taskDescription: 'Sample task description',
  modificationMode: 'CREATION MODE: Build from scratch',
  referenceRequests: [],
  resolvedAction: undefined,
  existingCode: '',
  hasExistingCode: false,
  projectFileTree: 'src/\n  index.ts',
  configFileContents: '{}',
  taskList: '1. Setup project\n2. Implement API',
  plan: '## Plan\nStep 1: Setup\nStep 2: Implement',
  previousChaptersSummary: '',
  lastSectionNumber: 0,
  sectionPattern: '',
  isLastTaskForDocument: false,
  hasUiRef: false,
  hasUiContext: false,
  hasSystemDesignRef: false,
  hasSystemDesignContext: false,
  hasSpecRef: false,
  hasSpecContext: false,
  // Codebase Channel SSOT — exercise the partial in 'context' mode at smoke
  // time so it produces a non-empty body (greenfield = no body, by design).
  codebaseRole: 'context',
  codebaseEntryPoints: ['package.json', 'src'],
  errorText: 'Build error: missing module',
  targetDoc: 'ui-tokens.json',
  sessionContext: 'This is the first turn of the session.',
  lessons: 'No relevant lessons found.',
  retryContext: '',
  runtimeError: '',
  missingDependency: '',
  portManagement: '',
  environment: 'node-api',
  language: 'typescript',
  languageInstruction: '',
  content: 'Sample content',
  memory: '',

  // ask/base
  isKorean: false,
  hasWorkspace: true,
  question: 'How to implement?',

  // code/phases/decompose
  hasSpecDocs: false,
  hasErrorInDirective: false,
  hasUiDocs: false,

  // code/phases/plan
  taskName: 'Build API',
  framework: 'express',
  mode: 'create',
  hasDirectoryTree: true,
  hasReferences: false,
  hasRemainingTasks: false,
  isRetry: false,
  hasSetupConstraints: false,
  hasTools: false,

  // code/phases/revise
  context: 'revision context',
  completedCount: 1,
  totalTasks: 3,
  priority: 'high',
  id: 'task-1',
  name: 'Sample task',
  type: 'feature',
  description: 'Sample description',
  completedTasksList: '- task-0: done',
  originalDirective: 'Build a REST API',
  newDirective: 'Add error handling',
  directives: [{ content: 'Build a REST API', isLatest: true, isOriginal: true }],
  isLatest: true,
  isOriginal: true,

  // design/phases/decompose
  jobMode: 'create',
  existingDesignFiles: [],
  hasExistingDesign: false,
  assetCount: 0,

  // design/phases/detect
  hasUiTokens: false,
  hasUiAssets: false,
  hasUiSpec: false,
  hasSystemDocs: false,
  hasSystemDesign: false,
  hasApiContract: false,
  hasFeSystemDesign: false,
  hasBeSystemDesign: false,
  hasAssets: false,

  // planner/plan
  hasExistingDocument: false,
  hasEvalReport: false,
  hasConversationSummary: false,
  hasConversation: false,
  hasRecentTurns: false,

  // triage
  currentAgent: 'architect',
  currentJob: 'code',
  userInput: 'Build a REST API',
  hasPrd: false,
  hasDirective: true,
  hasCodebase: false,
  hasDesignDoc: false,
  jobCapabilities: 'code, design, plan',
  agentCapabilities: 'architect',

  // visual/nodes/direct/context
  conversationContext: '[user] Create a logo for my app',
  currentDirective: 'Create a minimalist logo',
  lastEngineeredPrompt: '',
  lastOutputPath: '',
  safetyBlocked: false,
  visualError: '',
  defaultAspectRatio: '1:1',
  candidateCount: 3,

  // visual/nodes/direct/rules (asset type conditional flags)
  isLogo: true,
  isIcon: false,
  isHero: false,
  isIllustration: false,
};

describe('Template Smoke Tests', () => {
  let allTemplateNames: string[];
  let templateNames: string[];
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    allTemplateNames = await collectTemplateNames(TEMPLATES_DIR);
    templateNames = allTemplateNames.filter(n => !n.startsWith('basis/'));
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('initPartials() should register all partials without failures', async () => {
    const result = await initPartials(TEMPLATES_DIR);
    expect(result.failed).toHaveLength(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it('discovered templates should match registered partials count', async () => {
    const result = await initPartials(TEMPLATES_DIR);
    expect(templateNames.length).toBe(result.total);
  });

  it('injection-manifest.json covers all injection templates', async () => {
    const manifestRaw = await fs.readFile(
      join(__dirname, '../../src/core/prompt/injection-manifest.json'),
      'utf8'
    );
    const manifest: Record<string, Record<string, string[]>> = JSON.parse(manifestRaw);

    const manifestTemplates = new Set<string>();
    for (const [dir, entries] of Object.entries(manifest)) {
      for (const name of Object.keys(entries)) {
        manifestTemplates.add(`${dir}/${name}`);
      }
    }

    const injectionTemplates = templateNames.filter(t => t.includes('/injections/'));
    const missing = injectionTemplates.filter(t => !manifestTemplates.has(t));

    if (missing.length > 0) {
      expect.fail(`Injection templates missing from manifest:\n  ${missing.join('\n  ')}`);
    }
  });

  it('all {{> partial}} references point to registered partials (integrity check)', async () => {
    await initPartials(TEMPLATES_DIR);
    const registeredNames = new Set(templateNames);
    const brokenRefs: Array<{ template: string; missingPartial: string }> = [];

    for (const name of templateNames) {
      const filePath = join(TEMPLATES_DIR, `${name}.md`);
      const source = await fs.readFile(filePath, 'utf8');
      const pattern = /\{\{>\s*([\w/\-]+)\s*\}\}/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        if (!registeredNames.has(match[1])) {
          brokenRefs.push({ template: name, missingPartial: match[1] });
        }
      }
    }

    if (brokenRefs.length > 0) {
      const report = brokenRefs
        .map(r => `  ${r.template} → {{> ${r.missingPartial}}}`)
        .join('\n');
      expect.fail(
        `${brokenRefs.length} broken partial reference(s) found:\n${report}`
      );
    }
  });

  it('decompose/rules.md includes Independent Output Unit Splitting unconditionally', async () => {
    await initPartials(TEMPLATES_DIR);

    const SENTINEL = 'INDEPENDENT OUTPUT UNIT';
    const EXCEPTION_SCOPE = 'exception scope';
    const NO_ENUMERATE = 'MUST name a single output unit';

    const render = (techTier: any) => adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      { ...SAMPLE_VARS, techTier },
    );

    // No stack gate: the new rubric must surface for every stack value,
    // because its applicability is observed from persistence-boundary count
    // (LLM observation), not from the stack label.
    for (const stack of ['frontend', 'backend', 'fullstack']) {
      const output = await render({ language: 'typescript', stack });
      expect(output, `stack=${stack} missing rubric sentinel`).toContain(SENTINEL);
      expect(output, `stack=${stack} missing merge-exception scope clause`).toContain(EXCEPTION_SCOPE);
      expect(output, `stack=${stack} missing feature-desc no-enumeration clause`).toContain(NO_ENUMERATE);
    }

    // Partial-level render MUST produce non-empty output on its own
    // (no wrapping {{#if}} — unconditional rubric).
    const partialOnly = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/output-unit-splitting',
      SAMPLE_VARS,
    );
    expect(partialOnly).toContain(SENTINEL);
    expect(partialOnly).toContain('Category identification');
    expect(partialOnly).toContain('visual unit');
    expect(partialOnly).toContain('command');
    expect(partialOnly).toContain('worker');
    expect(partialOnly).toContain('exported symbol cluster');
    expect(partialOnly).toContain('pipeline stage');
  });

  it('decompose/rules.md resolves output-unit-splitting partial via collectResolvedPartials', async () => {
    await initPartials(TEMPLATES_DIR);
    const partials = collectResolvedPartials(['jobs/code/nodes/decompose/variants/default/rules']);
    expect(partials).toContain('jobs/code/nodes/decompose/variants/default/output-unit-splitting');
  });

  it('decompose/rules.md carries cross-cutting integration boundary guard (Defect 2 fix)', async () => {
    await initPartials(TEMPLATES_DIR);
    const output = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      { ...SAMPLE_VARS, techTier: { language: 'typescript', stack: 'frontend' } },
    );
    // Boundary observation row in the parallelism checklist
    expect(output).toMatch(/Cross-cutting integration boundary/);
    // Mandatory extraction constraint
    expect(output).toMatch(/Cross-cutting integration boundary extraction \(mandatory\)/);
    // Decision protocol prevents independent feature tasks from each
    // constructing their own copy of the adapter
    expect(output).toMatch(/Decision protocol .* same external integration/);
    // Concrete blind-spot warning citing the post-RAC pool-leak failure
    // mode (two adapters in different directories for the same SDK)
    expect(output).toMatch(/duplicate SDK \/ wallet \/ payment adapters/);
    // Foundation-side observation row mirrors the parallelism row
    expect(output).toMatch(/Will 2\+ feature tasks consume the same external SDK/);
    // External integration boundary blind spot at foundation level
    expect(output).toMatch(/external integration boundaries/);
  });

  it('decompose/rules.md encodes UI pairing rule with renderable-only predicate', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      { ...SAMPLE_VARS, techTier: { language: 'typescript', stack: 'frontend' } },
    );

    // UI pairing rule is reachable from rules.md
    expect(output).toContain('UI pairing rule');
    // Renderable predicate is explicit
    expect(output).toContain('RENDERABLE');
    expect(output).toContain('renderable feature');
    // Zero-ui case (backend-only / CLI-only / library-only) is allowed
    expect(output).toContain('ZERO ui tasks');
    // Globals exclusion: ui tasks never touch global style layer
    expect(output).toContain('MUST NOT touch global style layer');
    // Pairing via parallelGroup (not priority)
    expect(output).toContain('shares its `parallelGroup` with its paired renderable feature');

    // Anti-regression: the pre-fix "SAME parallelGroup" wording must be gone
    expect(output).not.toContain('share the SAME `parallelGroup`');
    // The new DISTINCT wording replaces it
    expect(output).toContain('DISTINCT `parallelGroup`');

    // Partial standalone render carries the same sentinels
    const partialOnly = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/output-unit-splitting',
      SAMPLE_VARS,
    );
    expect(partialOnly).toContain('UI pairing rule');
    expect(partialOnly).toContain('DISTINCT `parallelGroup`');
    expect(partialOnly).toContain('ui task count equals the renderable feature task count');
    expect(partialOnly).toContain('globals exclusion');
  });

  it('setup ANTRULES guidance — 3-condition filter, no forbidden prohibitions (F0 + dep-self-contained refactor)', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render(
      'jobs/code/nodes/execute/variants/default/base',
      {
        ...SAMPLE_VARS,
        currentTask: { id: 'setup-project', name: 'Project Setup', type: 'setup', description: 'Initialize', priority: 100 },
      },
    );

    // No rigid "mandatory 4 H2 sections" text
    expect(output).not.toMatch(/mandatory.*H2 sections|exactly these top-level H2 sections/i);
    // The fabricated-prohibition exemplars should appear ONLY in the
    // "FORBIDDEN" constraint that tells the LLM not to generate them.
    // (regression: plum-molding-bench generated "Do not add test files")
    const forbiddenSection = output.match(/Constraint — no fabricated prohibitions[\s\S]{0,500}FORBIDDEN/i);
    expect(forbiddenSection).not.toBeNull();
    expect(forbiddenSection![0]).toMatch(/Do not add test files/);
    expect(forbiddenSection![0]).toMatch(/No test framework configured/);
    // Must carry the "no fabricated prohibitions" constraint
    expect(output).toMatch(/no fabricated prohibitions/i);
    // Sharpened semantics (2026-04-23 refactor): setup no longer seeds a
    // full inventory. The 3-condition filter must be named in the setup
    // section so the LLM knows when NOT to create ANTRULES at all.
    expect(output).toMatch(/3-condition filter/i);
    expect(output).toMatch(/Codebase-local/);
    expect(output).toMatch(/Not auto-derivable/);
    expect(output).toMatch(/Cross-task invariant/);
    // Explicit anti-pattern callout: setup MUST NOT restate what package.json
    // / tsconfig / config files already declare.
    expect(output).toMatch(/no redundant restatements/i);
    expect(output).toMatch(/drift/i);
    // Default action when nothing passes the filter: do not create the file.
    expect(output).toMatch(/Default action/);
    // Test-code authoring remains explicit owner of runner selection (this
    // lives in the separate FORBIDDEN block, not the ANTRULES seed block).
    expect(output).toMatch(/test-code task/i);
    // L186 replacement: specific forbidden (files + scripts) rather than vague "testing infrastructure"
    expect(output).toMatch(/DO NOT create test files or run test setup scripts/);
  });

  it('antrules partial guidance — "Updating ANTRULES.md" appears in the standard execute base (F0)', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render(
      'jobs/code/nodes/execute/variants/default/base',
      {
        ...SAMPLE_VARS,
        antrulesContent: '# ANTRULES.md\n\n## Export Style\n- named\n',
        currentTask: { id: 'feature-a', name: 'Feature A', type: 'feature', description: 'do', priority: 300 },
      },
    );

    expect(output).toMatch(/Updating ANTRULES\.md/);
    expect(output).toMatch(/cross-task invariant/i);
  });

  const DEP_PARTIAL_HEADER = '## Self-Contained Dependency Principle';
  const DEP_VARIANTS_INCLUDED = [
    'jobs/code/nodes/execute/variants/default/base',
    'jobs/code/nodes/execute/variants/test-code/base',
    'jobs/code/nodes/execute/variants/verification/base',
    'jobs/code/nodes/execute/variants/error/base',
    'jobs/code/nodes/plan/base',
    'jobs/code/nodes/plan/variants/verification/base',
    'jobs/code/nodes/plan/variants/error/base',
  ];
  const DEP_VARIANTS_EXCLUDED = ['jobs/code/nodes/execute/variants/docgen/base'];

  for (const template of DEP_VARIANTS_INCLUDED) {
    it(`dep-self-contained partial appears in ${template}`, async () => {
      await initPartials(TEMPLATES_DIR);
      const output = await adapter.render(template, {
        ...SAMPLE_VARS,
        antrulesContent: undefined,
        currentTask: { id: 't', name: 't', type: 'feature', description: 'x', priority: 300 },
      });
      expect(output).toContain(DEP_PARTIAL_HEADER);
      expect(output).toMatch(/setupFilesAfterFramework/);
    });
  }

  for (const template of DEP_VARIANTS_EXCLUDED) {
    it(`dep-self-contained partial is absent from ${template}`, async () => {
      await initPartials(TEMPLATES_DIR);
      const output = await adapter.render(template, {
        ...SAMPLE_VARS,
        antrulesContent: undefined,
        currentTask: { id: 't', name: 't', type: 'doc', description: 'x', priority: 800 },
      });
      expect(output).not.toContain(DEP_PARTIAL_HEADER);
    });
  }

  const DIAGRAM_CONTRACT_HEADER = '## Diagram Contract (Cross-Job)';
  const DIAGRAM_CONTRACT_VARIANTS = [
    'jobs/design/base/system',
    'jobs/plan/nodes/plan/variants/default/base',
    'jobs/code/nodes/execute/variants/docgen/base',
  ];

  for (const template of DIAGRAM_CONTRACT_VARIANTS) {
    it(`diagram-contract partial appears in ${template}`, async () => {
      await initPartials(TEMPLATES_DIR);
      const output = await adapter.render(template, {
        ...SAMPLE_VARS,
        currentTask: { id: 't', name: 't', type: 'doc', description: 'x', priority: 800 },
      });
      expect(output).toContain(DIAGRAM_CONTRACT_HEADER);
      expect(output).toContain('Mermaid');
      expect(output).toContain('ASCII');
    });
  }

  // Plan-side preview-* partial inclusion (Defect 1 fix — basePath omission).
  //
  // The plan node must surface the same `preview-setup` (frontend basePath)
  // and `preview-env-contract` (platform-injected env vars) contracts that
  // execute already gets via AutoInjectionResolver. Without this, the plan
  // never instructs the LLM to wire `NEXT_PUBLIC_BASE_PATH` /
  // `VITE_BASE_PATH` into the framework config, and execute follows the
  // plan's minimal config — silently producing apps that break under the
  // platform's `/{urlKey}/` proxy.
  //
  // The matrix below mirrors AutoInjectionResolver's execute-side gates so
  // plan and execute stay in lock-step:
  //
  //   - default / error variant + hasFrontend  → both partials
  //   - default / error variant + backend-only → only preview-env-contract
  //   - verification variant                   → only preview-env-contract
  //                                              (skipEnvRules excludes preview-setup)
  const PREVIEW_SETUP_HEADER = 'Development Server: Path Prefix Configuration';
  const PREVIEW_ENV_HEADER = 'Dev Server Runtime Contract';

  const PREVIEW_PLAN_VARIANTS_BOTH = [
    'jobs/code/nodes/plan/base',
    'jobs/code/nodes/plan/variants/error/base',
  ];

  for (const template of PREVIEW_PLAN_VARIANTS_BOTH) {
    it(`preview-setup + preview-env-contract appear in ${template} when hasFrontend`, async () => {
      await initPartials(TEMPLATES_DIR);
      const output = await adapter.render(template, {
        ...SAMPLE_VARS,
        antrulesContent: undefined,
        hasFrontend: true,
        hasBackend: false,
        currentTask: { id: 't', name: 't', type: 'feature', description: 'x', priority: 300 },
      });
      expect(output).toContain(PREVIEW_SETUP_HEADER);
      expect(output).toContain(PREVIEW_ENV_HEADER);
      expect(output).toMatch(/NEXT_PUBLIC_BASE_PATH/);
    });

    it(`preview-setup is gated out of ${template} when hasFrontend is false`, async () => {
      await initPartials(TEMPLATES_DIR);
      const output = await adapter.render(template, {
        ...SAMPLE_VARS,
        antrulesContent: undefined,
        hasFrontend: false,
        hasBackend: true,
        currentTask: { id: 't', name: 't', type: 'feature', description: 'x', priority: 300 },
      });
      expect(output).not.toContain(PREVIEW_SETUP_HEADER);
      // preview-env-contract still applies to backend-only (PORT binding etc.).
      expect(output).toContain(PREVIEW_ENV_HEADER);
    });
  }

  it('preview-env-contract appears in plan/variants/verification/base (skipEnvRules excludes preview-setup)', async () => {
    await initPartials(TEMPLATES_DIR);
    const output = await adapter.render('jobs/code/nodes/plan/variants/verification/base', {
      ...SAMPLE_VARS,
      antrulesContent: undefined,
      hasFrontend: true,
      hasBackend: false,
      currentTask: { id: 't', name: 't', type: 'verification', description: 'x', priority: 700 },
    });
    expect(output).toContain(PREVIEW_ENV_HEADER);
    expect(output).not.toContain(PREVIEW_SETUP_HEADER);
  });

  it('verification execute rules carry the ANTRULES write-back checkpoint with the 3-condition filter', async () => {
    await initPartials(TEMPLATES_DIR);
    const output = await adapter.render(
      'jobs/code/nodes/execute/variants/verification/rules',
      SAMPLE_VARS,
    );
    expect(output).toMatch(/ANTRULES Write-Back/i);
    expect(output).toMatch(/Codebase-local/);
    expect(output).toMatch(/Not auto-derivable/);
    expect(output).toMatch(/Cross-task invariant/);
    // Filter-failing shapes must be explicitly rerouted away from ANTRULES
    // (manifest, techTier hints, or filesystem evidence itself).
    expect(output).toMatch(/manifest IS the SSOT|Edit the manifest/);
    expect(output).toMatch(/derivable from the library/);
    expect(output).toMatch(/Silence is the correct action/);
  });

  it('secure-coding partial is resolved inside execute/rules and plan/rules', async () => {
    await initPartials(TEMPLATES_DIR);

    const rulesOutput = await adapter.render('jobs/code/nodes/execute/variants/default/rules', SAMPLE_VARS);
    expect(rulesOutput).toContain('untrusted');
    expect(rulesOutput).toContain('parameterized query');

    const planRulesOutput = await adapter.render('jobs/code/nodes/plan/rules', SAMPLE_VARS);
    expect(planRulesOutput).toContain('untrusted');
    expect(planRulesOutput).toContain('parameterized query');
  });

  it('collectResolvedPartials tracks nested partials from templates', async () => {
    await initPartials(TEMPLATES_DIR);

    const partials = collectResolvedPartials(['jobs/code/nodes/execute/variants/default/rules']);
    expect(partials).toContain('jobs/code/base/injections/secure-coding');
    expect(partials).toContain('jobs/code/base/injections/persistence-schema-rule');

    const planPartials = collectResolvedPartials(['jobs/code/nodes/plan/rules']);
    expect(planPartials).toContain('jobs/code/base/injections/secure-coding');
  });

  it('each template (including basis/) renders without throwing and produces non-empty output', async () => {
    await initPartials(TEMPLATES_DIR);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Templates wrapped entirely in {{#if}} blocks produce empty output when
    // the condition variable is falsy. This is expected behavior, not a failure.
    const ALLOWED_EMPTY = new Set([
      'jobs/shared/injections/memory',
      'jobs/shared/injections/directive',
      'jobs/shared/injections/action-context',
      'jobs/shared/injections/refactor-guidance',
      'jobs/shared/injections/explain-guidance',
      'jobs/code/nodes/decompose/variants/default/mode-guide',
      'jobs/code/nodes/decompose/variants/default/design-doc-guide',
      // UiSource dispatcher and its per-(uiSource, taskType) inventory are
      // wrapped entirely in {{#if uiSource}} so they render empty when no
      // UI source is active — this is by design (Contract exception per
      // AGENTS.md "Post-RAC Template Condition SSOT").
      'jobs/code/base/injections/ui-source-dispatch',
      'jobs/code/nodes/plan/injections/ui-source-inventory',
      // workspace-dep-snapshot wraps its entire body in
      // {{#if hasWorkspaceDepSnapshot}}; with no pins observed at smoke
      // time the partial renders empty. The activation gate is data-
      // driven (the workspace dep scanner) rather than role-scoped, so
      // adding it to the allow-list mirrors how ui-source-dispatch is
      // treated above.
      'jobs/code/base/injections/workspace-dep-snapshot',
      // monorepo-install-locality is gated on {{#if monorepoActive}}; smoke
      // SAMPLE_VARS has no workspace analysis, so the partial is empty until
      // analyzeWorkspace marks an active monorepo.
      'jobs/code/base/injections/monorepo-install-locality',
      // Design sealed-plan-block is wrapped entirely in {{#if planText}}
      // (no {{else}} branch — the block adds context only when a sealed
      // plan exists, otherwise the prompt continues without it). Smoke
      // renders without vars, so the partial is empty by design. See
      // `.claude/plans/plan-docgen-parallel-spring.md`. The companion
      // `sealed-plan-rules` partial has a {{else}} fallback branch and
      // is therefore NOT in this allow-list.
      'jobs/design/nodes/execute/injections/sealed-plan-block',
      // Code Tier 3 cross-task analysis brief is wrapped in
      // {{#if hasAnalysis}} (no {{else}}) — same Contract pattern as
      // sealed-plan-block. Tier 4 forbids emission, Tier 0/1/2 skip,
      // and only Tier 3 with a non-empty `<analysis>` body activates
      // the block. Smoke renders without vars, so the partial is empty
      // by design.
      'jobs/code/nodes/plan/injections/analysis-block',
      'basis/techTier/stack/backend',
      'basis/techTier/stack/frontend',
    ]);

    const failures: Array<{ name: string; error: string }> = [];

    for (const name of allTemplateNames) {
      try {
        const result = await adapter.render(name, SAMPLE_VARS);
        if ((!result || result.trim().length === 0) && !ALLOWED_EMPTY.has(name)) {
          failures.push({ name, error: 'rendered to empty string' });
        }
      } catch (err) {
        failures.push({ name, error: err instanceof Error ? err.message : String(err) });
      }
    }

    warnSpy.mockRestore();

    if (failures.length > 0) {
      const report = failures.map(f => `  ${f.name}: ${f.error}`).join('\n');
      expect.fail(`${failures.length} template(s) failed:\n${report}`);
    }
  });

  it('visual/nodes/direct/base includes creator identity, art direction role, and routing rules', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/direct/variants/default/base', SAMPLE_VARS);

    expect(output).toContain('creative asset producer');
    expect(output).toContain('art director');
    expect(output).toContain('Routing Decision');
    expect(output).toContain('Response Format');
    expect(output).toContain('Single Asset Per Turn');
  });

  it('visual/nodes/direct/context injects conversation, directive, and settings', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
      conversationContext: '[user] Make a blue icon',
      currentDirective: 'Generate a blue app icon',
      defaultAspectRatio: '16:9',
      candidateCount: 5,
    });

    expect(output).toContain('[user] Make a blue icon');
    expect(output).toContain('Generate a blue app icon');
    expect(output).toContain('16:9');
    expect(output).toContain('5');
    expect(output).not.toContain('Safety Filter Alert');
    expect(output).not.toContain('Previous Attempt Error');
  });

  it('visual/nodes/direct/context includes safety alert when safetyBlocked is true', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
      safetyBlocked: true,
    });

    expect(output).toContain('Safety Filter Alert');
    expect(output).toContain('**BLOCKED**');
    expect(output).toContain('safety filter');
  });

  it('visual/nodes/direct/context includes error section when visualError is set', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
      visualError: 'Image generation timed out',
    });

    expect(output).toContain('Previous Attempt Error');
    expect(output).toContain('Image generation timed out');
    expect(output).toContain('alternative route');
  });

  it('visual/nodes/direct/rules renders only the matching asset type guide', async () => {
    await initPartials(TEMPLATES_DIR);

    const logoOutput = await adapter.render('jobs/visual/nodes/direct/variants/default/rules', {
      ...SAMPLE_VARS, isLogo: true, isIcon: false, isHero: false, isIllustration: false,
    });
    expect(logoOutput).toContain('Logo Principles');
    expect(logoOutput).not.toContain('Icon Principles');
    expect(logoOutput).not.toContain('Hero and Background Principles');

    const iconOutput = await adapter.render('jobs/visual/nodes/direct/variants/default/rules', {
      ...SAMPLE_VARS, isLogo: false, isIcon: true, isHero: false, isIllustration: false,
    });
    expect(iconOutput).toContain('Icon Principles');
    expect(iconOutput).not.toContain('Logo Principles');

    const heroOutput = await adapter.render('jobs/visual/nodes/direct/variants/default/rules', {
      ...SAMPLE_VARS, isLogo: false, isIcon: false, isHero: true, isIllustration: false,
    });
    expect(heroOutput).toContain('Hero and Background Principles');
    expect(heroOutput).not.toContain('Logo Principles');

    const illustrationOutput = await adapter.render('jobs/visual/nodes/direct/variants/default/rules', {
      ...SAMPLE_VARS, isLogo: false, isIcon: false, isHero: false, isIllustration: true,
    });
    expect(illustrationOutput).toContain('Illustration Principles');
    expect(illustrationOutput).not.toContain('Logo Principles');

    const generalOutput = await adapter.render('jobs/visual/nodes/direct/variants/default/rules', {
      ...SAMPLE_VARS, isLogo: false, isIcon: false, isHero: false, isIllustration: false,
    });
    expect(generalOutput).not.toContain('Logo Principles');
    expect(generalOutput).not.toContain('Icon Principles');
    expect(generalOutput).not.toContain('Hero and Background Principles');
    expect(generalOutput).not.toContain('Illustration Principles');
    expect(generalOutput).toContain('Routing Decision');
  });

  it('visual/nodes/direct/classify renders with conversation context, directive, and jobMode', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/direct/variants/default/classify', {
      conversationContext: '[user] I need a logo for my SaaS',
      currentDirective: 'Create a clean logo',
    });

    expect(output).toContain('[user] I need a logo for my SaaS');
    expect(output).toContain('Create a clean logo');
    expect(output).toContain('<classify>');
    expect(output).toContain('assetType');
    expect(output).toContain('jobMode');
    expect(output).toContain('"generate" or "explain"');
  });

  it('visual/nodes/direct/context injects previous generation context when available', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
      lastEngineeredPrompt: 'A minimalist blue logo with geometric shapes on white background',
      lastOutputPath: '/workspace/assets/gen/gen-123.png',
    });

    expect(output).toContain('Previous Generation');
    expect(output).toContain('minimalist blue logo');
    expect(output).toContain('gen-123.png');
    expect(output).toContain('Finalized Asset');
  });

  it('visual/nodes/direct/context omits generation context when not available', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
    });

    expect(output).not.toContain('Previous Generation');
    expect(output).not.toContain('Finalized Asset');
  });

  it('visual/nodes/direct/context shows available sketches section when sketches exist', async () => {
    await initPartials(TEMPLATES_DIR);

    const withSketches = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
      availableSketchCount: 3,
    });
    expect(withSketches).toContain('Available Sketches');
    expect(withSketches).toContain('3 sketch image');
    expect(withSketches).toContain('embedded below as inline images');

    const withoutSketches = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
    });
    expect(withoutSketches).not.toContain('Available Sketches');
  });

  it('visual/nodes/direct/context shows clarify budget and exhausted warning', async () => {
    await initPartials(TEMPLATES_DIR);

    const normal = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
      clarifyCount: 2,
      maxClarify: 5,
      clarifyBudgetExhausted: false,
    });
    expect(normal).toContain('Clarify Budget');
    expect(normal).toContain('2');
    expect(normal).toContain('5');
    expect(normal).not.toContain('BUDGET EXHAUSTED');

    const exhausted = await adapter.render('jobs/visual/nodes/direct/variants/default/context', {
      ...SAMPLE_VARS,
      clarifyCount: 5,
      maxClarify: 5,
      clarifyBudgetExhausted: true,
    });
    expect(exhausted).toContain('BUDGET EXHAUSTED');
    expect(exhausted).toContain('MUST NOT route to `clarify`');
  });

  it('visual/nodes/direct/rules includes refinement routing section', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/direct/variants/default/rules', SAMPLE_VARS);

    expect(output).toContain('Refinement Routing');
    expect(output).toContain('targeted modification');
  });

  it('visual/nodes/engrave/base includes creator identity and SVG rules', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/visual/nodes/engrave/variants/default/base', SAMPLE_VARS);

    expect(output).toContain('creative asset producer');
    expect(output).toContain('SVG');
    expect(output).toContain('viewBox');
  });

  it('visual partial chains resolve correctly via collectResolvedPartials', async () => {
    await initPartials(TEMPLATES_DIR);

    const directPartials = collectResolvedPartials(['jobs/visual/nodes/direct/variants/default/base']);
    expect(directPartials).toContain('agents/creator/base');
    expect(directPartials).toContain('agents/creator/rules');
    expect(directPartials).toContain('jobs/visual/nodes/direct/variants/default/rules');

    const engravePartials = collectResolvedPartials(['jobs/visual/nodes/engrave/variants/default/base']);
    expect(engravePartials).toContain('agents/creator/base');
    expect(engravePartials).toContain('jobs/visual/nodes/engrave/variants/default/rules');
  });

  it('action-context.md renders documents with role labels under unified section', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/shared/injections/action-context', {
      resolvedAction: {
        hasExplicitFields: true,
        intentDescription: 'Generate code from design',
        documents: [
          { path: 'plan/prd.md', content: '# PRD\nOverview', role: 'ref' },
          { path: 'architecture/system/fe-system-main.md', content: '# FE Design', role: 'context' },
        ],
      },
    });

    // Unified "Provided Documents" section with 3-axis role-guide partial
    expect(output).toContain('## Provided Documents');
    expect(output).toContain('### [ref] plan/prd.md');
    expect(output).toContain('# PRD');
    expect(output).toContain('### [context] architecture/system/fe-system-main.md');
    expect(output).toContain('# FE Design');
    // Role-guide partial is rendered
    expect(output).toContain('ref');
    expect(output).toContain('context');
    expect(output).toContain('both authoritative inputs');
    // Legacy section headers removed
    expect(output).not.toContain('Primary References');
    expect(output).not.toContain('Background Context');
    expect(output).not.toContain('Do NOT treat as implementation source');
    // refs must render before context (original material first)
    const refIdx = output.indexOf('### [ref]');
    const ctxIdx = output.indexOf('### [context]');
    expect(refIdx).toBeGreaterThan(-1);
    expect(ctxIdx).toBeGreaterThan(refIdx);
  });

  it('action-context.md falls back to path list when no documents', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/shared/injections/action-context', {
      resolvedAction: {
        hasExplicitFields: true,
        intentDescription: 'Generate code',
        refs: ['docs/spec.md'],
        context: ['docs/notes.md'],
      },
    });

    expect(output).toContain('selected as `ref` inputs');
    expect(output).toContain('docs/spec.md');
    expect(output).toContain('selected as `context` inputs');
    expect(output).toContain('docs/notes.md');
    expect(output).toContain('`ref` wins on conflict');
  });

  it('action-context.md renders target list', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/shared/injections/action-context', {
      resolvedAction: {
        hasExplicitFields: true,
        intentDescription: 'Generate frontend code',
        target: ['src/App.tsx', 'src/main.tsx'],
      },
    });

    // New wording: Output Target section
    expect(output).toContain('Output Target');
    expect(output).toContain('src/App.tsx');
    expect(output).toContain('src/main.tsx');
  });

  it('action-context.md renders nothing when hasExplicitFields is false', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('jobs/shared/injections/action-context', {
      resolvedAction: {
        hasExplicitFields: false,
      },
    });

    expect(output.trim()).toBe('');
  });

  it('all § section references in design templates match canonical catalog names', async () => {
    const catalogDir = join(TEMPLATES_DIR, 'jobs/design/base/catalogs');
    const catalogFiles = (await fs.readdir(catalogDir))
      .filter(f => f.endsWith('-catalog-names.md'));

    const canonicalNames = new Set<string>();
    for (const file of catalogFiles) {
      const content = await fs.readFile(join(catalogDir, file), 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.trim().match(/^- (§ [^(]+)/);
        if (match) canonicalNames.add(match[1].trim());
      }
    }

    expect(canonicalNames.size).toBeGreaterThan(0);

    const designDir = join(TEMPLATES_DIR, 'jobs/design');
    async function collectMdFiles(dir: string): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) files.push(...await collectMdFiles(p));
        else if (e.name.endsWith('.md') && !e.name.endsWith('-catalog-names.md')) files.push(p);
      }
      return files;
    }

    function stripCodeBlocks(text: string): string {
      return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]+`/g, '');
    }

    const mdFiles = await collectMdFiles(designDir);
    // Match Title-Case word sequences after §: stops at lowercase, parens, or non-name chars
    const sectionRefPattern = /§ (?:[A-Z][A-Za-z-]*(?:\s*&\s*|\s+))*[A-Z][A-Za-z-]*/g;
    const violations: Array<{ file: string; ref: string }> = [];

    for (const filePath of mdFiles) {
      const raw = await fs.readFile(filePath, 'utf-8');
      const content = stripCodeBlocks(raw);
      const matches = content.match(sectionRefPattern);
      if (!matches) continue;

      const uniqueRefs = [...new Set(matches.map(m => m.trim()))];
      for (const ref of uniqueRefs) {
        if (!canonicalNames.has(ref)) {
          const relPath = filePath.replace(TEMPLATES_DIR + '/', '');
          violations.push({ file: relPath, ref });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map(v => `  ${v.file} → "${v.ref}"`)
        .join('\n');
      expect.fail(
        `${violations.length} non-canonical § reference(s) found:\n${report}\n\nCanonical names: ${[...canonicalNames].join(', ')}`
      );
    }
  });
});
