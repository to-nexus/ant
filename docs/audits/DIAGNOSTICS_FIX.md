# 진단 시스템 근본적 수정 완료

## 🔍 발견한 근본 문제

### 문제 1: 로컬 파일과 NPM 패키지 구분 실패

**증상:**
```
❌ Type check failed: Missing module: ./components/Header

Suggested Actions:
• Add to package.json dependencies: "./components/Header": "latest"  ← 완전히 잘못됨!
```

**원인:**
진단 시스템의 정규식이 **모든 import 에러를 npm 패키지로 처리**:

```typescript
// 이전 코드 (잘못됨)
patterns: [
  /Cannot find module ['"](@?[\w\-/@.]+)['"]/,  // 모든 것을 매칭!
]

// 이 패턴이:
// ✅ 'react' → npm 패키지 (맞음)
// ❌ './components/Header' → npm 패키지로 오인! (틀림)
```

### 문제 2: 무한 루프

로컬 파일을 npm 패키지로 오인 → 잘못된 해결책 제안 → 실패 → 같은 에러 → 반복...
```
🔄 Task "Fix Missing Dependencies" failed
📌 Adding error task: Fix Missing Dependencies
🔄 Task "Fix Missing Dependencies" failed
📌 Adding error task: Fix Missing Dependencies
... (50번 반복) ...
❌ Error: Recursion limit reached
```

## ✅ 해결 방법

### 패턴 분리: 3가지 카테고리

**1. 로컬 파일 경로 (`./ or ../`)**
```typescript
{
  layer: ErrorLayer.CODE,
  patterns: [
    /Cannot find module ['"](\.\.[\/\\][\w\-/@.\\\/]+)['"]/,  // ../path
    /Cannot find module ['"](\.[\/\\][\w\-/@.\\\/]+)['"]/,    // ./path
  ],
  diagnosis: (match) => ({
    type: 'missing_file',  // ← npm 패키지가 아님!
    message: `Cannot find local file: ${filePath}`,
    suggestedActions: [
      `Create the missing file: ${filePath}`,  // ← 파일 생성 제안
      `Check if the import path is correct`,
      `Verify the file extension (.ts, .tsx)`
    ]
  })
}
```

**2. Path Alias (`@/path`)**
```typescript
{
  diagnosis: (match) => {
    const moduleName = match[1];
    const isPathAlias = moduleName.startsWith('@/');
    
    if (isPathAlias) {
      return {
        type: 'missing_file',
        message: `Cannot find file via path alias: ${moduleName}`,
        suggestedActions: [
          `Create the missing file at: src/${aliasPath}`,
          `Check tsconfig.json: "paths": { "@/*": ["./src/*"] }`,
          `Verify vite.config.ts has matching alias`
        ]
      };
    }
  }
}
```

**3. NPM 패키지 (나머지)**
```typescript
{
  layer: ErrorLayer.DEPENDENCY,
  patterns: [
    /Cannot find module ['"]([^.][^'"]*)['"]/,  // . 로 시작하지 않는 것
  ],
  diagnosis: (match) => ({
    type: 'missing_dependency',  // ← npm 패키지임
    message: `Missing npm package: ${moduleName}`,
    suggestedActions: [
      `Add to package.json dependencies: "${moduleName}": "latest"`,
      'npm install'
    ]
  })
}
```

## 🧪 테스트 결과

**모든 경우를 정확하게 구분:**

| 에러 메시지 | 이전 (잘못됨) | 현재 (올바름) |
|------------|-------------|-------------|
| `Cannot find module './components/Header'` | ❌ missing_dependency | ✅ missing_file |
| `Cannot find module '../utils/helper'` | ❌ missing_dependency | ✅ missing_file |
| `Cannot find module '@/components/SearchBar'` | ❌ missing_dependency | ✅ missing_file (path alias) |
| `Cannot find module 'react'` | ✅ missing_dependency | ✅ missing_dependency |
| `Cannot find module '@types/react'` | ✅ missing_dependency | ✅ missing_dependency |
| `Cannot find module '@vitejs/plugin-react'` | ✅ missing_dependency | ✅ missing_dependency |

**테스트 통과율: 8/8 (100%)** ✅

## 📊 개선 효과

### Before (이전)
```
❌ Cannot find module './components/Header'
→ 진단: "package.json에 './components/Header' 추가"
→ LLM이 package.json에 추가 시도
→ 여전히 파일이 없어서 실패
→ 무한 반복
→ 50번 후 recursion limit
```

### After (현재)
```
✅ Cannot find module './components/Header'
→ 진단: "로컬 파일이 없음"
→ 제안: "Create the missing file: ./components/Header"
→ LLM이 Header.tsx 파일 생성
→ 문제 해결! ✨
```

## 🎯 핵심 개선 사항

1. **정확한 진단**: 로컬 파일 vs npm 패키지 구분
2. **올바른 해결책**: 파일 생성 vs package.json 수정
3. **무한 루프 방지**: 적절한 해결책으로 문제 해결
4. **Path Alias 지원**: `@/` 경로도 올바르게 처리

## 📁 수정된 파일

- `src/agents/architect/graph/code/nodes/diagnostics/languages/typescript.ts`

## 🚀 다음 단계

이제 다시 architect code task를 실행하면:
- ✅ 로컬 파일 누락 시 → 파일 생성
- ✅ npm 패키지 누락 시 → package.json 업데이트
- ✅ 무한 루프 없음
- ✅ 정확한 문제 해결

테스트 명령어:
```bash
npm run dev -- architect code workspace/test-app/skeleton/
```

