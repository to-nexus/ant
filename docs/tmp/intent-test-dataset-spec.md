# Intent Test Dataset — Implementation Spec

> **구현 완료**: `packages/ant-cli/tests/intents/` 에 구현됨. 테스트 문서는 `docs/testing/prompt-test-spec.md` > Intent Acceptance 참조.

새 탭에서 이 문서만 보고 구현 가능한 완전한 사양.

## 목적

16개 intent에 대해 `(directive, basis, refs, context)` 세트를 준비하고, 디렉티브 입력 → RAC 생성 → 프롬프트 빌드까지의 전체 파이프라인을 자동 검증한다. 프롬프트 변경 시 회귀/퇴행을 스냅샷으로 잡는다.

## 현재 시스템 핵심 구조

### Intent → 라우팅

```
packages/ant-shared/src/actions.ts
├── INTENT_DEFINITIONS (125-155행): 16개 intent 정의
├── deriveFromIntent() (187-234행): intent → agent/jobType/jobMode/workType/environment
└── Basis type (166행): 'prd' | 'directive' | 'existing-doc' | 'figma' | 'references' | 'spec' | 'design-doc'
```

### Action Config Matrix (SSOT)

```
packages/ant-shared/src/action-config-matrix.ts
├── MATRIX (189-363행): (intent, basis) → { refs, context, target } 매핑
├── getConfigSlots(intent, basis): ConfigSlots | null
└── getAvailableBases(intent): Basis[]
```

이 매트릭스가 FE(ActionConfigView)와 BE(resolve node)에서 공유되는 SSOT.

### ActionMetadata (UI → BE 전달 구조)

```typescript
// packages/ant-shared/src/actions.ts:168
interface ActionMetadata {
  explicit?: boolean;
  intent?: string;        // 'create-plan', 'create-fe', ...
  target?: string[];      // 생성 대상 파일 경로
  basis?: Basis;          // 'prd' | 'directive' | ...
  refs?: string[];        // primary reference 파일 경로
  context?: string[];     // secondary context 파일 경로
}
```

### RAC 생성

```
packages/ant-shared/src/rac.ts
├── resolveFromExplicit(metadata, profile?, hints?): ResolvedActionContext
│   → intent, basis, refs, context, target이 RAC에 보존됨
└── resolveFromInfer(report, metadata?, profile?, hints?): ResolvedActionContext
```

### 프롬프트 파이프라인

```
PromptEngine.buildExecutePrompt(job, context, artifacts, mode, taskType)
  → InputNormalizer → ContextAssembler → ModeController → TemplateComposer → PolicyInjector → PromptFormatter
  → PromptBuildResult { formatted, composed, modeConfig, context, metadata }
```

테스트에서 `engine.extractPromptText(result)`로 전체 텍스트 추출 가능.

### Debug 시스템 (참고)

런타임 debug 산출물은 `{featurePath}/sessions/{agent}/debug/` 하위:
- `prompts/prompt-{jobId}.md` — 프롬프트 구조 (메타, 주입 변수명, 템플릿 경로)
- `logs/log-{jobId}.json` — 실행 이벤트 (시작/완료/실패/tool_call)
- `plans/` — 플랜 텍스트
- `tokens/` — 토큰 사용량

debug 시스템은 **런타임 관측용**이지 자동 테스트와 직접 연결되지 않는다. 자동 회귀 방지는 vitest 스냅샷으로 한다.

## 구현할 파일 목록

```
packages/ant-cli/tests/intents/
├── dataset.ts                    ← 22개 fixture 정의
├── documents/                    ← 8개 샘플 문서
│   ├── prd-refine.md
│   ├── fe-system-main.md
│   ├── be-system-main.md
│   ├── api-contract-main.md
│   ├── ui-spec.json
│   ├── ui-tokens.json
│   ├── spec-search-api.md
│   └── figma.json
├── intent-acceptance.test.ts     ← vitest 자동 테스트
└── (e2e-reference → docs/testing/e2e-intent-reference.md 로 이동됨)
```

## 1. dataset.ts 상세

### 타입 정의

