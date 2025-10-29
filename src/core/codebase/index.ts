/**
 * Codebase Module
 * 
 * Phase 1: CodebaseRetriever (Vector-based smart retrieval)
 *   - 대부분의 작업 (90%+)
 *   - 자동 전략 선택 (Git/Vector/Keyword)
 *   - 토큰 효율적
 * 
 * Phase 2: CodebaseBatchRetriever (Batch processing for large refactoring)
 *   - 대규모 전역 리팩토링 (100+ 파일)
 *   - 점진적 배치 처리
 *   - AST 분석 통합 (향후)
 */

export {
  CodebaseRetriever,
  RetrieveOptions,
  CodeContext,
  BatchRetrieveOptions,
  BatchResult
} from "./CodebaseRetriever";

export {
  WorkSizeEstimator,
  WorkSizeEstimation
} from "./WorkSizeEstimator";
