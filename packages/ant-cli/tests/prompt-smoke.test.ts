import { describe, it, expect, beforeAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';

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
});
