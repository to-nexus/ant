# 🚀 Incremental Code Updates Proposal

## Problem
현재 Code job은 파일을 수정할 때마다 **전체 파일**을 LLM에게 생성하도록 요구합니다.
- ❌ 토큰 낭비 (1000줄 파일에서 5줄만 수정해도 1000줄 모두 생성)
- ❌ 느린 응답 속도
- ❌ 에러 확률 증가 (전체 파일을 다시 쓰면서 기존 코드 손상 가능)

**Design job은 이미 incremental update를 사용하고 있지만, Code job만 전체 파일 방식 사용 중**

---

## Solution: Search/Replace 방식 추가 (Cursor 스타일)

### 🎯 2가지 모드만 필요

| 상황 | 형식 | 설명 |
|------|------|------|
| **새 파일** | `=== FILE: ===` | 전체 내용 (현재 방식) |
| **기존 파일 수정** | `=== EDIT: ===` | Search/Replace 블록만 |

❌ Diff 형식은 **구현 안 함** (복잡하고 LLM이 정확히 생성하기 어려움)

---

### Phase 1: 파서에 Search/Replace 형식 추가

#### 새로운 파일 형식

```typescript
=== EDIT: src/components/Button.tsx ===
<<<<<<< SEARCH
export function Button({ label }: { label: string }) {
  return <button>{label}</button>;
}
=======
export function Button({ label, onClick }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>;
}
>>>>>>> REPLACE
=== END EDIT ===
```

#### 파서 구현 (`parseResponse.ts`)

```typescript
interface EditInstruction {
  path: string;
  searchPattern: string;
  replacement: string;
}

const EDIT_PARSERS: EditParser[] = [
  {
    name: 'Search/Replace Format',
    regex: /=== EDIT: (.+?) ===\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE\n=== END EDIT ===/g,
    extractPath: (m) => m[1].trim(),
    extractSearch: (m) => m[2].trim(),
    extractReplace: (m) => m[3].trim(),
  },
];

function parseEdits(content: string): EditInstruction[] {
  const edits: EditInstruction[] = [];
  
  for (const parser of EDIT_PARSERS) {
    let match: RegExpExecArray | null;
    
    while ((match = parser.regex.exec(content)) !== null) {
      edits.push({
        path: parser.extractPath(match),
        searchPattern: parser.extractSearch(match),
        replacement: parser.extractReplace(match),
      });
    }
  }
  
  return edits;
}
```

#### Apply 로직 (새로운 유틸)

```typescript
// src/utils/applyEdits.ts
export function applyEditToFile(
  originalContent: string,
  searchPattern: string,
  replacement: string
): string {
  // Exact match (가장 안전)
  if (originalContent.includes(searchPattern)) {
    return originalContent.replace(searchPattern, replacement);
  }
  
  // Fuzzy match (공백 차이 무시)
  const normalizedOriginal = originalContent.replace(/\s+/g, ' ');
  const normalizedSearch = searchPattern.replace(/\s+/g, ' ');
  
  if (normalizedOriginal.includes(normalizedSearch)) {
    // 원본의 인덱스를 찾아서 교체
    const startIdx = originalContent.indexOf(
      originalContent.split('\n').find(line => 
        line.replace(/\s+/g, ' ').includes(normalizedSearch.split(' ')[0])
      ) || ''
    );
    // ... (복잡한 로직, 필요 시 구현)
  }
  
  throw new Error(`Search pattern not found in file`);
}
```

---

### Phase 2: 프롬프트 개선

#### `code/phases/execute/base.md` 수정

**현재 (Line 87)**:
```markdown
3. Write COMPLETE files - NEVER use "// ..." to skip code
```

**개선안**:
```markdown
3. ⚠️ CRITICAL: Choose the correct output format based on the situation:

   **SITUATION A: Creating a NEW file (doesn't exist yet)**
   → Use === FILE: === format with COMPLETE file content
   
   **SITUATION B: Modifying EXISTING file (already in codebase)**
   → Use === EDIT: === format with SEARCH/REPLACE blocks
   
   ✅ **ALWAYS use EDIT for modifications** - saves 90% tokens!
   - Only specify the exact code section to change
   - Use SEARCH block for old code (must match exactly)
   - Use REPLACE block for new code
   - Saves tokens and reduces errors!
   
   ❌ **FORBIDDEN: Using FILE format to modify existing files**
   - Wastes tokens (must regenerate entire file)
   - Risk of conflicts (may overwrite other changes)
   - EXCEPTION: Only if >80% of file needs changes
```

