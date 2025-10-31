# Prompt Path Fix - workspace prefix 문제 해결

## 문제

LLM이 파일을 생성할 때 잘못된 경로를 사용하고 있었습니다:

```
❌ 잘못된 경로:
=== FILE: workspace/test-app/package.json ===
=== FILE: workspace/test-app/src/components/Header.tsx ===
```

이렇게 생성된 파일은:
- 실제 타겟 리포지토리가 `/Users/probe/dev/test-app`인데
- `workspace/` prefix가 붙어서 파일이 잘못된 위치에 저장되거나
- TypeScript/빌드 시스템이 파일을 찾지 못함

## 근본 원인

`src/core/prompt/templates/code/phases/execute/base.md` 파일의 78-108번 라인에서 
**잘못된 예제**를 제공하고 있었습니다:

```markdown
✅ CORRECT - Consistent paths:
=== FILE: workspace/test-app/package.json ===  ← 이게 문제!
```

LLM이 이 "CORRECT" 예제를 따라서 workspace prefix를 포함시키고 있었습니다.

## 해결 방법

프롬프트 템플릿을 수정하여:

### Before (잘못된 예제)
```markdown
✅ CORRECT - Consistent paths:
=== FILE: workspace/test-app/package.json ===
=== FILE: workspace/test-app/tsconfig.json ===
```

### After (올바른 예제)
```markdown
✅ CORRECT - Repository-relative paths:
=== FILE: package.json ===
=== FILE: src/components/Header.tsx ===
=== FILE: vite.config.ts ===
```

**핵심 규칙 추가:**
1. **ALWAYS use paths relative to the target repository root**
2. **NEVER include "workspace/" prefix in file paths**  
3. **NEVER use absolute paths** (e.g., /Users/probe/...)
4. The file writer handles the actual disk location automatically

## 영향

이 수정으로:
- ✅ LLM이 리포지토리 루트 기준 상대 경로만 사용
- ✅ 파일이 올바른 위치에 생성됨
- ✅ TypeScript/빌드 시스템이 정상 작동
- ✅ Import 경로가 올바르게 해석됨

## 테스트 필요

다음 명령어로 테스트:
```bash
npm run dev -- architect code workspace/test-app/skeleton/
```

생성되는 파일 경로가:
```
✅ package.json
✅ src/components/Header.tsx
✅ vite.config.ts
```

형식이어야 합니다.

