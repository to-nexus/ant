# Session Context vs Session History 통합 전략

**작성일**: 2025-11-27

---

## 🎯 문제점

### **1. 개념 중복**
```typescript
// ❌ 중복!
sessionHistory: string;     // 전체 대화 히스토리 (이미 존재)
sessionContext: {           // 이전 턴 정보 (새로 추가)
  previousDirective: string;
  previousMode: string;
  previousOutput: string;
}
```

### **2. 토큰 폭발**
```
Turn 1: 30K tokens
Turn 2: 30K + 8K (previous context) = 38K
Turn 3: 30K + 16K (2 previous) = 46K
Turn 4: 30K + 24K (3 previous) = 54K  ← 한계!
```

---

## ✅ 해결책: **Smart Compression + Selective Loading**

### **핵심 원칙**:
1. **Full History 저장** (Session Store에 모두 저장)
2. **Selective Loading** (LLM에는 압축된 컨텍스트만 전달)
3. **Sliding Window** (최근 N턴만 상세히, 나머지는 요약)

---

## 🔄 새로운 구조

### **Session Store (Full History - 저장용)**
```typescript
// packages/ant-cli/src/core/types/session.ts

interface SessionTurn {
  turnId: number;
  directive: string;
  mode: CodeMode;
  timestamp: string;
  input: {
    type: 'design' | 'directive';
    summary: string;      // ✅ 요약본 저장 (압축용)
  };
  output: {
    files: string[];
    summary: string;      // ✅ 요약본 저장 (압축용)
    fullContent?: string; // ✅ 전체 내용 (선택적)
  };
}

interface Session {
  sessionId: string;
  project: string;
  feature: string;
  turns: SessionTurn[];  // ✅ 모든 턴 저장 (무제한)
  createdAt: string;
  updatedAt: string;
}
```

### **Session Context (Compressed - LLM 전달용)**
```typescript
// packages/ant-cli/src/core/mode/types.ts

interface SessionContextForLLM {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Sliding Window: 최근 1-2턴만 상세히
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  recentTurns: Array<{
    turnId: number;
    directive: string;       // ✅ FULL (최근이므로)
    mode: CodeMode;
    output: string;          // ✅ FULL or SUMMARY (currentMode에 따라)
  }>;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Earlier Turns: 요약만
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  summary?: string;  // "Earlier: Created login API (Turn 1-3), Fixed auth bugs (Turn 4-5)"
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Mode-Aware Metadata
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  currentMode: CodeMode;     // ✅ 현재 모드 (window size 결정)
  windowSize: number;        // ✅ 적용된 window size (1 or 2)
  compressionRatio: number;  // ✅ 압축률 (디버깅용)
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Stats
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  totalTurns: number;
  currentTurn: number;
}
```

---

## 🎨 Compression Strategy

### **Sliding Window Approach**

