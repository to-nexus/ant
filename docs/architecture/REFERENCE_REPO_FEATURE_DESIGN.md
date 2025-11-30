# Reference Repository Feature 설계

## 🎯 목표

Directive에서 다른 repository를 참조할 수 있도록 하여, Frontend/Backend 간 API 계약 확인 등의 용도로 사용

## 📋 요구사항

1. **Directive에서 참조 repo 명시**
   ```markdown
   @ref ant-pong-be feature/skeleton
   
   프론트엔드에서 백엔드 API를 호출하는데 응답 형식을 확인해야 함
   ```

2. **참조 repo의 특정 branch 코드 로드**
   - 해당 branch가 존재하면 → 그 branch 사용
   - 없으면 → base branch (main/master) 사용

3. **Prompt에 참조 코드 포함**
   - 현재 project의 코드와 구분
   - 참조용임을 명시

## 🏗️ 설계

### 1. Directive Parsing

**위치**: `packages/ant-cli/src/agents/architect/graph/code/nodes/resolve.ts`

```typescript
/**
 * Parse @ref directives from directive text
 * 
 * Format: @ref <project> [branch]
 * Example: @ref ant-pong-be feature/skeleton
 */
interface RefDirective {
  project: string;
  branch?: string;
  line: number;  // For error messages
}

function parseRefDirectives(directive: string): RefDirective[] {
  const refs: RefDirective[] = [];
  const lines = directive.split('\n');
  
  lines.forEach((line, idx) => {
    const match = line.match(/@ref\s+([a-zA-Z0-9_-]+)(?:\s+([a-zA-Z0-9/_-]+))?/);
    if (match) {
      refs.push({
        project: match[1],
        branch: match[2],
        line: idx + 1
      });
    }
  });
  
  return refs;
}
```

### 2. Reference Repo Loading

**위치**: `packages/ant-cli/src/core/codebase/ReferenceLoader.ts` (NEW)

```typescript
import { WorkspaceResolver } from '@infrastructure/workspace/WorkspaceResolver';
import { GitPort } from '@core/ports/git';
import { FileLoader } from './loaders/FileLoader';

export interface ReferenceContext {
  project: string;
  branch: string;
  files: Array<{ path: string; content: string }>;
  stats: {
    filesLoaded: number;
    estimatedTokens: number;
  };
}

export class ReferenceLoader {
  constructor(
    private workspaceResolver: WorkspaceResolver,
    private gitPort: GitPort
  ) {}

  /**
   * Load reference repository code
   * 
   * 1. Resolve project path
   * 2. Check if branch exists
   * 3. Load key files (limited scope)
   */
  async loadReference(
    refDirective: RefDirective,
    userContext: any,
    options: {
      maxFiles?: number;
      maxTokens?: number;
      filePatterns?: string[];  // e.g. ['src/controllers/**', 'src/routes/**']
    } = {}
  ): Promise<ReferenceContext> {
    
    const maxFiles = options.maxFiles || 10;  // ✅ Limited scope
    const maxTokens = options.maxTokens || 30000;  // ~20KB
    
    // 1. Resolve project path
    const projectPath = this.workspaceResolver.getProjectPath(
      userContext,
      refDirective.project
    );
    
    if (!await this.gitPort.fileExists(projectPath)) {
      throw new Error(
        `Reference project not found: ${refDirective.project}\n` +
        `Path: ${projectPath}`
      );
    }
    
    // 2. Check branch existence
    let targetBranch = refDirective.branch || 'main';
    const branches = await this.gitPort.getBranches(projectPath);
    
    if (refDirective.branch && !branches.includes(refDirective.branch)) {
      console.warn(`   ⚠️  Branch '${refDirective.branch}' not found in ${refDirective.project}`);
      console.warn(`   ↪️  Falling back to default branch`);
      
      // Try main/master
      if (branches.includes('main')) {
        targetBranch = 'main';
      } else if (branches.includes('master')) {
        targetBranch = 'master';
      } else {
        targetBranch = branches[0];  // First available
      }
    }
    
    console.log(`   📂 Loading reference: ${refDirective.project} (${targetBranch})`);
    
    // 3. Checkout branch (temporarily)
    const currentBranch = await this.gitPort.getCurrentBranch(projectPath);
    const needsCheckout = currentBranch !== targetBranch;
    
    if (needsCheckout) {
      await this.gitPort.checkout(projectPath, targetBranch);
    }
    
    try {
      // 4. Load files (with patterns)
      const fileLoader = new FileLoader();
      
      // Smart file selection based on project type
      const patterns = options.filePatterns || this.getDefaultPatterns(projectPath);
      const files = await this.selectFiles(projectPath, patterns, maxFiles);
      
      const result = await fileLoader.load(
        files.map(f => ({ path: f, sources: [{ type: 'reference' }], priority: 'normal' as const, hasLocalChanges: false })),
        projectPath,
        this.gitPort,
        maxTokens
      );
      
      console.log(`   ✅ Loaded ${result.stats.filesLoaded} files from ${refDirective.project} (~${result.stats.estimatedTokens} tokens)`);
      
      return {
        project: refDirective.project,
        branch: targetBranch,
        files: result.files as any,
        stats: result.stats
      };
      
    } finally {
      // 5. Restore original branch
      if (needsCheckout) {
        await this.gitPort.checkout(projectPath, currentBranch);
      }
    }
  }
  
  /**
   * Select relevant files based on patterns
   */
  private async selectFiles(
    projectPath: string,
    patterns: string[],
    maxFiles: number
  ): Promise<string[]> {
    const glob = await import('glob');
    const allFiles: string[] = [];
    
    for (const pattern of patterns) {
      const matches = await glob.glob(pattern, {
        cwd: projectPath,
        ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**']
      });
      allFiles.push(...matches);
    }
    
    // Dedupe and limit
    const uniqueFiles = [...new Set(allFiles)];
    return uniqueFiles.slice(0, maxFiles);
  }
  
  /**
   * Get default file patterns based on project type
   */
  private getDefaultPatterns(projectPath: string): string[] {
    // Check package.json to determine backend/frontend
    const fs = require('fs');
    const pkgPath = path.join(projectPath, 'package.json');
    
    if (!fs.existsSync(pkgPath)) {
      return ['src/**/*.{ts,tsx,js,jsx}'];  // Generic
    }
    
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    // Backend patterns
    if (deps['@nestjs/core'] || deps['express'] || deps['koa']) {
      return [
        'src/**/controllers/**/*.ts',
        'src/**/routes/**/*.ts',
        'src/**/services/**/*.ts',
        'src/**/dto/**/*.ts',
        'src/**/types/**/*.ts'
      ];
    }
    
    // Frontend patterns
    if (deps['react'] || deps['vue'] || deps['@angular/core']) {
      return [
        'src/services/**/*.{ts,tsx}',
        'src/api/**/*.{ts,tsx}',
        'src/types/**/*.ts',
        'src/hooks/**/*.{ts,tsx}'
      ];
    }
    
    return ['src/**/*.{ts,tsx,js,jsx}'];
  }
}
```

