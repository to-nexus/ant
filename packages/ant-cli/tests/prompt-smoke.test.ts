import { describe, it, expect, beforeAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { FilePromptAdapter, initPartials, collectResolvedPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';

// TemplateComposer registers extra helpers (includes, lower, etc.)
// Import it to trigger helper registration before tests run.
import '../src/core/prompt/engine/TemplateComposer';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');

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
  detectionReport: '## Detection\nNode.js environment detected',
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
  hasUiDoc: false,
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
  referenceCount: 0,
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
  hasScreens: false,
  hasComponents: false,

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
  let templateNames: string[];
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    templateNames = await collectTemplateNames(TEMPLATES_DIR);
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
      join(__dirname, '../src/core/prompt/injection-manifest.json'),
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

  it('secure-coding partial is resolved inside execute/rules and plan/rules', async () => {
    await initPartials(TEMPLATES_DIR);

    const rulesOutput = await adapter.render('code/phases/execute/rules', SAMPLE_VARS);
    expect(rulesOutput).toContain('untrusted');
    expect(rulesOutput).toContain('parameterized query');

    const planRulesOutput = await adapter.render('code/phases/plan/rules', SAMPLE_VARS);
    expect(planRulesOutput).toContain('untrusted');
    expect(planRulesOutput).toContain('parameterized query');
  });

  it('collectResolvedPartials tracks nested partials from templates', async () => {
    await initPartials(TEMPLATES_DIR);

    const partials = collectResolvedPartials(['code/phases/execute/rules']);
    expect(partials).toContain('code/base/injections/secure-coding');
    expect(partials).toContain('code/base/injections/persistence-schema-rule');

    const planPartials = collectResolvedPartials(['code/phases/plan/rules']);
    expect(planPartials).toContain('code/base/injections/secure-coding');
  });

  it('each template renders without throwing and produces non-empty output', async () => {
    await initPartials(TEMPLATES_DIR);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Templates wrapped entirely in {{#if}} blocks produce empty output when
    // the condition variable is falsy. This is expected behavior, not a failure.
    const ALLOWED_EMPTY = new Set([
      'common/injections/ui-doc',
      'common/injections/design-doc',
      'common/injections/prd-spec',
      'common/injections/memory',
      'common/injections/directive',
      'code/phases/decompose/mode-guide',
    ]);

    const failures: Array<{ name: string; error: string }> = [];

    for (const name of templateNames) {
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

    const output = await adapter.render('visual/nodes/direct/base', SAMPLE_VARS);

    expect(output).toContain('creative asset producer');
    expect(output).toContain('art director');
    expect(output).toContain('Routing Decision');
    expect(output).toContain('Response Format');
    expect(output).toContain('Single Asset Per Turn');
  });

  it('visual/nodes/direct/context injects conversation, directive, and settings', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('visual/nodes/direct/context', {
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

    const output = await adapter.render('visual/nodes/direct/context', {
      ...SAMPLE_VARS,
      safetyBlocked: true,
    });

    expect(output).toContain('Safety Filter Alert');
    expect(output).toContain('**BLOCKED**');
    expect(output).toContain('safety filter');
  });

  it('visual/nodes/direct/context includes error section when visualError is set', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('visual/nodes/direct/context', {
      ...SAMPLE_VARS,
      visualError: 'Image generation timed out',
    });

    expect(output).toContain('Previous Attempt Error');
    expect(output).toContain('Image generation timed out');
    expect(output).toContain('alternative route');
  });

  it('visual/nodes/direct/rules renders only the matching asset type guide', async () => {
    await initPartials(TEMPLATES_DIR);

    const logoOutput = await adapter.render('visual/nodes/direct/rules', {
      ...SAMPLE_VARS, isLogo: true, isIcon: false, isHero: false, isIllustration: false,
    });
    expect(logoOutput).toContain('Logo Principles');
    expect(logoOutput).not.toContain('Icon Principles');
    expect(logoOutput).not.toContain('Hero and Background Principles');

    const iconOutput = await adapter.render('visual/nodes/direct/rules', {
      ...SAMPLE_VARS, isLogo: false, isIcon: true, isHero: false, isIllustration: false,
    });
    expect(iconOutput).toContain('Icon Principles');
    expect(iconOutput).not.toContain('Logo Principles');

    const heroOutput = await adapter.render('visual/nodes/direct/rules', {
      ...SAMPLE_VARS, isLogo: false, isIcon: false, isHero: true, isIllustration: false,
    });
    expect(heroOutput).toContain('Hero and Background Principles');
    expect(heroOutput).not.toContain('Logo Principles');

    const illustrationOutput = await adapter.render('visual/nodes/direct/rules', {
      ...SAMPLE_VARS, isLogo: false, isIcon: false, isHero: false, isIllustration: true,
    });
    expect(illustrationOutput).toContain('Illustration Principles');
    expect(illustrationOutput).not.toContain('Logo Principles');

    const generalOutput = await adapter.render('visual/nodes/direct/rules', {
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

    const output = await adapter.render('visual/nodes/direct/classify', {
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

    const output = await adapter.render('visual/nodes/direct/context', {
      ...SAMPLE_VARS,
      lastEngineeredPrompt: 'A minimalist blue logo with geometric shapes on white background',
      lastOutputPath: '/workspace/inputs/assets/gen/gen-123.png',
    });

    expect(output).toContain('Previous Generation');
    expect(output).toContain('minimalist blue logo');
    expect(output).toContain('gen-123.png');
    expect(output).toContain('Finalized Asset');
  });

  it('visual/nodes/direct/context omits generation context when not available', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('visual/nodes/direct/context', {
      ...SAMPLE_VARS,
    });

    expect(output).not.toContain('Previous Generation');
    expect(output).not.toContain('Finalized Asset');
  });

  it('visual/nodes/direct/context shows available sketches section when sketches exist', async () => {
    await initPartials(TEMPLATES_DIR);

    const withSketches = await adapter.render('visual/nodes/direct/context', {
      ...SAMPLE_VARS,
      availableSketchCount: 3,
    });
    expect(withSketches).toContain('Available Sketches');
    expect(withSketches).toContain('3 sketch image');
    expect(withSketches).toContain('via the provided tools');

    const withoutSketches = await adapter.render('visual/nodes/direct/context', {
      ...SAMPLE_VARS,
    });
    expect(withoutSketches).not.toContain('Available Sketches');
  });

  it('visual/nodes/direct/context shows clarify budget and exhausted warning', async () => {
    await initPartials(TEMPLATES_DIR);

    const normal = await adapter.render('visual/nodes/direct/context', {
      ...SAMPLE_VARS,
      clarifyCount: 2,
      maxClarify: 5,
      clarifyBudgetExhausted: false,
    });
    expect(normal).toContain('Clarify Budget');
    expect(normal).toContain('2');
    expect(normal).toContain('5');
    expect(normal).not.toContain('BUDGET EXHAUSTED');

    const exhausted = await adapter.render('visual/nodes/direct/context', {
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

    const output = await adapter.render('visual/nodes/direct/rules', SAMPLE_VARS);

    expect(output).toContain('Refinement Routing');
    expect(output).toContain('targeted modification');
  });

  it('visual/nodes/engrave/base includes creator identity and SVG rules', async () => {
    await initPartials(TEMPLATES_DIR);

    const output = await adapter.render('visual/nodes/engrave/base', SAMPLE_VARS);

    expect(output).toContain('creative asset producer');
    expect(output).toContain('SVG');
    expect(output).toContain('viewBox');
  });

  it('visual partial chains resolve correctly via collectResolvedPartials', async () => {
    await initPartials(TEMPLATES_DIR);

    const directPartials = collectResolvedPartials(['visual/nodes/direct/base']);
    expect(directPartials).toContain('agents/creator/base');
    expect(directPartials).toContain('agents/creator/rules');
    expect(directPartials).toContain('visual/nodes/direct/rules');

    const engravePartials = collectResolvedPartials(['visual/nodes/engrave/base']);
    expect(engravePartials).toContain('agents/creator/base');
    expect(engravePartials).toContain('visual/nodes/engrave/rules');
  });

  it('all § section references in design templates match canonical catalog names', async () => {
    const catalogDir = join(TEMPLATES_DIR, 'design/base/catalogs');
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

    const designDir = join(TEMPLATES_DIR, 'design');
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