```typescript
import type { Basis, ActionMetadata } from '@ant/shared';
import type { ResolvedDocument } from '@ant/shared';

export interface IntentFixture {
  /** Intent ID */
  intent: string;
  /** 한국어 테스트 디렉티브 — 간결하되 intent 특성이 드러나게 */
  directive: string;

  /** UI가 BE에 보내는 것과 동일한 구조 */
  metadata: ActionMetadata;

  /** refs/context 경로 → 문서 내용 매핑. 테스트 시 ResolvedDocument로 변환 */
  documents: Record<string, { content: string; role: 'ref' | 'context' }>;

  /** 라우팅 기대값 */
  routing: {
    agent: string;
    jobType: string;
    jobMode: string;
    workType?: string;
    environment?: string;
  };

  /** 프롬프트 기대값 */
  prompt: {
    templateBase: string;
    requiredInjections: string[];
    forbiddenInjections: string[];
    /** 프롬프트 텍스트에 반드시 포함 */
    mustContain: string[];
  };
}
```

### 22개 Fixture 정의

intent가 여러 basis를 가질 때, 대표 basis + 주요 변형을 별도 fixture로 만든다. 이름 규칙: `{intent}` 또는 `{intent}:{basis}`.

**모든 디렉티브는 1문장, 한국어, 테스트용으로 짧게.**
**문서 내용은 테스트 속도를 위해 최소화. 핵심 키워드만 포함.**

```typescript
// ── Plan ──
{
  intent: 'create-plan',
  directive: '공중화장실 검색 모바일 웹 서비스를 기획해줘',
  metadata: { intent: 'create-plan', basis: 'directive' },
  documents: {},
  routing: { agent: 'planner', jobType: 'plan', jobMode: 'generate' },
  prompt: {
    templateBase: 'plan',  // plan job은 별도 빌더
    requiredInjections: [],
    forbiddenInjections: [],
    mustContain: ['공중화장실'],
  },
},
{
  intent: 'revise-plan',
  directive: '소셜 로그인을 추가하고 비회원 리뷰를 삭제해줘',
  metadata: {
    intent: 'revise-plan', basis: 'directive',
    refs: ['inputs/sources/prd-refine.md'],
  },
  documents: {
    'inputs/sources/prd-refine.md': { content: LOAD('prd-refine.md'), role: 'ref' },
  },
  routing: { agent: 'planner', jobType: 'plan', jobMode: 'refactor' },
  prompt: { ... },
},

// ── System Design (3 create + 1 revise) ──
{
  intent: 'create-fe',
  directive: 'React로 프론트엔드 시스템 설계해줘',
  metadata: {
    intent: 'create-fe', basis: 'prd',
    refs: ['inputs/sources/prd-refine.md'],
  },
  documents: {
    'inputs/sources/prd-refine.md': { content: LOAD('prd-refine.md'), role: 'ref' },
  },
  routing: { agent: 'architect', jobType: 'design', jobMode: 'generate',
             workType: 'system-design', environment: 'frontend' },
  prompt: {
    templateBase: 'design/phases/execute/base-system-design',
    requiredInjections: ['design/base/injections/frontend-guide'],
    forbiddenInjections: ['design/base/injections/backend-guide'],
    mustContain: ['React'],
  },
},
// create-fe:directive 변형 — refs 없이 directive만
{
  intent: 'create-fe',  // same intent, different basis
  directive: 'React Tailwind 프론트엔드 설계해줘',
  metadata: { intent: 'create-fe', basis: 'directive' },
  documents: {},
  routing: { agent: 'architect', jobType: 'design', jobMode: 'generate',
             workType: 'system-design', environment: 'frontend' },
  prompt: { ... },
},

// create-be, create-fullstack, revise-system 유사 패턴 ...

// ── Code (3 변형) ──
{
  intent: 'create-code',
  directive: '설계 문서 기반으로 코드 생성해줘',
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
// create-code:spec — spec 기반
// create-code:directive — 문서 없이
// refactor-code:existing-doc
// refactor-code:directive
```

`LOAD()` 헬퍼는 `documents/` 디렉토리에서 파일을 읽는 함수:
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
const DOC_DIR = join(__dirname, 'documents');
function LOAD(filename: string): string {
  return readFileSync(join(DOC_DIR, filename), 'utf-8');
}
```

## 2. documents/ 샘플 문서

**원칙: 테스트 속도 우선. 최소 내용 + 핵심 키워드만.**

### prd-refine.md (~15행)
```markdown
# 공중화장실 검색 서비스

## 핵심 기능
- 현재 위치 기반 화장실 검색 (지도 API)
- 화장실 상세 정보 (청결도, 장애인 시설, 기저귀 교환대)
- 사용자 리뷰 및 별점
- 즐겨찾기 저장

