# Anthropic Prompt Caching 적용 완료

## ✅ 완료된 작업

### 1. 핵심 인프라 구축
- `CacheableContent` 타입 추가 (`core/ports/llm.ts`)
- `AnthropicLLMClient`에 cache_control 지원 구현
- `invokeWithUsage`, `stream`, `invokeStructured` 모두 캐싱 지원

### 2. 주요 노드 캐싱 적용

#### ✅ CodeGen 노드 (code job의 핵심)
- **위치**: `packages/ant-cli/src/agents/architect/graph/code/nodes/codeGen/promptBuilder.ts`
- **캐싱 전략**:
  - Block 1 (CACHED): System prompt + Rules + Profiles + Examples
  - Block 2 (CACHED): Project context + Design docs + PRD
  - Block 3 (NOT CACHED): Current task + Runtime context
- **예상 절감**: 70-80% (반복 턴이 많은 노드)

#### ✅ DocGen 노드 (design job의 핵심)
- **위치**: `packages/ant-cli/src/agents/architect/graph/design/nodes/docGen.ts`
- **캐싱 전략**:
  - Block 1 (CACHED): System prompt + Rules + Profiles
  - Block 2 (CACHED): Requirements + API Contract
  - Block 3 (NOT CACHED): Task context + Current section
- **예상 절감**: 60-70%

### 3. 토큰 사용량 모니터링 강화
- **UI 툴팁 업데이트**: `packages/ant-ui/src/presentation/components/kanban/KanbanHeader.tsx`
- Cache Read / Cache Write 토큰 수 표시
- 90% savings 표시로 사용자에게 피드백

### 4. 하위 호환성
- ❌ 하위 호환 없음 (사용자 요청에 따라)
- 모든 메시지 타입이 `CacheableContent[]`로 변경됨
- 기존 string 타입도 자동으로 배열로 변환됨

## 🎯 캐싱이 적용되지 않은 노드들

### Decompose 노드
- **이유**: 프롬프트가 작고 (1회만 호출), 캐싱 효과 적음
- **호출 빈도**: Job당 1회
- **예상 토큰**: ~2,000

### DetectEnvironment 노드  
- **이유**: 프롬프트가 작고 (1회만 호출), 캐싱 효과 적음
- **호출 빈도**: Job당 1회
- **예상 토큰**: ~1,500

### Plan 노드 (Keyword + Plan 생성)
- **이유**: 짧은 프롬프트 2번 호출, 캐싱 이득 적음
- **호출 빈도**: Task당 1회씩 (2번)
- **예상 토큰**: Keyword ~800 + Plan ~2,000 = ~2,800/task

**결론**: 이 노드들은 반복 호출이 없어서 캐싱 효과가 거의 없습니다.

## 📊 예상 절감 효과

### Code Job (10 tasks, 평균 3턴 retry)
- **Before**:
  - Decompose: 2K (1회)
  - DetectEnv: 1.5K (1회)
  - Plan: 2.8K × 10 = 28K
  - CodeGen: 11K × 10 tasks × 3턴 = 330K
  - **Total**: 361.5K tokens
  - **Cost**: $1.08 (Anthropic Claude 3.5 Sonnet 기준)

- **After (캐싱 적용)**:
  - Decompose: 2K (1회, 캐싱 안 함)
  - DetectEnv: 1.5K (1회, 캐싱 안 함)
  - Plan: 28K (캐싱 안 함)
  - CodeGen:
    - 1턴: 11K (cache write $0.042)
    - 2-3턴: 각 300 + 10.7K cache read ($0.003/턴) × 2 = $0.006
    - 10 tasks: $0.042 × 10 = $0.42 + $0.06 = $0.48
  - **Total Cost**: $0.02 + $0.005 + $0.08 + $0.48 = **$0.585**
  - **절감**: 46%

### Design Job (3 documents, 평균 2턴)
- **Before**: ~50K tokens = $0.15
- **After**: ~$0.08 (47% 절감)

## 💰 실제 절감 효과

캐싱은 **반복 턴이 많을수록** 효과적입니다:
- **1턴만**: 캐싱 없음과 동일 (오히려 cache write 비용 추가)
- **2-3턴**: 40-50% 절감
- **5턴 이상**: 70-80% 절감

## 🚀 다음 단계

1. **Production 배포 후 모니터링**:
   - UI 툴팁에서 실제 cache read/write 토큰 확인
   - 콘솔 로그: `💰 [CACHE] read=X create=Y`

2. **추가 최적화 고려사항**:
   - Decompose/DetectEnv에도 캐싱 적용 검토 (효과 미미하지만)
   - Plan 노드의 prompt를 재구조화하여 캐싱 가능하게

3. **캐시 TTL 관리**:
   - Anthropic: 5분 TTL (짧은 대화 세션에 적합)
   - 긴 작업의 경우 중간에 캐시 만료 가능성 있음


