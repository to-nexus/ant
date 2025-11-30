# Collection Storage Timing & Responsibility

## 📊 각 컬렉션의 저장 시점

### 1. **codebase-{project}** (코드베이스 컬렉션)
**저장 시점**:
- ✅ `ant learn [project]` - Learn Job (명시적)
- ✅ Git push 후 자동 인덱싱 (ProjectService.autoIndexCodebase)
- ✅ `ant index [project]` - 수동 인덱싱 커맨드
- ✅ 프로젝트 최초 생성 시 (선택적)

**저장 내용**:
- Source code chunks (실제 코드 내용)
- AST-based code structures

**책임 컴포넌트**:
- `CodebaseIndexer` (core/codebase/CodebaseIndexer.ts)
- Learn Job의 `resolve` node (agents/architect/graph/learn/nodes/resolve.ts)

---

### 2. **documents-{project}** (문서 컬렉션) ✨ NEW
**저장 시점**:
- ✅ Design Job 완료 시 - design doc + PRD 저장 (함께)
- ✅ Code Job 시작 시 - directive 저장 (chat input)
- ❌ Learn node에서는 저장하지 않음 (Reference만)

**저장 내용**:
- Design documents (전체 내용)
- PRD specifications (전체 내용)
- User directives (전체 내용)
- Technical specs (전체 내용)

**책임 컴포넌트**:
- `DocumentIndexer` (NEW - core/documents/DocumentIndexer.ts)
- Design Job의 `learn` node (design document 인덱싱)
- Code Job의 `resolve` node (directive 인덱싱)

---

### 3. **lessons-{project}** (지식 컬렉션)
**저장 시점**:
- ✅ Code Job의 각 태스크 완료 시 (learn node)
- ✅ Design Job 완료 시 (learn node)
- ❌ Learn Job에서는 저장하지 않음 (Learn Job은 codebase 인덱싱만)

**저장 내용**:
- Problem-Solution-Outcome 구조
- Patterns applied
- Anti-patterns avoided
- **References only** (design doc 파일명, directive ID)

**책임 컴포넌트**:
- Code Job의 `learn` node (agents/architect/graph/code/nodes/learn.ts)
- Design Job의 `learn` node (agents/architect/graph/design/nodes/learn.ts)

---

### 4. **context-{project}** (컨텍스트 컬렉션) - 추후 확장
**저장 시점**: 미래 기능
**저장 내용**: User preferences, session history

---

## 🔄 Learn Job vs Learn Node 명확화

### **Learn Job** (`ant learn [project]`)
```typescript
// agents/architect/graph/learn/

Purpose: 코드베이스 인덱싱 (명시적 학습)
Stores to: codebase-{project} collection

Actions:
1. index_branch     → CodebaseIndexer → codebase collection
2. index_codebase   → CodebaseIndexer → codebase collection
3. learn_files      → 특정 파일 인덱싱 → codebase collection
4. learn_text       → 텍스트 학습 (미사용)

Does NOT store:
- ❌ Documents (design/PRD/directive)
- ❌ Lessons (problem-solution patterns)
```

### **Learn Node** (in Code/Design Job)
```typescript
// agents/architect/graph/code/nodes/learn.ts
// agents/architect/graph/design/nodes/learn.ts

Purpose: 작업 완료 후 경험/패턴 저장
Stores to: lessons-{project} collection

Actions:
1. Extract problem-solution-outcome
2. Store lessons to vector DB
3. Save session turn to file

Does NOT store:
- ❌ Codebase (already in codebase collection)
- ❌ Full documents (only references)
```

---

## 🎯 리팩토링 후 흐름

### Scenario 1: Design Job
```
1. Design Job 시작
2. resolve node:
   - Load previous design (from documents collection)
   - Load directive (from documents collection)
   - Load codebase context (from codebase collection)
3. execute node:
   - Generate design document
4. writeFiles node:
   - Write design doc to disk
5. learn node:
   ✅ Index design doc → documents-{project}
   ✅ Store lesson → lessons-{project}
      - Problem: "Design new authentication system"
      - Solution: "Used JWT + OAuth2 pattern"
      - Outcome: "Success"
      - Design ref: "auth-system-design.md" (not full content)
```

### Scenario 2: Code Job (from Chat)
```
1. Code Job 시작 (chat directive)
2. resolve node:
   ✅ Index directive → documents-{project}
   - Load design doc (from documents collection)
   - Load codebase (from codebase collection)
   - Load lessons (from lessons collection)
3. decompose node:
   - Break into tasks
4. For each task:
   a. plan node
   b. codeGen node
   c. writeFiles node
   d. runtimeValidate node
   e. learn node:
      ✅ Store lesson → lessons-{project}
         - Problem: "Implement login endpoint"
         - Solution: "Used Express + JWT middleware"
         - Outcome: "Success"
         - Design ref: "auth-system-design.md"
         - Directive ref: "directive-12345"
         - Related files: ["src/auth/login.ts"]
```

### Scenario 3: Learn Job (Explicit Indexing)
```
1. ant learn [project]
2. decompose node:
   - LLM decides: index_codebase
3. resolve node:
   ✅ CodebaseIndexer → codebase-{project}
      - All source files
      - Chunked and indexed
4. Does NOT create lessons
5. Does NOT index documents
```

### Scenario 4: Git Push (Auto-indexing)
```
1. User pushes to GitHub
2. ProjectService.autoIndexCodebase():
   ✅ CodebaseIndexer → codebase-{project}
      - Smart indexing (incremental if possible)
      - Chat UI status updates
3. Does NOT create lessons
4. Does NOT index documents
```

---

## 📋 Summary Table

| Collection | Stored By | When | Content |
|------------|-----------|------|---------|
| `codebase-{project}` | CodebaseIndexer | Learn Job, Git push, Manual index | Source code chunks |
| `documents-{project}` | DocumentIndexer | Design Job learn, Code Job resolve | Design/PRD/Directive (full) |
| `lessons-{project}` | Code/Design learn node | After each task | Problem-Solution-Outcome (refs only) |
| `context-{project}` | TBD | Future | User preferences, session |

---

## ✅ 결론

**Learn node에서 저장되는 것**:
- ✅ `lessons-{project}` collection (problem-solution-outcome)
- ❌ `codebase-{project}` collection (Learn Job이 담당)
- ❌ `documents-{project}` collection (DocumentIndexer가 담당)

**Learn Job에서 저장되는 것**:
- ✅ `codebase-{project}` collection (source code chunks)
- ❌ `lessons-{project}` collection (Code/Design Job의 learn node가 담당)
- ❌ `documents-{project}` collection (DocumentIndexer가 담당)

**명확한 책임 분리**:
- Learn Job = 코드베이스 인덱싱 전문
- Learn Node = 작업 경험/패턴 저장 전문
- DocumentIndexer = 문서 인덱싱 전문