## 기술 스택
- Frontend: React, TypeScript, Tailwind CSS
- Backend: Node.js, Express, PostgreSQL
- 외부 API: 공공데이터 화장실 API, Kakao Maps
```

### fe-system-main.md (~20행)
```markdown
# Frontend System Design: main

## 라우팅
- / → 지도 검색
- /toilet/:id → 상세 페이지
- /mypage → 즐겨찾기/리뷰

## 컴포넌트
- MapView: Kakao Maps 래퍼
- ToiletCard: 검색 결과 카드
- ReviewForm: 리뷰 작성 폼
- RatingStars: 별점 컴포넌트

## 상태 관리
- Zustand store: search, favorites, auth
```

### be-system-main.md (~20행)
```markdown
# Backend System Design: main

## API 엔드포인트
- GET /api/toilets?lat=&lng=&radius= → 검색
- GET /api/toilets/:id → 상세
- POST /api/reviews → 리뷰 작성
- GET /api/favorites → 즐겨찾기 목록

## DB 스키마
- toilets: id, name, lat, lng, address, facilities
- reviews: id, toilet_id, user_id, rating, content
- favorites: user_id, toilet_id

## 인증
- JWT 기반, refresh token
```

### api-contract-main.md (~15행)
```markdown
# API Contract: main

## GET /api/toilets
Query: lat, lng, radius (meters)
Response: { toilets: [{ id, name, lat, lng, distance, avgRating }] }

## GET /api/toilets/:id
Response: { id, name, address, facilities, reviews: [...] }

## POST /api/reviews
Body: { toiletId, rating, content }
Auth: Bearer JWT required
```

### ui-spec.json (~10행, 간략)
```json
{
  "sections": [
    { "id": "map-search", "name": "지도 검색", "components": ["MapView", "SearchBar", "ToiletCard"] },
    { "id": "detail", "name": "화장실 상세", "components": ["FacilityBadges", "ReviewList", "ReviewForm"] }
  ]
}
```

### ui-tokens.json (~8행)
```json
{
  "colors": { "primary": "#2563EB", "background": "#FFFFFF", "text": "#1F2937" },
  "spacing": { "xs": "4px", "sm": "8px", "md": "16px" },
  "typography": { "heading": "Pretendard 24px bold", "body": "Pretendard 16px" }
}
```

### spec-search-api.md (~15행)
```markdown
# Spec: 화장실 검색 API

## 구현 범위
- GET /api/toilets 엔드포인트
- 위치 기반 검색 (PostGIS ST_DWithin)
- 결과 정렬: 거리순 기본, 별점순 옵션

## 입력 검증
- lat: -90 ~ 90, lng: -180 ~ 180
- radius: 100 ~ 5000 (meters)

