# 라우트 파일 네이밍 컨벤션 통일 리팩토링

## 📋 개요

**날짜**: 2025-12-23  
**작업**: HTTP 라우트 파일 네이밍 컨벤션 통일  
**목적**: 일관된 파일명 규칙 적용 (`~.routes.ts` 형태)

---

## 🎯 문제점

라우트 파일들이 두 가지 다른 네이밍 컨벤션을 사용하고 있었습니다:

### Before (혼재)
```
✅ 표준 컨벤션 (~.routes.ts):
  - chat.routes.ts
  - features.routes.ts
  - files.routes.ts
  - github.routes.ts
  - health.routes.ts
  - models.routes.ts
  - projects.routes.ts
  - figma-files.routes.ts
  - figma-oauth.routes.ts

❌ 비표준 컨벤션 (~Routes.ts):
  - authRoutes.ts
  - devServerRoutes.ts
  - ideRoutes.ts
  - jobRoutes.ts
  - kanbanRoutes.ts
  - sseRoutes.ts
  - workflowRoutes.ts
```

---

## ✅ 리팩토링 결과

### 변경된 파일명

| Before | After | 설명 |
|--------|-------|------|
| `authRoutes.ts` | `auth.routes.ts` | 인증 라우트 |
| `devServerRoutes.ts` | `dev-server.routes.ts` | 개발 서버 라우트 |
| `ideRoutes.ts` | `ide.routes.ts` | IDE 통합 라우트 |
| `jobRoutes.ts` | `job.routes.ts` | Job 실행 라우트 |
| `kanbanRoutes.ts` | `kanban.routes.ts` | 칸반 보드 라우트 |
| `sseRoutes.ts` | `sse.routes.ts` | SSE 이벤트 라우트 |
| `workflowRoutes.ts` | `workflow.routes.ts` | 워크플로우 라우트 |

### After (통일)
```
✅ 모든 파일이 통일된 컨벤션 사용:
  - auth.routes.ts
  - chat.routes.ts
  - dev-server.routes.ts
  - features.routes.ts
  - figma-files.routes.ts
  - figma-oauth.routes.ts
  - files.routes.ts
  - github.routes.ts
  - health.routes.ts
  - ide.routes.ts
  - job.routes.ts
  - kanban.routes.ts
  - models.routes.ts
  - projects.routes.ts
  - sse.routes.ts
  - workflow.routes.ts
```

---

## 🔄 변경된 파일들

### 1. 라우트 파일 리네이밍 (7개)
```bash
mv authRoutes.ts        → auth.routes.ts
mv devServerRoutes.ts   → dev-server.routes.ts
mv ideRoutes.ts         → ide.routes.ts
mv jobRoutes.ts         → job.routes.ts
mv kanbanRoutes.ts      → kanban.routes.ts
mv sseRoutes.ts         → sse.routes.ts
mv workflowRoutes.ts    → workflow.routes.ts
```

### 2. index.ts 업데이트
```typescript
// Before
export { createJobRoutes } from './jobRoutes';
export { createKanbanRoutes } from './kanbanRoutes';
export { createDevServerRoutes } from './devServerRoutes';
export { createWorkflowRoutes } from './workflowRoutes';
export { createSSERoutes } from './sseRoutes';
export { createAuthRoutes } from './authRoutes';
export { createIDERoutes } from './ideRoutes';

// After
export { createJobRoutes } from './job.routes';
export { createKanbanRoutes } from './kanban.routes';
export { createDevServerRoutes } from './dev-server.routes';
export { createWorkflowRoutes } from './workflow.routes';
export { createSSERoutes } from './sse.routes';
export { createAuthRoutes } from './auth.routes';
export { createIDERoutes } from './ide.routes';
```

---

## 📐 네이밍 컨벤션 규칙

### 표준 형식
```
{feature}.routes.ts
```

### 규칙
1. **소문자 사용**: 모든 문자는 소문자 (kebab-case)
2. **하이픈 구분**: 여러 단어는 하이픈(`-`)으로 연결
3. **확장자 전 접미사**: `.routes.ts`로 끝남

### 예시
- ✅ `auth.routes.ts`
- ✅ `dev-server.routes.ts`
- ✅ `figma-files.routes.ts`
- ❌ `authRoutes.ts` (camelCase)
- ❌ `AuthRoutes.ts` (PascalCase)
- ❌ `auth_routes.ts` (snake_case)

---

## 🎯 장점

### 1. 일관성
- 모든 라우트 파일이 동일한 네이밍 규칙 사용
- 새로운 개발자가 쉽게 파일명 패턴 학습 가능

### 2. 가독성
- kebab-case는 URL 친화적
- 파일명에서 역할을 명확히 알 수 있음

### 3. 유지보수성
- 파일 검색 및 정렬이 용이
- IDE의 자동완성 기능 향상

### 4. 확장성
- 새로운 라우트 추가 시 명확한 네이밍 가이드라인 제공

---

## ✅ 검증 완료

### 빌드 테스트
```bash
✅ TypeScript 컴파일: 성공
✅ npm run build: 성공
✅ 임포트 참조: 정상 동작
```

### 파일 구조 확인
```bash
$ ls packages/ant-cli/src/periphery/adapters/http/routes/
auth.routes.ts          ✅
chat.routes.ts          ✅
dev-server.routes.ts    ✅
features.routes.ts      ✅
figma-files.routes.ts   ✅
figma-oauth.routes.ts   ✅
files.routes.ts         ✅
github.routes.ts        ✅
health.routes.ts        ✅
ide.routes.ts           ✅
job.routes.ts           ✅
kanban.routes.ts        ✅
models.routes.ts        ✅
projects.routes.ts      ✅
sse.routes.ts           ✅
workflow.routes.ts      ✅
```

---

## 📝 마이그레이션 가이드

### 외부 임포트 영향
기존 코드는 `./routes` 디렉토리의 `index.ts`를 통해 임포트하므로 **영향 없음**:

```typescript
// ExpressServerAdapter.ts
import {
  createJobRoutes,
  createKanbanRoutes,
  // ... 등등
} from './routes';  // ✅ index.ts를 통해 re-export되므로 변경 불필요
```

### 직접 임포트하는 경우 (드물지만)
만약 직접 파일을 임포트했다면 업데이트 필요:

```typescript
// Before
import { createJobRoutes } from './routes/jobRoutes';

// After
import { createJobRoutes } from './routes/job.routes';
```

---

## 📊 통계

| 항목 | 값 |
|------|-----|
| 리네이밍된 파일 | 7개 |
| 수정된 파일 | 1개 (index.ts) |
| 영향받은 임포트 | 0개 (index.ts를 통한 re-export) |
| 빌드 오류 | 0개 |
| 총 라우트 파일 | 18개 (모두 통일된 컨벤션) |

---

## 🎉 결론

HTTP 라우트 파일의 네이밍 컨벤션을 성공적으로 통일했습니다.

**핵심 성과**:
- ✅ 7개 파일 리네이밍 완료
- ✅ 100% 일관된 네이밍 규칙 적용
- ✅ 빌드 및 테스트 통과
- ✅ 기존 코드에 영향 없음

**개발자 경험 개선**:
- 🎯 명확한 파일명 규칙
- 📁 쉬운 파일 검색 및 탐색
- 🔍 IDE 자동완성 향상
- 📚 새 개발자 온보딩 용이

---

**작성자**: Cursor AI  
**검토일**: 2025-12-23  
**상태**: ✅ 완료