### 3. Integration in resolve.ts

**수정 위치**: `packages/ant-cli/src/agents/architect/graph/code/nodes/resolve.ts`

```typescript
export async function resolve(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // ... existing code ...
  
  // 2. Load directive
  let directive: string | undefined;
  
  if (state.overrideDirective) {
    directive = state.overrideDirective;
  } else {
    directive = await ArtifactService.getDirective(context, 'code', gitPort) || undefined;
  }
  
  // ✅ NEW: Parse reference directives
  const refDirectives = directive ? parseRefDirectives(directive) : [];
  const referenceContexts: ReferenceContext[] = [];
  
  if (refDirectives.length > 0) {
    console.log(`\n📚 Loading ${refDirectives.length} reference project(s)...`);
    
    const referenceLoader = new ReferenceLoader(
      state.deps?.workspaceResolver,
      state.deps?.git
    );
    
    for (const refDir of refDirectives) {
      try {
        const refContext = await referenceLoader.loadReference(
          refDir,
          userContext,
          {
            maxFiles: 10,
            maxTokens: 30000
          }
        );
        referenceContexts.push(refContext);
      } catch (error) {
        console.error(`   ❌ Failed to load reference ${refDir.project}:`, error);
        // Continue with other references
      }
    }
  }
  
  // ... existing codebase retrieval ...
  
  // ✅ Store reference contexts in state
  state.referenceContexts = referenceContexts;
  
  return {
    ...state,
    design,
    directive,
    code: codeContext.code,
    // ... existing fields ...
    referenceContexts  // ✅ NEW
  };
}
```

### 4. Prompt Template Update

**수정 위치**: `packages/ant-cli/src/core/prompt/templates/code/phases/execute/base.md`

기존:
```markdown
## CURRENT CODEBASE

{{currentCode}}
```

수정 후:
```markdown
## CURRENT CODEBASE

{{currentCode}}

{{#if referenceContexts}}
## REFERENCE CODEBASES

The following codebases are provided for reference only (e.g., to check API contracts, response formats, etc.).
DO NOT modify these files. Use them only to understand how to interact with external services.

{{#each referenceContexts}}
### Reference: {{project}} (branch: {{branch}})

{{#each files}}
FILE: {{path}} [REFERENCE - {{../project}}]
```{{content}}```

{{/each}}
{{/each}}
{{/if}}
```

### 5. State Type Update

**수정 위치**: `packages/ant-cli/src/agents/architect/graph/code/state.ts`

```typescript
export interface ArchitectGraphState {
  // ... existing fields ...
  
  // ✅ NEW: Reference contexts
  referenceContexts?: Array<{
    project: string;
    branch: string;
    files: Array<{ path: string; content: string }>;
    stats: {
      filesLoaded: number;
      estimatedTokens: number;
    };
  }>;
}
```

