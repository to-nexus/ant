import type { Basis, ActionMetadata } from '@ant/shared';
import type { ResolvedDocument } from '@ant/shared';
import { readFileSync } from 'fs';
import { join } from 'path';

// ============================================
// Types
// ============================================

export interface IntentFixture {
  intent: string;
  directive: string;
  metadata: ActionMetadata;
  /** refs/context 경로 → 문서 내용 매핑. 테스트 시 ResolvedDocument로 변환 */
  documents: Record<string, { content: string; role: 'ref' | 'context' }>;
  /** design job에서 decompose가 설정하는 targetFile (injection 결정에 영향) */
  targetFile?: string;
  routing: {
    agent: string;
    jobType: string;
    jobMode: string;
    workType?: string;
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
// 22 Fixtures
// ============================================

export const FIXTURES: IntentFixture[] = [

  // ─────────────────────────────────────────────
  // Plan (2)
  // ─────────────────────────────────────────────

  {
    intent: 'create-plan',
    directive: D('create-plan:directive'),
    metadata: { intent: 'create-plan', basis: 'directive' },
    documents: {},
    routing: { agent: 'planner', jobType: 'plan', jobMode: 'generate' },
    prompt: {
      templateBase: 'plan',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['프로젝트 관리'],
    },
  },

  {
    intent: 'revise-plan',
    directive: D('revise-plan:directive'),
    metadata: {
      intent: 'revise-plan', basis: 'directive',
      refs: ['inputs/sources/prd.md'],
    },
    documents: {
      'inputs/sources/prd.md': { content: LOAD('prd.md'), role: 'ref' },
    },
    routing: { agent: 'planner', jobType: 'plan', jobMode: 'refactor' },
    prompt: {
      templateBase: 'plan',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['소셜 로그인'],
    },
  },

  // ─────────────────────────────────────────────
  // System Design: Create FE (2 변형)
  // ─────────────────────────────────────────────

  {
    intent: 'create-fe',
    directive: D('create-fe:prd'),
    metadata: {
      intent: 'create-fe', basis: 'prd',
      refs: ['inputs/sources/prd.md'],
    },
    documents: {
      'inputs/sources/prd.md': { content: LOAD('prd.md'), role: 'ref' },
    },
    targetFile: 'fe-system-main.md',
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'system-design', environment: 'frontend',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: ['design/base/injections/frontend-guide'],
      forbiddenInjections: ['design/base/injections/backend-guide'],
      mustContain: ['React'],
    },
  },

  {
    intent: 'create-fe',
    directive: D('create-fe:directive'),
    metadata: { intent: 'create-fe', basis: 'directive' },
    documents: {},
    targetFile: 'fe-system-main.md',
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'system-design', environment: 'frontend',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: ['design/base/injections/frontend-guide'],
      forbiddenInjections: ['design/base/injections/backend-guide'],
      mustContain: ['React Tailwind'],
    },
  },

  // ─────────────────────────────────────────────
  // System Design: Create BE (2 변형)
  // ─────────────────────────────────────────────