```typescript
// packages/ant-cli/src/agents/architect/session/SessionContextBuilder.ts

class SessionContextBuilder {
  
  /**
   * Build compressed session context for LLM
   * 
   * Strategy:
   * - **Dynamic Window**: 현재 모드에 따라 필요한 이전 턴 수 결정
   * - **Selective Detail**: 관련성 높은 턴만 상세히, 나머지는 요약
   * - **Earlier Compression**: 오래된 턴들은 요약
   */
  async buildContextForLLM(
    session: Session,
    currentMode: CodeMode,
    currentDirective: string
  ): Promise<SessionContextForLLM> {
    
    const turns = session.turns;
    const currentTurn = turns.length + 1;
    
    // No history
    if (turns.length === 0) {
      return {
        recentTurns: [],
        totalTurns: 0,
        currentTurn: 1,
        currentMode,
        windowSize: 0,
        compressionRatio: 0
      };
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 1: Determine window size (mode-aware)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const windowSize = this.getWindowSize(currentMode, turns);
    console.log(`🪟 [Session] Window size: ${windowSize} (mode: ${currentMode})`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 2: Select relevant recent turns (DETAILED)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const candidateTurns = turns.slice(-Math.min(windowSize, turns.length));
    const recentTurns = this.selectRelevantTurns(
      candidateTurns,
      currentMode,
      currentDirective
    );
    
    console.log(`📋 [Session] Selected ${recentTurns.length} relevant turns from last ${windowSize}`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 3: Summarize earlier turns (COMPRESSED)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let summary: string | undefined;
    const earlierTurnsCount = turns.length - windowSize;
    if (earlierTurnsCount > 0) {
      const earlierTurns = turns.slice(0, -windowSize);
      summary = this.compressTurns(earlierTurns);
      console.log(`📦 [Session] Compressed ${earlierTurnsCount} earlier turns`);
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 4: Calculate compression ratio
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const originalSize = turns.length;
    const compressedSize = recentTurns.length + (summary ? 0.1 : 0); // 요약 = 0.1턴
    const compressionRatio = compressedSize / originalSize;
    
    return {
      recentTurns,
      summary,
      totalTurns: turns.length,
      currentTurn,
      currentMode,
      windowSize,
      compressionRatio
    };
  }
  
  /**
   * ✅ Dynamic window size based on CURRENT mode
   * 
   * Key Insight:
   * - Window size는 "지금 무엇을 하려는가"에 따라 결정
   * - NOT "이전에 무엇을 했는가"
   */
  private getWindowSize(currentMode: CodeMode, turns: SessionTurn[]): number {
    switch (currentMode) {
      case 'refactor':
        // Refactor: 이전 코드 맥락 필요
        // - 마지막 1턴: 수정할 코드
        // - 마지막 2턴: 그 코드가 왜 생성되었는지
        return Math.min(2, turns.length);
      
      case 'generate':
        // Generate: 기존 패턴 참고용으로만
        // - 마지막 1턴: 유사한 작업이었는지 확인
        return Math.min(1, turns.length);
      
      case 'explain':
        // Explain: 최소 컨텍스트
        // - 마지막 1턴: 설명할 코드가 방금 생성되었는지
        return Math.min(1, turns.length);
      
      default:
        return 1;
    }
  }
  
  /**
   * ✅ Select relevant turns from candidates
   * 
   * Not all recent turns are equally relevant!
   * Filter by:
   * 1. Same files
   * 2. Related keywords
   * 3. Mode compatibility
   */
  private selectRelevantTurns(
    candidateTurns: SessionTurn[],
    currentMode: CodeMode,
    currentDirective: string
  ): Array<{
    turnId: number;
    directive: string;
    mode: CodeMode;
    output: string;
  }> {
    
    return candidateTurns
      .filter(turn => {
        // ✅ Refactor mode: 이전 generate/refactor 턴이 관련성 높음
        if (currentMode === 'refactor') {
          return turn.mode === 'generate' || turn.mode === 'refactor';
        }
        
        // ✅ Generate mode: 이전 generate 턴만 (패턴 참고)
        if (currentMode === 'generate') {
          return turn.mode === 'generate';
        }
        
        // ✅ Explain mode: 모든 모드 (설명 대상 찾기)
        return true;
      })
      .map(turn => ({
        turnId: turn.turnId,
        directive: turn.directive,
        mode: turn.mode,
        output: this.selectiveOutput(turn, currentMode)
      }));
  }
  
  /**
   * Selective output based on mode
   */
  private selectiveOutput(turn: SessionTurn, currentMode: CodeMode): string {
    // ✅ Refactor mode: need previous output
    if (currentMode === 'refactor') {
      return turn.output.summary || turn.output.files.join(', ');
    }
    
    // ✅ Generate mode: just file list
    if (currentMode === 'generate') {
      return `Created: ${turn.output.files.slice(0, 3).join(', ')}${turn.output.files.length > 3 ? '...' : ''}`;
    }
    
    // ✅ Explain mode: not needed
    return '';
  }
  
  /**
   * Compress earlier turns into summary
   */
  private compressTurns(turns: SessionTurn[]): string {
    // Group by similar actions
    const groups = this.groupTurnsByAction(turns);
    
    return groups.map(group => {
      const turnRange = group.length > 1 
        ? `Turn ${group[0].turnId}-${group[group.length - 1].turnId}`
        : `Turn ${group[0].turnId}`;
      
      return `${turnRange}: ${group[0].input.summary}`;
    }).join('; ');
  }
  
  /**
   * Group consecutive turns by similar actions
   */
  private groupTurnsByAction(turns: SessionTurn[]): SessionTurn[][] {
    const groups: SessionTurn[][] = [];
    let currentGroup: SessionTurn[] = [];
    
    for (const turn of turns) {
      if (currentGroup.length === 0) {
        currentGroup.push(turn);
      } else {
        const lastTurn = currentGroup[currentGroup.length - 1];
        
        // Same mode = same group
        if (lastTurn.mode === turn.mode) {
          currentGroup.push(turn);
        } else {
          groups.push(currentGroup);
          currentGroup = [turn];
        }
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }
}
```

---

## 📊 토큰 절약 효과

### **Before (No Compression)**
```
Turn 1:  30K
Turn 2:  30K + 8K (prev) = 38K
Turn 3:  30K + 16K (2 prev) = 46K
Turn 4:  30K + 24K (3 prev) = 54K
Turn 5:  30K + 32K (4 prev) = 62K  ← 폭발!
Turn 10: 30K + 72K (9 prev) = 102K ← 불가능!
```

