# Design Job 리팩토링 완료

## 🎯 목표
AI 평가 기반으로 System Design 문서가 **구조적 설계**에 집중하고, **구현 디테일**을 배제하도록 프롬프트 템플릿 개선

## 📊 변경 파일 (5개)
```
design/base/injections/backend-guide.md        (9줄 수정)
design/base/injections/frontend-guide.md       (20줄 수정)
design/phases/decompose/base.md                (22줄 추가)
design/phases/execute/base.md                  (94줄 추가)
design/phases/execute/rules.md                 (24줄 추가)
```

## 🔑 핵심 개선사항

### 1. execute/rules.md - 작성 수준 테스트 추가
```markdown
### Test Your Writing:
**Question: "Could a developer implement this 10 different ways?"**
- YES → Good architectural level
- NO → Too detailed (remove implementation)
```

### 2. execute/base.md - WHAT vs HOW 명확한 구분
**추가된 섹션**: 🚨 DESIGN LEVEL: WHAT vs HOW

**Before/After 예시**:
```markdown
❌ Ball velocity reflects using: v' = v - 2(v·n)n
✅ PhysicsEngine: Handles collision detection via abstract interface

❌ Store high score in localStorage key 'pinball_high_score'
✅ ScoreService: Persists high scores via storage abstraction layer
```

### 3. decompose/base.md - 태스크 작성 기준 강화
구조적 의사결정 중심 질문 추가:
- ✅ "Why this pattern?" (설계 근거)
- ✅ "What owns what?" (책임 경계)  
- ✅ "How do they talk?" (인터페이스)
- ❌ "How to implement?" (알고리즘)

### 4. injection 가이드 간소화
**원칙**: 구체적 금지 예시 나열 → 원칙 중심 간결화

**Before**:
```markdown
❌ Detailed password hashing parameters (salt rounds, iterations)
❌ JWT algorithm specifics (HS256 vs RS256 config, secret rotation)
❌ Rate limiting implementation (token bucket details, Redis commands)
```

**After**:
```markdown
**WRITE AT THIS LEVEL** - Method responsibilities, not algorithms
**DON'T WRITE** - Hash rounds, JWT config, retry algorithms
```

### 5. 통합 디자인 가이드 재구성
각 섹션에서 쓸 내용 명확화:
- **WHY**: Design rationale, tradeoffs considered
- **WHAT**: Component responsibilities, boundaries
- **HOW THEY INTERACT**: Interfaces, data flow, call sequences

## 🎬 적용 예시

### Before (ant-pong-fe 기존 산출물)
```markdown
### 4.2 충돌 감지 전략
- **Ball-Circle**: 거리 기반 검사 (bumpers, ball 간)
- **Ball-Line**: 점-선분 거리 계산 (walls, slingshots)
- 충돌 시 법선 벡터 기반 속도 반사 (reflect: `v' = v - 2(v·n)n`)

### 4.3 물리 파라미터
- **중력**: `vy += gravity * deltaTime` (하방향 가속)
- **반발 계수**: 충돌 시 속도 유지율 (bumper: 1.2, wall: 0.8)
- **플리퍼 각속도**: 활성화 시 0° → 45° 회전 (0.1초 duration)
```

### After (기대 산출물)
```markdown
### 4.2 Physics Architecture
- PhysicsEngine: Abstract interface for collision detection and velocity updates
- LocalPhysicsEngine: Client-side implementation for single-player
- Supports future NetworkPhysicsEngine for authoritative server physics