## 응답 페이지네이션
- cursor 기반, limit 기본 20
```

### figma.json (~3행)
```json
{
  "fileKey": "test-file-key-12345",
  "nodeId": "0:1"
}
```

## 3. intent-acceptance.test.ts 구조

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';
import { PromptEngine } from '../src/core/prompt/engine/PromptEngine';
import { resolveFromExplicit, getConfigSlots, getAvailableBases, deriveFromIntent } from '@ant/shared';
import type { ResolvedDocument, ResolvedActionContext } from '@ant/shared';
import { FIXTURES } from './intents/dataset';

const TEMPLATES_DIR = join(__dirname, '../src/core/prompt/templates');
let engine: PromptEngine;

beforeAll(async () => {
  const adapter = new FilePromptAdapter(TEMPLATES_DIR);
  await initPartials(TEMPLATES_DIR);
  engine = new PromptEngine({ promptPort: adapter, contextLoader: async () => ({}) });
});

describe('Intent Acceptance', () => {
  for (const fixture of FIXTURES) {
    const label = `${fixture.intent}${fixture.metadata.basis ? ':' + fixture.metadata.basis : ''}`;

    describe(label, () => {
      // 단계 1: Config Matrix 정합
      it('config matrix has valid slots', () => {
        const basis = fixture.metadata.basis!;
        expect(getAvailableBases(fixture.intent)).toContain(basis);
        const slots = getConfigSlots(fixture.intent, basis);
        expect(slots).not.toBeNull();
      });

      // 단계 2: RAC 생성 + 필드 보존
      it('RAC routing matches expected', () => {
        const rac = resolveFromExplicit(fixture.metadata);
        const derived = deriveFromIntent(fixture.intent);
        expect(derived.agent).toBe(fixture.routing.agent);
        expect(derived.jobType).toBe(fixture.routing.jobType);
        expect(rac.jobMode).toBe(fixture.routing.jobMode);
        if (fixture.routing.workType) expect(rac.workType).toBe(fixture.routing.workType);
        if (fixture.routing.environment) expect(rac.tech.environment).toBe(fixture.routing.environment);
        // refs/context 보존
        if (fixture.metadata.refs?.length) {
          expect(rac.refs).toEqual(fixture.metadata.refs);
        }
        if (fixture.metadata.context?.length) {
          expect(rac.context).toEqual(fixture.metadata.context);
        }
        if (fixture.metadata.basis) {
          expect(rac.basis).toBe(fixture.metadata.basis);
        }
      });

      // 단계 3: 프롬프트 빌드 (code/design execute만 — plan/visual/learn은 별도 빌더)
      // plan job은 buildTaskPlanPrompt, visual/learn은 스킵
      if (['code', 'design'].includes(fixture.routing.jobType)) {
        it('prompt build: injections match', async () => {
          const docs: ResolvedDocument[] = Object.entries(fixture.documents).map(
            ([path, { content, role }]) => ({ path, content, role })
          );
          const rac = resolveFromExplicit(fixture.metadata);
          if (docs.length) rac.documents = docs;

          const ctx = { project: 'test', featurePath: '/tmp/test', featureFolder: 'test' } as any;
          const result = await engine.buildExecutePrompt(
            fixture.routing.jobType as any, ctx,
            {
              directive: fixture.directive,
              documents: docs.length ? docs : undefined,
              resolvedAction: rac,
              currentTask: { name: label, type: 'feature', priority: 200, description: fixture.directive },
            },
            undefined,
            fixture.routing.jobType === 'design' ? undefined : 'feature',
          );

          const inj = result.modeConfig.templates.injections;
          for (const req of fixture.prompt.requiredInjections) {
            expect(inj.some(i => i.includes(req))).toBe(true);
          }
          for (const forbidden of fixture.prompt.forbiddenInjections) {
            expect(inj.some(i => i.includes(forbidden))).toBe(false);
          }
        });

        it('prompt text snapshot', async () => {
          // 위와 동일하게 빌드 후 스냅샷
          const docs: ResolvedDocument[] = Object.entries(fixture.documents).map(
            ([path, { content, role }]) => ({ path, content, role })
          );
          const rac = resolveFromExplicit(fixture.metadata);
          if (docs.length) rac.documents = docs;

          const ctx = { project: 'test', featurePath: '/tmp/test', featureFolder: 'test' } as any;
          const result = await engine.buildExecutePrompt(
            fixture.routing.jobType as any, ctx,
            {
              directive: fixture.directive,
              documents: docs.length ? docs : undefined,
              resolvedAction: rac,
              currentTask: { name: label, type: 'feature', priority: 200, description: fixture.directive },
            },
            undefined,
            fixture.routing.jobType === 'design' ? undefined : 'feature',
          );

          const text = engine.extractPromptText(result);
          for (const keyword of fixture.prompt.mustContain) {
            expect(text).toContain(keyword);
          }
          expect(result.modeConfig.templates.injections).toMatchSnapshot();
        });
      }
    });
  }
});
```

## 4. e2e-reference.md

수동 E2E 레퍼런스: 실제 서버 띄우고 intent별로 API 호출할 때 사용.

각 intent에 대해:
- directive + metadata JSON (curl 예시)
- 예상 triage 결과
- 예상 산출물 파일
- PASS/FAIL 기준

## 5. 디버그 활용

자동 테스트 실패 시 디버깅 순서:
1. vitest 스냅샷 diff 확인 (어떤 injection이 바뀌었는지)
2. 실제 서버에서 해당 intent 실행
3. `sessions/{agent}/debug/prompts/prompt-{jobId}.md` 확인 (템플릿 경로, 주입 변수)
4. `sessions/{agent}/debug/logs/log-{jobId}.json` 확인 (실행 이벤트)

debug 시스템은 런타임 관측용이므로 자동 테스트와 직접 통합하지 않는다. 회귀 방지는 vitest 스냅샷이 담당하고, debug는 실패 원인 추적 시 사용한다.

## 실행 순서

1. `documents/` 8개 파일 작성
2. `dataset.ts` 22개 fixture 정의
3. `intent-acceptance.test.ts` 작성
4. `pnpm vitest run tests/intents/intent-acceptance.test.ts --update` 로 스냅샷 생성
5. 스냅샷 수동 검토 후 커밋
6. `e2e-reference.md` 작성
7. `pnpm test:cli` 전체 통과 확인