### **After (Sliding Window + Compression)**
```
Turn 1:  30K
Turn 2:  30K + 8K (1 prev detail) = 38K
Turn 3:  30K + 8K (1 prev detail) + 0.5K (1 prev summary) = 38.5K
Turn 4:  30K + 8K (1 prev detail) + 0.5K (2 prev summary) = 38.5K
Turn 5:  30K + 8K (1 prev detail) + 0.5K (3 prev summary) = 38.5K
Turn 10: 30K + 8K (1 prev detail) + 1K (8 prev summary) = 39K
Turn 20: 30K + 8K (1 prev detail) + 2K (18 prev summary) = 40K
```

**절약**: ~60K → ~10K (85% 절약!)

---

## 🔧 통합: sessionHistory 제거

### **기존 (중복)**
```typescript
// ❌ 제거
assembled.sessionHistory = "Turn 1: ...\nTurn 2: ...";  

// ❌ 제거
assembled.sessionContext = {
  previousDirective: "...",
  previousOutput: "..."
};
```

### **새로운 (통합)**
```typescript
// ✅ 하나로 통합
assembled.sessionContext = {
  recentTurns: [{
    turnId: 5,
    directive: "Fix the password validation",
    mode: 'refactor',
    output: "Updated LoginController.ts..."
  }],
  summary: "Turn 1-4: Created login API and fixed auth bugs",
  totalTurns: 5,
  currentTurn: 6
};
```

---

## 📝 프롬프트 템플릿 업데이트

### **Refactor Mode (Session-Aware)**

```markdown
# Code Refactoring Task

You are IMPROVING existing code while preserving functionality.

## Current Task
{{directive}}

{{#if sessionContext}}
## Session Context

You are currently on Turn {{sessionContext.currentTurn}} of {{sessionContext.totalTurns}}.

### Recent Work
{{#each sessionContext.recentTurns}}
**Turn {{this.turnId}}** ({{this.mode}}):
- Request: {{this.directive}}
- Output: {{this.output}}
{{/each}}

{{#if sessionContext.summary}}
### Earlier Work
{{sessionContext.summary}}
{{/if}}

**Important**: Build upon your previous work. Maintain consistency with earlier decisions.
{{/if}}

## Current Code
{{currentCode}}

## Instructions
1. Address the current request: {{directive}}
2. Preserve existing functionality
3. Maintain consistency with previous turns
4. Document significant changes
```

---

## 🎯 구현 순서

1. ✅ `SessionContextBuilder` 구현
   - Sliding window logic
   - Compression algorithm
   - Mode-aware selection

2. ✅ `ContextAssembler` 업데이트
   - `sessionHistory` 제거
   - `sessionContext` 통합 (compressed)

3. ✅ `resolve` 노드 수정
   - `SessionContextBuilder.buildContextForLLM()` 호출
   - Compressed context 전달

4. ✅ 프롬프트 템플릿 업데이트
   - Refactor mode 템플릿
   - Generate mode 템플릿 (minimal context)
   - Explain mode 템플릿 (minimal context)

5. ⏳ 테스트
   - 긴 세션 (10+ turns) 테스트
   - 토큰 사용량 측정
   - 컨텍스트 품질 확인

---

## 💡 추가 최적화 아이디어

### **1. Adaptive Window Size**
```typescript
// 중요한 턴은 더 오래 유지
if (turn.mode === 'refactor' && turn.filesChanged > 5) {
  windowSize += 1;  // 큰 변경사항은 더 오래 기억
}
```

### **2. Semantic Compression (LLM 활용)**
```typescript
// 매 5턴마다 LLM으로 요약
if (turns.length % 5 === 0) {
  const summary = await llm.summarize(turns.slice(-5));
  session.compressedSummaries.push(summary);
}
```

### **3. File-based Context**
```typescript
// 같은 파일 수정 시 해당 파일의 히스토리만 로드
if (currentFile === previousFile) {
  context = getFileHistory(currentFile);  // 관련 히스토리만
}
```

---

## 📊 최종 비교

| 항목 | Before | After | 개선 |
|------|--------|-------|------|
| **Turn 5 토큰** | 62K | 38.5K | ✅ 38% 절약 |
| **Turn 10 토큰** | 102K | 39K | ✅ 62% 절약 |
| **Turn 20 토큰** | 불가능 | 40K | ✅ 가능! |
| **개념 중복** | 있음 | 없음 | ✅ 정리됨 |
| **컨텍스트 품질** | 저하 | 유지 | ✅ 최근것 상세 |

---

## 🎉 결론

1. ✅ **sessionHistory 제거** → sessionContext로 통합
2. ✅ **Sliding Window** → 최근 1-2턴만 상세히
3. ✅ **Smart Compression** → 이전 턴은 요약
4. ✅ **Mode-Aware** → 모드별 최적화
5. ✅ **토큰 절약** → 85% 절약, 무한 턴 가능!