#### 새로운 예시 추가

```markdown
**Example 1: Modifying a function (PREFERRED)**:

=== EDIT: src/utils/api.ts ===
<<<<<<< SEARCH
export async function fetchData(url: string) {
  const response = await fetch(url);
  return response.json();
}
=======
export async function fetchData(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}
>>>>>>> REPLACE
=== END EDIT ===

**Example 2: Adding a new function (use EDIT for existing file)**:

=== EDIT: src/utils/api.ts ===
<<<<<<< SEARCH
// ... end of fetchData

export { fetchData };
=======
// ... end of fetchData

export async function postData(url: string, data: any) {
  return fetchData(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export { fetchData, postData };
>>>>>>> REPLACE
=== END EDIT ===
```

---

### Phase 3: Execute 노드 수정

#### `execute.ts` - Edit 적용 로직

```typescript
// 현재 parseResponse 호출 후
const { responseSection, files, filesToDelete, edits, commands } = parseResponse(raw);

// ✅ Apply edits BEFORE writing full files
for (const edit of edits) {
  try {
    // Read existing file
    const existingContent = await state.deps.git.readFile(edit.path);
    
    // Apply edit
    const updatedContent = applyEditToFile(
      existingContent,
      edit.searchPattern,
      edit.replacement
    );
    
    // Add to files list (will be written by existing logic)
    files.push({
      path: edit.path,
      content: updatedContent
    });
    
    console.log(`✅ Applied edit to ${edit.path}`);
  } catch (error) {
    console.error(`❌ Failed to apply edit to ${edit.path}:`, error);
    // Fallback: Ask LLM to regenerate full file
  }
}

// Continue with existing file writing logic...
```

---

## Benefits

### Token Savings
**Before**:
```typescript
// 100줄 파일에서 5줄 수정
// LLM 출력: 100줄 전체 (~400 tokens)
```

**After**:
```typescript
// LLM 출력: 10줄 (search + replace, ~40 tokens)
// 90% 토큰 절약! 💰
```

### Speed Improvement
- ⚡ 10배 빠른 응답 (짧은 출력)
- ⚡ 네트워크 전송량 감소

### Accuracy Improvement
- ✅ 기존 코드를 건드리지 않음
- ✅ 정확히 원하는 부분만 수정
- ✅ Conflict 가능성 감소

---

## Compatibility

### Backward Compatible ✅
- 기존 `=== FILE: ===` 형식 계속 지원
- LLM이 선택해서 사용 가능
- 점진적 마이그레이션 가능

### Design Job과 일관성 ✅
- Design job도 incremental update 사용 중
- Code job도 동일한 철학 적용

---

## Implementation Checklist

- [ ] Phase 1: 파서 구현
  - [ ] `parseResponse.ts`에 `EDIT_PARSERS` 추가
  - [ ] `parseEdits()` 함수 구현
  - [ ] 테스트 케이스 작성
  
- [ ] Phase 2: Edit 적용 로직
  - [ ] `applyEdits.ts` 유틸 생성
  - [ ] `execute.ts`에 통합
  - [ ] 에러 핸들링 (fallback)
  
- [ ] Phase 3: 프롬프트 개선
  - [ ] `base.md` 수정 (Line 87)
  - [ ] 예시 추가
  - [ ] Rules 업데이트
  
- [ ] Phase 4: 테스트 & 검증
  - [ ] 단순 수정 (함수 파라미터 추가)
  - [ ] 복잡한 수정 (여러 곳 변경)
  - [ ] 에러 케이스 (search 실패)

---

## Alternative: Aider-style Whole-Line Replacement

Aider는 더 간단한 방식 사용:

```diff
src/utils/api.ts
<<<<<<< ORIGINAL
export async function fetchData(url: string) {
  const response = await fetch(url);
  return response.json();
}
=======
export async function fetchData(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}
>>>>>>> UPDATED
```

이 방식은 전체 함수를 대체하므로 더 간단하지만, 여전히 전체 파일보다는 훨씬 효율적입니다.

---

## Recommendation

**시작은 간단하게**:
1. Phase 1만 먼저 구현 (파서 + 적용 로직)
2. 프롬프트는 기존 유지하되, LLM이 자연스럽게 EDIT 형식을 사용하도록 유도
3. 테스트 후 프롬프트 개선

**최종 목표**:
- [ ] Code job도 Design처럼 incremental update 사용
- [ ] 토큰 사용량 50% 이상 절감
- [ ] 응답 속도 3배 이상 개선

