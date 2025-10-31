# Error Diagnostics System

언어/빌드도구별 에러 진단 시스템

## 📁 구조

```
src/agents/architect/graph/code/nodes/diagnostics/
├── types.ts                    # 공통 타입 정의
├── index.ts                    # 중앙 진단 엔진
│
├── languages/                  # 언어별 패턴
│   ├── typescript.ts          # ✅ 구현 완료 (TS/JS 공통)
│   ├── python.ts              # 🔲 빈 구조 (향후 구현)
│   ├── java.ts                # 🔲 빈 구조
│   ├── go.ts                  # 🔲 빈 구조
│   └── rust.ts                # 🔲 빈 구조
│
└── buildTools/                 # 빌드 도구별 패턴
    ├── vite.ts                # ✅ 구현 완료
    ├── webpack.ts             # 🔲 빈 구조
    └── maven.ts               # 🔲 빈 구조
```

## 🎯 핵심 개념

### 1. 에러 레이어 (ErrorLayer)
**해결 책임에 따른 분류**

```typescript
enum ErrorLayer {
  ENVIRONMENT,    // 사용자만 해결 가능 (NODE_ENV, PATH)
  TOOLCHAIN,      // 도구 재설치 필요 (tsc, python)
  DEPENDENCY,     // 패키지 설치 (npm, pip)
  CONFIGURATION,  // 설정 파일 수정
  CODE,           // 소스 코드 수정
  BUILD           // 빌드 프로세스 문제
}
```

**핵심 규칙:**
- `ENVIRONMENT` / `TOOLCHAIN` → `isRetryable: false`, `canLLMFix: false`
  - **사용자 액션 필요**, LLM은 보고만 함
- `DEPENDENCY` / `CODE` / `BUILD` → `isRetryable: true`, `canLLMFix: true`
  - **LLM이 자동 수정 가능**

### 2. 언어 + 빌드도구 조합

```typescript
// 언어별 기본 패턴
const languagePatterns = LANGUAGE_PATTERNS[Language.TYPESCRIPT];

// 빌드 도구별 추가 패턴
const buildToolPatterns = BUILD_TOOL_PATTERNS[BuildTool.VITE];

// 조합
const allPatterns = [...languagePatterns, ...buildToolPatterns];
```

**이점:**
- TypeScript 기본 에러는 Vite/Webpack 모두 동일
- 빌드 도구별 에러만 추가 패턴으로 정의
- 중복 없이 확장 가능

## 📝 사용법

### 1. 프로젝트 감지

```typescript
// runtimeValidate.ts에서
import { detectProject } from './diagnostics';

const detection = await detectProject(projectPath, gitPort);
// {
//   language: Language.TYPESCRIPT,
//   buildTool: BuildTool.VITE,
//   hasTypeScript: true,
//   hasReact: true,
//   packageManager: 'npm'
// }
```

### 2. 에러 진단

```typescript
// runtimeValidate.ts에서
import { diagnoseError } from './diagnostics';

const diagnoses = diagnoseError(errorOutput, {
  output: errorOutput,
  command: 'tsc',
  projectPath: '/path/to/project',
  language: Language.TYPESCRIPT,
  buildTool: BuildTool.VITE
});

// [
//   {
//     type: 'environment_issue',
//     layer: ErrorLayer.ENVIRONMENT,
//     message: 'NODE_ENV=production preventing devDependencies',
//     rootCause: '...',
//     suggestedActions: ['npm install --include=dev', ...],
//     isRetryable: false,  // ← LLM이 재시도하지 않음
//     canLLMFix: false,    // ← 사용자 액션 필요
//     severity: 'critical'
//   }
// ]
```

### 3. Violation 생성

```typescript
// runtimeValidate.ts에서
for (const diagnosis of diagnoses) {
  violations.push({
    type: diagnosis.type,
    severity: diagnosis.severity,
    message: diagnosis.message,
    suggestedFix: diagnosis.suggestedActions.join('\n'),
    isRetryable: diagnosis.isRetryable
  });
  
  // ENVIRONMENT 레이어는 즉시 중단
  if (diagnosis.layer === ErrorLayer.ENVIRONMENT) {
    console.error('❌ User action required');
    return { ...state, violations };
  }
}
```

## ✅ 구현된 패턴 (TypeScript)

### ENVIRONMENT Layer
- ✅ `NODE_ENV=production` 감지
- ✅ `skipping devDependencies` 감지

### TOOLCHAIN Layer
- ✅ `tsc: command not found`
- ✅ `node: command not found`

### DEPENDENCY Layer
- ✅ `Cannot find module 'xxx'`
- ✅ `Module not found: 'xxx'`
- ✅ @types 패키지 제안

### CODE Layer
- ✅ `error TS2304: Cannot find name`
- ✅ Type assignment errors

### CONFIGURATION Layer
- ✅ Invalid tsconfig.json

## ✅ 구현된 패턴 (Vite)

### BUILD Layer
- ✅ `Could not resolve entry module` (index.html)
- ✅ `failed to resolve import`
- ✅ `[vite] error` 일반

### CONFIGURATION Layer
- ✅ vite.config.ts 에러

## 🔧 새 언어 추가 방법

```typescript
// languages/python.ts
export const PYTHON_PATTERNS: ErrorPattern[] = [
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /ModuleNotFoundError: No module named ['"](\w+)['"]/
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'missing_dependency',
      layer: ErrorLayer.DEPENDENCY,
      message: `Missing Python package: ${match[1]}`,
      rootCause: 'Package not in requirements.txt',
      suggestedActions: [
        `Add to requirements.txt: ${match[1]}`,
        'pip install -r requirements.txt'
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major'
    })
  }
];
```

그리고 `index.ts`에 등록:
```typescript
import { PYTHON_PATTERNS } from './languages/python';

const LANGUAGE_PATTERNS: Record<Language, ErrorPattern[]> = {
  // ...
  [Language.PYTHON]: PYTHON_PATTERNS,
};
```

## 💡 설계 원칙

1. **확장성**: 새 패턴은 배열에만 추가
2. **재사용**: 언어 패턴 + 빌드 도구 패턴 조합
3. **명확성**: 레이어로 해결 책임 구분
4. **테스트 가능**: 패턴별 독립 테스트
5. **학습 가능**: 진단 결과를 학습 데이터로 활용

## ✅ 완료된 변경사항

1. ✅ `dynamicValidate` → `runtimeValidate`로 이름 변경
   - 더 명확한 의미: "런타임에 실행해서 검증"
   - 파일명, 함수명, 모든 참조 업데이트 완료

## 🚀 다음 단계

1. `runtimeValidate.ts`에서 diagnostics 시스템 적용
2. `parseTypeScriptErrors`를 `diagnoseError`로 교체
3. `parseBuildErrors`를 `diagnoseError`로 교체
4. 에러 통계 수집 및 학습 시스템 연계