  {
    intent: 'create-be',
    directive: D('create-be:prd'),
    metadata: {
      intent: 'create-be', basis: 'prd',
      refs: ['inputs/sources/prd.md'],
    },
    documents: {
      'inputs/sources/prd.md': { content: LOAD('prd.md'), role: 'ref' },
    },
    targetFile: 'be-system-main.md',
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'system-design', environment: 'backend',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: ['design/base/injections/backend-guide'],
      forbiddenInjections: ['design/base/injections/frontend-guide'],
      mustContain: ['Express'],
    },
  },

  {
    intent: 'create-be',
    directive: D('create-be:directive'),
    metadata: { intent: 'create-be', basis: 'directive' },
    documents: {},
    targetFile: 'be-system-main.md',
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'system-design', environment: 'backend',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: ['design/base/injections/backend-guide'],
      forbiddenInjections: ['design/base/injections/frontend-guide'],
      mustContain: ['Node.js'],
    },
  },

  // ─────────────────────────────────────────────
  // System Design: Create Fullstack (1)
  // ─────────────────────────────────────────────

  {
    intent: 'create-fullstack',
    directive: D('create-fullstack:prd'),
    metadata: {
      intent: 'create-fullstack', basis: 'prd',
      refs: ['inputs/sources/prd.md'],
    },
    documents: {
      'inputs/sources/prd.md': { content: LOAD('prd.md'), role: 'ref' },
    },
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'system-design', environment: 'fullstack',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['풀스택'],
    },
  },

  // ─────────────────────────────────────────────
  // System Design: Revise (1)
  // ─────────────────────────────────────────────

  {
    intent: 'revise-system',
    directive: D('revise-system:directive'),
    metadata: {
      intent: 'revise-system', basis: 'directive',
      refs: ['outputs/design/system/fe-system-main.md'],
    },
    documents: {
      'outputs/design/system/fe-system-main.md': { content: LOAD('fe-system-main.md'), role: 'ref' },
    },
    targetFile: 'fe-system-main.md',
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'refactor',
      workType: 'system-design',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: ['common/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['OAuth'],
    },
  },

  // ─────────────────────────────────────────────
  // UI Design: Create Figma (1)
  // figma.json은 FigmaDataConfig({ file: string }) 설정 파일.
  // 경로만 refs에 전달되고 문서 내용은 프롬프트에 주입되지 않는다.
  // ─────────────────────────────────────────────

  {
    intent: 'create-figma',
    directive: D('create-figma:figma'),
    metadata: {
      intent: 'create-figma', basis: 'figma',
      refs: ['inputs/figma.json'],
    },
    documents: {},
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'ui-design',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['Figma'],
    },
  },

  // ─────────────────────────────────────────────
  // UI Design: Create Ref (1)
  // references는 이미지 파일 경로. 프롬프트에 내용 주입 없음.
  // ─────────────────────────────────────────────

  {
    intent: 'create-ref',
    directive: D('create-ref:references'),
    metadata: {
      intent: 'create-ref', basis: 'references',
      refs: ['inputs/references/screenshot.png'],
    },
    documents: {},
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'ui-design',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['레퍼런스'],
    },
  },

  // ─────────────────────────────────────────────
  // UI Design: Create Desc (2 변형)
  // ─────────────────────────────────────────────

  {
    intent: 'create-desc',
    directive: D('create-desc:prd'),
    metadata: {
      intent: 'create-desc', basis: 'prd',
      refs: ['inputs/sources/prd.md'],
    },
    documents: {
      'inputs/sources/prd.md': { content: LOAD('prd.md'), role: 'ref' },
    },
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'ui-design',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['PRD'],
    },
  },

  {
    intent: 'create-desc',
    directive: D('create-desc:directive'),
    metadata: { intent: 'create-desc', basis: 'directive' },
    documents: {},
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'ui-design',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['텍스트'],
    },
  },

  // ─────────────────────────────────────────────
  // UI Design: Revise (1)
  // ─────────────────────────────────────────────

  {
    intent: 'revise-ui',
    directive: D('revise-ui:directive'),
    metadata: {
      intent: 'revise-ui', basis: 'directive',
      refs: ['outputs/design/ui/ui-tokens.json'],
    },
    documents: {
      'outputs/design/ui/ui-tokens.json': { content: LOAD('ui-tokens.json'), role: 'ref' },
    },
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'refactor',
      workType: 'ui-design',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: ['common/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['다크 테마'],
    },
  },

  // ─────────────────────────────────────────────
  // Spec: Create
  // ─────────────────────────────────────────────

  {
    intent: 'create-spec',
    directive: D('create-spec:directive'),
    metadata: { intent: 'create-spec', basis: 'directive' },
    documents: {},
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'generate',
      workType: 'spec',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['사용자 인증'],
    },
  },

  // ─────────────────────────────────────────────
  // Spec: Revise (1)
  // ─────────────────────────────────────────────

  {
    intent: 'revise-spec',
    directive: D('revise-spec:directive'),
    metadata: {
      intent: 'revise-spec', basis: 'directive',
      refs: ['outputs/design/spec/spec-search-api.md'],
    },
    documents: {
      'outputs/design/spec/spec-search-api.md': { content: LOAD('spec-search-api.md'), role: 'ref' },
    },
    routing: {
      agent: 'architect', jobType: 'design', jobMode: 'refactor',
      workType: 'spec',
    },
    prompt: {
      templateBase: 'design/phases/execute/base-system-design',
      requiredInjections: ['common/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['cursor'],
    },
  },

  // ─────────────────────────────────────────────
  // Code: Create (3 변형)
  // ─────────────────────────────────────────────

  {
    intent: 'create-code',
    directive: D('create-code:design-doc'),
    metadata: {
      intent: 'create-code', basis: 'design-doc',
      refs: ['outputs/design/system/fe-system-main.md'],
      context: ['outputs/design/ui/ui-spec.json'],
    },
    documents: {
      'outputs/design/system/fe-system-main.md': { content: LOAD('fe-system-main.md'), role: 'ref' },
      'outputs/design/ui/ui-spec.json': { content: LOAD('ui-spec.json'), role: 'context' },
    },
    routing: { agent: 'architect', jobType: 'code', jobMode: 'generate' },
    prompt: {
      templateBase: 'code/phases/execute/base',
      requiredInjections: ['common/injections/action-context'],
      forbiddenInjections: [],
      mustContain: ['fe-system'],
    },
  },

  {
    intent: 'create-code',
    directive: D('create-code:spec'),
    metadata: {
      intent: 'create-code', basis: 'spec',
      refs: ['outputs/design/spec/spec-search-api.md'],
      context: ['outputs/design/system/be-system-main.md'],
    },
    documents: {
      'outputs/design/spec/spec-search-api.md': { content: LOAD('spec-search-api.md'), role: 'ref' },
      'outputs/design/system/be-system-main.md': { content: LOAD('be-system-main.md'), role: 'context' },
    },
    routing: { agent: 'architect', jobType: 'code', jobMode: 'generate' },
    prompt: {
      templateBase: 'code/phases/execute/base',
      requiredInjections: ['common/injections/action-context'],
      forbiddenInjections: [],
      mustContain: ['태스크 검색'],
    },
  },

  {
    intent: 'create-code',
    directive: D('create-code:directive'),
    metadata: { intent: 'create-code', basis: 'directive' },
    documents: {},
    routing: { agent: 'architect', jobType: 'code', jobMode: 'generate' },
    prompt: {
      templateBase: 'code/phases/execute/base',
      requiredInjections: [],
      forbiddenInjections: [],
      mustContain: ['TODO'],
    },
  },

  // ─────────────────────────────────────────────
  // Code: Refactor (2 변형)
  // ─────────────────────────────────────────────

  {
    intent: 'refactor-code',
    directive: D('refactor-code:existing-doc'),
    metadata: {
      intent: 'refactor-code', basis: 'existing-doc',
      refs: ['outputs/design/spec/spec-search-api.md'],
    },
    documents: {
      'outputs/design/spec/spec-search-api.md': { content: LOAD('spec-search-api.md'), role: 'ref' },
    },
    routing: { agent: 'architect', jobType: 'code', jobMode: 'refactor' },
    prompt: {
      templateBase: 'code/phases/execute/base',
      requiredInjections: ['common/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['리팩토링'],
    },
  },

  {
    intent: 'refactor-code',
    directive: D('refactor-code:directive'),
    metadata: { intent: 'refactor-code', basis: 'directive' },
    documents: {},
    routing: { agent: 'architect', jobType: 'code', jobMode: 'refactor' },
    prompt: {
      templateBase: 'code/phases/execute/base',
      requiredInjections: ['common/injections/refactor-guidance'],
      forbiddenInjections: [],
      mustContain: ['성능 최적화'],
    },
  },
];