### 4.3 Collision Strategy
- Collision detection delegated to PhysicsEngine implementation
- Collision response applies velocity changes based on surface normals
- Configurable physics parameters defined in constants module
```

## ✅ 검증 체크리스트

### 템플릿 구조 유지
- [x] 기존 Handlebars 변수명 유지 (`{{spec}}`, `{{designDoc}}`, `{{currentTask}}`)
- [x] base.md (WHAT), rules.md (HOW) 역할 분리 준수
- [x] injection 파일 구조 유지
- [x] XML 출력 형식 변경 없음

### 핵심 원칙 반영
- [x] "10가지 구현 가능" 테스트 질문 추가
- [x] 구체적 금지 예시 제거 (오히려 아이디어 제공 방지)
- [x] 각 가이드에 "WRITE AT THIS LEVEL" 명시
- [x] WHAT/WHY/HOW THEY INTERACT 프레임워크 명확화

### 기존 기능 보존
- [x] CONTRACT-FIRST 3-phase 전략 유지
- [x] Line budget 계산 로직 유지
- [x] Document type 분리 (unified vs contract-first) 유지
- [x] FORBIDDEN sections 유지

## 🚀 다음 단계

1. **테스트 실행**: ant-pong-fe 프로젝트로 design job 재실행
2. **산출물 비교**: 물리 수식, 파라미터, 라이브러리 구문 제거 확인
3. **품질 검증**: "10가지 구현 가능" 테스트 적용
4. **필요시 추가 조정**: LLM이 여전히 과도한 디테일 작성하면 더 강화

## 📝 변경사항 요약

**핵심 메시지**: System Design은 **구조적 의사결정**이지, **구현 매뉴얼**이 아니다.

**Golden Rule**: 
- 구조에 대한 결정 → 문서화 ✅
- 1:1 구현 디테일 → 제거 ❌

**Test Question**: "Could a developer implement this 10 different ways?"

---

## 🎮 게임 특화 규칙 추가 (2차 개선)

### 추가된 파일

#### 1. design/base/system.md (122~149줄)
**위치**: UNIVERSAL WRITING RULES 직후
**내용**: 
- 🕹️ DOMAIN-SPECIFIC RULES: Game Projects
- 게임 엔진/물리/렌더링에 대한 블랙박스 원칙
- ✅ 쓸 것: 인터페이스, 데이터 플로우, 전략 선택
- ❌ 쓰지 말 것: 수식, 파라미터, 알고리즘, 렌더링 명령
- **Golden Rule**: "숫자/수식/알고리즘 → 제거"

#### 2. design/base/injections/frontend-guide.md (46~73줄)
**위치**: Component Architecture 섹션 직후 (Section 2.1)
**내용**:
- ⚠️ Game-Specific Frontend Constraint
- 게임 프론트엔드에서 물리/렌더링 수식 금지
- 엔진을 백엔드 API처럼 추상화
- 올바른 인터페이스 예시 제공

### 추가 이유

1. **ant-pong-fe 실제 문제 해결**
   ```markdown
   ❌ Before: 충돌 시 법선 벡터 기반 속도 반사 (v' = v - 2(v·n)n)
   ✅ After: PhysicsEngine: Handles collision via abstract interface
   ```

2. **이중 방어 체계**
   - system.md: 모든 design job에 적용 (범용)
   - frontend-guide.md: CONTRACT-FIRST 모드의 프론트엔드 문서 작성 시 적용 (특화)

3. **명확한 예시와 Golden Rule**
   - 구체적 FORBIDDEN 항목 (수식, 각도, CSS 명령)
   - IGameEngine 인터페이스 정의 예시
   - "엔진을 백엔드 서비스처럼 취급" 비유

### 최종 변경 통계

```
총 7개 파일 수정:
- design/base/system.md:            +28줄 (게임 규칙)
- design/base/injections/frontend:  +28줄 (게임 규칙)
- design/base/injections/backend:   -6줄
- design/phases/decompose/base:     +22줄
- design/phases/execute/base:       +94줄
- design/phases/execute/rules:      +24줄

순증: +190줄
```

### 적용 범위

| 파일 | 적용 시점 | 대상 프로젝트 |
|------|----------|--------------|
| system.md | 모든 design job | 전체 (게임/비게임) |
| frontend-guide.md | CONTRACT-FIRST 모드 | 게임 + 백엔드 조합 |

### 기대 효과

**시나리오 1: Unified Mode (ant-pong-fe와 같은 경우)**
- system.md 규칙만 적용 ✅
- 게임 물리/렌더링 수식 제거됨

**시나리오 2: CONTRACT-FIRST Mode (멀티플레이어 게임)**
- system.md (범용) + frontend-guide.md (특화) 모두 적용 ✅
- 이중 방어로 더 강력한 제약

### 검증 방법

1. **ant-pong-fe 재실행**: unified mode로 system.md 규칙 테스트
2. **멀티플레이어 게임 프로젝트**: CONTRACT-FIRST mode로 frontend-guide.md 규칙 테스트
3. **산출물 체크**:
   - 물리 수식 없음 ✅
   - 구체적 파라미터 없음 ✅
   - 엔진 인터페이스만 정의됨 ✅

---

## 최종 정리

### 핵심 메시지
**System Design ≠ Implementation Manual**
- 구조적 의사결정 ✅
- 1:1 구현 디테일 ❌

### 작성 수준 테스트
**"Could a developer implement this 10 different ways?"**
- YES → Good (architectural)
- NO → Too detailed (remove)

### Golden Rules
1. **범용**: 숫자/수식/알고리즘 → 제거
2. **게임**: 엔진은 블랙박스, 인터페이스만 정의
3. **프론트엔드 게임**: 엔진을 백엔드 API처럼 추상화

