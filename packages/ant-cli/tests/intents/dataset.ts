import type { ActionMetadata } from '@ant/shared';
import type { ResolvedArtifact } from '@ant/shared';
import { readFileSync } from 'fs';
import { join } from 'path';

// ============================================
// Types
// ============================================

export interface IntentFixture {
  intent: string;
  directive: string;
  metadata: ActionMetadata;
  /** refs/context 경로 → 문서 내용 매핑. 테스트 시 ResolvedArtifact로 변환 */
  documents: Record<string, { content: string; role: 'ref' | 'context' }>;
  /** design job에서 decompose가 설정하는 targetFile (injection 결정에 영향) */
  targetFile?: string;
  routing: {
    agent: string;
    jobType: string;
    mode: string;
    intentGroup?: string;
    environment?: string;
  };
  prompt: {
    templateBase: string;
    requiredInjections: string[];
    forbiddenInjections: string[];
    mustContain: string[];
  };
}

// ============================================
// Document Loader
// ============================================

const DOC_DIR = join(__dirname, 'documents');
function LOAD(filename: string): string {
  return readFileSync(join(DOC_DIR, filename), 'utf-8');
}

const DIRECTIVES: Record<string, string> = JSON.parse(LOAD('directives.json'));
function D(key: string): string {
  const val = DIRECTIVES[key];
  if (!val) throw new Error(`Missing directive for key: ${key}`);
  return val;
}

// ============================================
// Fixtures
// ============================================