---

## 📊 Usage Example

### Directive 작성

```markdown
@ref ant-pong-be feature/skeleton

프론트엔드에서 `/rooms` API를 호출하는데 응답 형식이 맞지 않음.

에러:
```
SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

백엔드 API가 실제로 어떤 형식으로 응답하는지 확인하고,
프론트엔드 코드를 수정해야 함.
```

### LLM이 받는 Prompt

```markdown
## DIRECTIVE

@ref ant-pong-be feature/skeleton

프론트엔드에서 `/rooms` API를 호출하는데...

## CURRENT CODEBASE

FILE: src/routes/LobbyPage.tsx
```typescript
const data = await response.json();
setRooms(data);  // ← 문제 발생 지점
```

## REFERENCE CODEBASES

The following codebases are provided for reference only...

### Reference: ant-pong-be (branch: feature/skeleton)

FILE: src/rooms/rooms.controller.ts [REFERENCE - ant-pong-be]
```typescript
@Controller('rooms')
export class RoomsController {
  @Get()
  getRooms() {
    return { rooms };  // ← Backend는 { rooms: [] } 형식!
  }
}
```

## YOUR TASK

Fix the frontend code to match the backend response format.
```

---

## 🚀 Implementation Plan

### Phase 1: Core Infrastructure (High Priority)

1. **Create ReferenceLoader**
   - [ ] `packages/ant-cli/src/core/codebase/ReferenceLoader.ts`
   - [ ] parseRefDirectives() function
   - [ ] loadReference() method
   - [ ] getDefaultPatterns() method

2. **Update resolve.ts**
   - [ ] Import ReferenceLoader
   - [ ] Parse ref directives
   - [ ] Load reference contexts
   - [ ] Store in state

3. **Update State Type**
   - [ ] Add referenceContexts to ArchitectGraphState
   - [ ] Export ReferenceContext type

### Phase 2: Prompt Integration (High Priority)

4. **Update Prompt Templates**
   - [ ] Add REFERENCE CODEBASES section to execute/base.md
   - [ ] Add REFERENCE section to decompose/base.md (optional)
   - [ ] Test with Handlebars

5. **Update PromptComposer**
   - [ ] Pass referenceContexts to template
   - [ ] Handle empty referenceContexts gracefully

### Phase 3: Testing & Refinement (Medium Priority)

6. **Error Handling**
   - [ ] Reference project not found
   - [ ] Branch not found
   - [ ] Git checkout failures
   - [ ] Token limit exceeded

7. **Documentation**
   - [ ] Update README with @ref syntax
   - [ ] Add examples
   - [ ] Document limitations

### Phase 4: Enhancements (Low Priority)

8. **Smart File Selection**
   - [ ] Detect project type (backend/frontend)
   - [ ] Use relevant patterns
   - [ ] Filter by directive context

9. **Caching**
   - [ ] Cache loaded references
   - [ ] Invalidate on branch change

---

## ⚠️ Limitations

### 1. **Scope Intentionally Limited**

- **NOT** a full cross-project implementation
- Only loads reference code for **read-only** context
- LLM **cannot modify** reference files
- Max 10 files, ~20KB per reference

### 2. **Git State Management**

- Temporarily checks out branch
- Restores original branch after loading
- Could interfere with concurrent operations

### 3. **Performance**

- Each reference adds ~3-5 seconds (git checkout + file loading)
- Multiple references multiply the cost
- Consider caching for repeated uses

---

## 🎓 Design Principles

### 1. **Read-Only References**

```
Current Project: Full R/W access
Reference Projects: Read-only context
```

### 2. **Explicit Over Implicit**

```
❌ Auto-detect related projects
✅ User explicitly specifies @ref
```

### 3. **Fail-Safe**

```
Reference loading failure → Warning, not Error
Continue with available context
```

### 4. **Token Conscious**

```
Current Project: 100K tokens (primary)
Each Reference: 30K tokens (limited)
Total: Capped at reasonable limit
```

---

## 🔍 Alternative Considered

### Option 1: Cross-Project Context (Rejected)

**Pros:**
- Full integration
- Automatic detection

**Cons:**
- **Too complex** (scope creep)
- Hard to determine which projects are related
- Performance impact
- Token budget explosion

**Decision:** Use explicit @ref instead

### Option 2: Shared Types Package (Complementary)

**Pros:**
- Better long-term solution
- Type safety

**Cons:**
- Requires project restructuring
- Not immediately available

**Decision:** Implement @ref as interim solution

---

## ✅ Success Criteria

1. **Directive에서 `@ref ant-pong-be`로 참조 가능**
2. **Referenced 코드가 prompt에 포함됨 (명확히 구분)**
3. **LLM이 reference 코드를 보고 현재 코드 수정**
4. **Reference 로딩 실패 시 graceful degradation**
5. **Token budget 초과 시 적절히 제한**

---

**This design provides a pragmatic solution for cross-project code reference without the complexity of full cross-project integration.**

