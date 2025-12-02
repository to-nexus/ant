# output-format-markdown.md 사용 분석

## 🔍 발견 사항

### ❌ 잘못된 분류
**문제:** `output-format-markdown.md`를 code job 전용으로 분류했음

**실제:**
- ✅ **Code Job**: `.md` 파일 생성 시 streaming 사용
- ✅ **Design Job**: `.md` 파일 생성 시 streaming 사용

**결론:** 공통 injection 파일!

---

## 📊 사용 비교

### Code Job에서의 사용

**파일:** `code/base/injections/output-format-markdown.md`

**내용:**
```markdown
## 📝 Markdown File Output Format (Real-time Rendering)

### For Markdown Files ONLY:

#### Step 1: Stream content with `<file>` tag
<file path="path/to/document.md">
# Document Title
Content...
</file>

#### Step 2: Call write_file() with empty content
{
  "tool": "write_file",
  "arguments": {
    "path": "path/to/document.md",
    "content": ""
  }
}
```

**목적:**
- README.md, CHANGELOG.md 등 문서 파일 생성 시
- 실시간 스트리밍 프리뷰

---

### Design Job에서의 사용

**파일:** `design/phases/execute/rules.md` (내장)

**내용:**
```markdown
## OUTPUT FORMAT

### Scenario 1: Creating New Document (First Task)
<file path="outputs/design/[FILENAME]">
# Document Title
## 1. Overview
...
<!-- LAST_SECTION: 1 -->
</file>

### Scenario 2: Appending Content (Continuation Task)
<append path="outputs/design/[FILENAME]">
## N. [Topic]
...
<!-- LAST_SECTION: N -->
</append>
```

**목적:**
- api-contract.md, fe-system-design.md, be-system-design.md 생성
- 실시간 스트리밍 프리뷰
- 섹션 번호 관리 (`LAST_SECTION`)

---

## 🤔 차이점

| 항목 | Code Job | Design Job |
|------|----------|------------|
| **파일 타입** | 일반 .md (README, CHANGELOG) | Design docs (api-contract, fe-design, be-design) |
| **태그** | `<file>` 만 사용 | `<file>`, `<append>`, `<edit>` 사용 |
| **섹션 관리** | 없음 | `<!-- LAST_SECTION: N -->` 메타데이터 |
| **경로** | 자유 (src/, docs/, 등) | 고정 (`outputs/design/`) |
| **Streaming** | ✅ 동일 | ✅ 동일 |

---

## 🎯 공통점

**핵심 메커니즘 (둘 다 동일):**

1. **Step 1:** `<file>` 태그로 content streaming
   ```xml
   <file path="...">
   markdown content here
   </file>
   ```
   - 캐릭터 단위 실시간 렌더링
   - UI에서 typing 효과

2. **Step 2:** `write_file(content="")` 호출
   ```json
   {
     "tool": "write_file",
     "arguments": {
       "path": "...",
       "content": ""  // ← Empty = use buffer
     }
   }
   ```
   - 버퍼에서 실제 파일로 저장

**이유:**
- 마크다운 문서는 길기 때문에 (수백~수천 줄)
- 실시간 프리뷰가 UX에 중요
- 코드 파일 (.ts, .tsx)은 짧아서 즉시 표시 OK

---

## ✅ 수정 사항

### BEFORE (잘못된 분류)
```
templates/
├── base/injections/
│   ├── directive.md
│   ├── design-doc.md
│   └── memory.md
└── code/base/injections/
    ├── output-format-markdown.md  ← ❌ 여기 있었음
    ├── retrieved-code.md
    └── reference-code.md
```

### AFTER (올바른 분류)
```
templates/
├── base/injections/
│   ├── directive.md
│   ├── design-doc.md
│   ├── memory.md
│   └── output-format-markdown.md  ← ✅ 공통 injection!
└── code/base/injections/
    ├── retrieved-code.md
    ├── reference-code.md
    └── git-diff.md
```

---

## 🔧 ModeController 수정

### BEFORE
```typescript
// Markdown file streaming format (code job only)
if (task === 'code') {
  injections.push(`${taskPrefix}/output-format-markdown`);
}
```

### AFTER
```typescript
// Markdown file streaming format (used by both code and design jobs)
injections.push(`${commonPrefix}/output-format-markdown`);
```

**변경 이유:**
- `if (task === 'code')` 조건 제거
- 모든 job (code, design)이 execute phase에서 사용

---

## 🎊 최종 결론

**`output-format-markdown.md`는 공통 injection 파일이 맞습니다!**

**사용 시나리오:**
1. **Code Job**: README.md, CHANGELOG.md, docs/*.md 생성
2. **Design Job**: api-contract.md, fe-system-design.md, be-system-design.md 생성

**공통 메커니즘:**
- `<file>` tag streaming
- `write_file(content="")` buffer flush
- Real-time markdown preview

**감사합니다 - 정확한 지적이었습니다!** ✅