export const FIXTURES: IntentFixture[] = [

  // ─────────────────────────────────────────────
  // Plan (2)
  // ─────────────────────────────────────────────

  {
    intent: 'gen-plan',
    directive: D('gen-plan'),
    metadata: { intent: 'gen-plan' },
    documents: {},
    routing: { agent: 'planner', jobType: 'plan', mode: 'generate' },
    prompt: {
      templateBase: 'plan',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['프로젝트 관리'],
    },
  },

  {
    intent: 'rev-plan',
    directive: D('rev-plan'),
    metadata: {
      intent: 'rev-plan',
      refs: ['plan/prd.md'],
    },
    documents: {
      'plan/prd.md': { content: LOAD('prd.md'), role: 'ref' },
    },
    routing: { agent: 'planner', jobType: 'plan', mode: 'refactor' },
    prompt: {
      templateBase: 'plan',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['소셜 로그인'],
    },
  },

  // ─────────────────────────────────────────────
  // System Design: Create FE (1)
  // ─────────────────────────────────────────────

  {
    intent: 'gen-sys-fe',
    directive: D('gen-sys-fe'),
    metadata: { intent: 'gen-sys-fe' },
    documents: {},
    targetFile: 'fe-system-main.md',
    routing: {
      agent: 'architect', jobType: 'design', mode: 'generate',
      intentGroup: 'design-system', environment: 'frontend',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: ['jobs/design/base/injections/frontend-guide'],
      forbiddenInjections: ['jobs/design/base/injections/backend-guide'],
      mustContain: ['React Tailwind'],
    },
  },

  // ─────────────────────────────────────────────
  // System Design: Create BE (1)
  // ─────────────────────────────────────────────

  {
    intent: 'gen-sys-be',
    directive: D('gen-sys-be'),
    metadata: { intent: 'gen-sys-be' },
    documents: {},
    targetFile: 'be-system-main.md',
    routing: {
      agent: 'architect', jobType: 'design', mode: 'generate',
      intentGroup: 'design-system', environment: 'backend',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: ['jobs/design/base/injections/backend-guide'],
      forbiddenInjections: ['jobs/design/base/injections/frontend-guide'],
      mustContain: ['Node.js'],
    },
  },

  // ─────────────────────────────────────────────
  // System Design: Create Fullstack (1)
  // ─────────────────────────────────────────────

  {
    intent: 'gen-sys-full',
    directive: D('gen-sys-full'),
    metadata: {
      intent: 'gen-sys-full',
      refs: ['plan/prd.md'],
    },
    documents: {
      'plan/prd.md': { content: LOAD('prd.md'), role: 'ref' },
    },
    routing: {
      agent: 'architect', jobType: 'design', mode: 'generate',
      intentGroup: 'design-system', environment: 'fullstack',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['풀스택'],
    },
  },

  // ─────────────────────────────────────────────
  // System Design: Revise (1)
  // ─────────────────────────────────────────────

  {
    intent: 'rev-sys',
    directive: D('rev-sys'),
    metadata: {
      intent: 'rev-sys',
      refs: ['architecture/system/fe-system-main.md'],
    },
    documents: {
      'architecture/system/fe-system-main.md': { content: LOAD('fe-system-main.md'), role: 'ref' },
    },
    targetFile: 'fe-system-main.md',
    routing: {
      agent: 'architect', jobType: 'design', mode: 'refactor',
      intentGroup: 'design-system',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: ['jobs/shared/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['OAuth'],
    },
  },

  // ─────────────────────────────────────────────
  // UI Design: Create Figma (1)
  // ─────────────────────────────────────────────

  {
    intent: 'gen-ui-figma',
    directive: D('gen-ui-figma'),
    metadata: {
      intent: 'gen-ui-figma',
      refs: ['visual/ui/figma/figma.json'],
    },
    documents: {},
    routing: {
      agent: 'architect', jobType: 'design', mode: 'generate',
      intentGroup: 'design-ui',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['Figma'],
    },
  },

  // ─────────────────────────────────────────────
  // UI Design: Create Desc (1)
  // ─────────────────────────────────────────────

  {
    intent: 'gen-ui-desc',
    directive: D('gen-ui-desc'),
    metadata: { intent: 'gen-ui-desc' },
    documents: {},
    routing: {
      agent: 'architect', jobType: 'design', mode: 'generate',
      intentGroup: 'design-ui',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['텍스트'],
    },
  },

  // ─────────────────────────────────────────────
  // UI Design: Revise (1)
  // ─────────────────────────────────────────────

  {
    intent: 'rev-ui',
    directive: D('rev-ui'),
    metadata: {
      intent: 'rev-ui',
      refs: ['visual/ui/ant/ui-tokens.json'],
    },
    documents: {
      'visual/ui/ant/ui-tokens.json': { content: LOAD('ui-tokens.json'), role: 'ref' },
    },
    routing: {
      agent: 'architect', jobType: 'design', mode: 'refactor',
      intentGroup: 'design-ui',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: ['jobs/shared/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['다크 테마'],
    },
  },

  // ─────────────────────────────────────────────
  // Spec: Create (1)
  // ─────────────────────────────────────────────

  {
    intent: 'gen-spec',
    directive: D('gen-spec'),
    metadata: { intent: 'gen-spec' },
    documents: {},
    routing: {
      agent: 'architect', jobType: 'design', mode: 'generate',
      intentGroup: 'design-spec',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['사용자 인증'],
    },
  },

  // ─────────────────────────────────────────────
  // Spec: Revise (1)
  // ─────────────────────────────────────────────

  {
    intent: 'rev-spec',
    directive: D('rev-spec'),
    metadata: {
      intent: 'rev-spec',
      refs: ['architecture/spec/spec-search-api.md'],
    },
    documents: {
      'architecture/spec/spec-search-api.md': { content: LOAD('spec-search-api.md'), role: 'ref' },
    },
    routing: {
      agent: 'architect', jobType: 'design', mode: 'refactor',
      intentGroup: 'design-spec',
    },
    prompt: {
      templateBase: 'jobs/design/nodes/execute/variants/system-design/base',
      requiredInjections: ['jobs/shared/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['cursor'],
    },
  },

  // ─────────────────────────────────────────────
  // Code: Create (3 변형 — intent가 basis를 인코딩)
  // ─────────────────────────────────────────────

  {
    intent: 'gen-code-sys',
    directive: D('gen-code-sys'),
    metadata: {
      intent: 'gen-code-sys',
      refs: ['architecture/system/fe-system-main.md'],
      context: ['visual/ui/ant/ui-spec.json'],
    },
    documents: {
      'architecture/system/fe-system-main.md': { content: LOAD('fe-system-main.md'), role: 'ref' },
      'visual/ui/ant/ui-spec.json': { content: LOAD('ui-spec.json'), role: 'context' },
    },
    routing: { agent: 'architect', jobType: 'code', mode: 'generate' },
    prompt: {
      templateBase: 'jobs/code/nodes/execute/variants/default/base',
      requiredInjections: ['jobs/shared/injections/action-context'],
      forbiddenInjections: [],
      mustContain: ['fe-system'],
    },
  },

  {
    intent: 'gen-code-spec',
    directive: D('gen-code-spec'),
    metadata: {
      intent: 'gen-code-spec',
      refs: ['architecture/spec/spec-search-api.md'],
      context: ['architecture/system/be-system-main.md'],
    },
    documents: {
      'architecture/spec/spec-search-api.md': { content: LOAD('spec-search-api.md'), role: 'ref' },
      'architecture/system/be-system-main.md': { content: LOAD('be-system-main.md'), role: 'context' },
    },
    routing: { agent: 'architect', jobType: 'code', mode: 'generate' },
    prompt: {
      templateBase: 'jobs/code/nodes/execute/variants/default/base',
      requiredInjections: ['jobs/shared/injections/action-context'],
      forbiddenInjections: [],
      mustContain: ['태스크 검색'],
    },
  },

  {
    intent: 'gen-code-directive',
    directive: D('gen-code-directive'),
    metadata: { intent: 'gen-code-directive' },
    documents: {},
    routing: { agent: 'architect', jobType: 'code', mode: 'generate' },
    prompt: {
      templateBase: 'jobs/code/nodes/execute/variants/default/base',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['TODO'],
    },
  },

  // ─────────────────────────────────────────────
  // Code: Revise (1)
  // ─────────────────────────────────────────────

  {
    intent: 'rev-code',
    directive: D('rev-code'),
    metadata: { intent: 'rev-code' },
    documents: {},
    routing: { agent: 'architect', jobType: 'code', mode: 'refactor' },
    prompt: {
      templateBase: 'jobs/code/nodes/execute/variants/default/base',
      requiredInjections: ['jobs/shared/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['성능 최적화'],
    },
  },
];
