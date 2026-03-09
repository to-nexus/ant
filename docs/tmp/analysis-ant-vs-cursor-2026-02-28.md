# Ant vs Cursor IDE: 동일 디자인 문서 기반 프로젝트 생성 시뮬레이션

> 분석일: 2026-02-28
> 대상 프로젝트: VybX Prediction Market Frontend
> 워크스페이스: `ant-workspaces/to.nexus/probe/prediction-fe`
> 상태: **Ant 코드잡 완료 (1회 중단 없이 완주)**

---

## 1. 입력 문서 규모 정리

현재 제공된 5개 문서의 총량:

- `fe-system-main.md`: 478줄 — 4-boundary 아키텍처, 20개 섹션, 6페이지 + 6모달
- `api-contract-main.md`: 221줄 — 15개 엔드포인트, 6개 DTO, WebSocket 프로토콜
- `ui-spec.json`: 1,470줄 — 6페이지 + 3모달의 전체 컴포넌트 스펙
- `ui-tokens.json`: 242줄 — 49색상, 20타이포그래피, 20+스페이싱 토큰
- `ui-assets.json`: 163줄 — 8커스텀 아이콘, 3이미지, lucide 아이콘 라이브러리

**총 도메인 복잡도**: 6 SSR/CSR 페이지, EIP-712 서명, WebSocket 실시간, 지갑 연동, 다중 마켓 타입(YesNo/UpDown/Multi), Optimistic Update, Mock/Real 이중 모드

---

## 2. Ant 에이전트의 실제 결과 (완료)

### 실행 요약

- **총 실행 시간**: 66분 43초 (16:19:10 ~ 17:25:53 UTC)
- **태스크 총 수**: 15개 (전체 완료)
- **자동 재시도**: 2회 (Portfolio Page 1회, Market Detail Layout 1회 — self-healing으로 자동 복구)
- **사용자 개입**: 0회
- **최종 상태**: `job_complete`

### 태스크별 실행 기록

| # | 태스크 | 소요 시간 | 재시도 | 비고 |
|---|--------|----------|--------|------|
| 1 | Next.js Project Setup | 3분 46초 | 0 | 순차 |
| 2 | Domain Boundary — Types, Rules & Validation | 5분 30초 | 0 | 순차 |
| 3 | Infrastructure Boundary — Adapters & Mock/Real | 6분 4초 | 0 | 순차 |
| 4 | App Shell, Layout & Wallet Auth Flow | 8분 9초 | 0 | 순차→병렬 전환점 |
| 5 | Events Feed Page | 4분 36초 | 0 | 병렬 |
| 6 | Market Detail — Layout, Chart, Orderbook & Tabs | 17분 26초 | 1 | 병렬, 가장 복잡 |
| 7 | Portfolio Page | 13분 44초 | 1 | 병렬 |
| 8 | Leaderboard Page | 3분 57초 | 0 | 병렬 |
| 9 | User Detail Page | 6분 13초 | 0 | 병렬 |
| 10 | Referral Page | 4분 40초 | 0 | 병렬 |
| 11 | Trading Panel & Order Flow | 8분 8초 | 0 | 병렬 |
| 12 | Real-Time Integration & Up/Down Rounds | 8분 25초 | 0 | 병렬 |
| 13 | Test Generation | 4분 55초 | 0 | 병렬 |
| 14 | Project Documentation | 2분 13초 | 0 | 병렬 |
| 15 | Final Verification | 2분 10초 | 0 | 순차 |

### 생성된 코드 통계

| 항목 | 수치 |
|------|------|
| TypeScript/TSX 소스 파일 | **165개** |
| App Router 페이지 | **9개 라우트** |
| 소스 코드 (src/) | **14,533줄** |
| 전체 코드 파일 (config, css 포함) | **23,363줄** |
| 테스트 파일 | **16개** |
| 생성 문서 | README.md |

### Boundary별 파일 분포

```
src/
├── domain/                        47개 파일
│   ├── types/                     15개 (event, market, order, orderbook, portfolio, referral, user, updown, match, enums 등)
│   ├── rules/                     17개 (fee, pnl, equity, shares, orderbook-filter, trading, updown-probability + 테스트)
│   ├── formatting/                 6개 (number, datetime, wallet, pnl-color + 테스트)
│   ├── validation/                 4개 (order-validation, eip712-validation + 테스트)
│   └── ports/                      5개 (api, auth, wallet, realtime + index)
│
├── application/                   17개 파일
│   ├── stores/                    15개 (auth, events, market-detail, portfolio, leaderboard,
│   │                                    user-detail, trading, referral, toast + 테스트 4개)
│   └── providers/                  1개 (AdapterProvider)
│
├── infrastructure/                21개 파일
│   ├── adapters/                   9개 (api, auth, wallet, realtime, persistence × mock/real)
│   ├── fixtures/                   8개 (events, markets, orderbook, portfolio, leaderboard,
│   │                                    user-detail, referrals + index)
│   ├── errors/                     4개 (app-error, classify-error + 테스트)
│   └── http/                       1개 (http-client)
│
└── presentation/                  76개 파일
    └── components/
        ├── market/                24개 (MarketDetailLayout, TradingPanel, TradingControls,
        │                               OrderInputs, OrderSummary, Orderbook, MarketChart,
        │                               MarketHeader, MarketStats, MarketTabs, SplitModal,
        │                               MergeModal, RoundSelector, CountdownTimer,
        │                               AssetPriceDisplay, StalenessIndicator, UpDownRoundPanel,
        │                               PositionsTable, OrdersTable, HistoryTable,
        │                               hooks/useOrderbookFeed, useAssetPriceFeed, useUpDownRound)
        ├── referral/              11개 (ReferralPageClient, ReferralCodeCard, ClaimableRewardsCard,
        │                               ReferralStatusCard, ReferralTabs, ReferralTable,
        │                               RewardsTable, ClaimTable, CreateCodeModal, ClaimRewardsModal)
        ├── portfolio/             11개 (PortfolioPageClient, SummaryCards, Tabs, PositionsTable,
        │                               OpenOrdersTable, HistoryTable, PointsTable, Pagination,
        │                               SharePnlModal, SideBadge)
        ├── events/                11개 (EventsPageClient, FilterBar, MarketGrid, MarketCardBasic,
        │                               MarketCardYesNo, MarketCardUpDown, MarketCardSkeleton,
        │                               EventThumbnail, EmptyState, format-utils)
        ├── user/                   8개 (UserDetailPageClient, UserProfileHeader, UserDetailTabs,
        │                               ReadOnly × 4 tables)
        ├── leaderboard/            5개 (LeaderboardPageClient, Filters, Podium, Table)
        ├── layout/                 3개 (Header, Footer)
        ├── wallet/                 1개 (WalletConnectModal)
        ├── auth/                   1개 (ProtectedRoute)
        └── feedback/               1개 (ToastContainer)
```

### 구현 완료된 기능 목록

**전체 페이지 (6/6)**:
- Events Feed — SSR, 3종 카드(Basic/YesNo/UpDown), 카테고리 필터, 반응형 그리드
- Market Detail — 3 variant(multi/single-yesno/updown), 차트, 오더북, 트레이딩 패널
- Portfolio — 6개 서머리 카드, 4탭(Positions/Orders/History/Points), 페이지네이션
- Leaderboard — 포디움(Top 3), 랭킹 테이블, 타입/기간 필터
- User Detail — 프로필 헤더, 통계 행, 4탭(읽기 전용)
- Referral — 코드 관리, 보상 클레임, 3탭(Referral/Rewards/Claim)

**전체 모달 (6/6)**:
- WalletConnectModal (CROSSx + Privy 소셜 로그인)
- SplitModal (CROSSD → Up/Down 분할)
- MergeModal (Up/Down → CROSSD 병합)
- CreateCodeModal (레퍼럴 코드 생성)
- ClaimRewardsModal (보상 클레임)
- SharePnlModal (PnL 공유)

**핵심 기능**:
- Trading Panel 상태 머신 (Buy/Sell × Market/Limit × Yes/No/Up/Down)
- EIP-712 서명 플로우
- WebSocket 실시간 어댑터 (오더북 + 가격 피드)
- Up/Down 라운드 라이프사이클 (CountdownTimer, RoundSelector)
- Optimistic update + rollback 패턴
- Mock/Real 이중 모드 (환경 변수 전환)
- 에러 분류 시스템 (transient/domain/auth)
- Staleness indicator (실시간 연결 끊김 감지)

**테스트 (16개 파일)**:
- Domain rules: fee, pnl, equity, shares, orderbook-filter, referral-reward, trading, updown-probability
- Application stores: auth-store, market-detail-store, portfolio-store, referral-store, trading-store
- Infrastructure: classify-error
- Domain: number formatting, order-validation

---

## 3. Cursor IDE에서의 예상 결과 시뮬레이션

### 시나리오: "이 5개 문서를 주고 프로젝트를 끝까지 만들어라"

### 현실적 시뮬레이션 플로우

```
5개 디자인 문서 전달
  → 컨텍스트 윈도우 충돌
    → Phase 1: 프로젝트 셋업
      → Phase 2: 도메인 레이어
        → Phase 3: 페이지 1-2개
          → 컨텍스트 드리프트 시작
            → Phase 4: 수동 교정 필요
              → 사용자 피로 / 방향 상실
                → 포기 또는 대폭 축소
```

### 단계별 예상

**Round 1 (첫 메시지):**

- 문서 5개 총 2,574줄을 모두 컨텍스트에 올리는 것 자체가 도전
- 대략적인 프로젝트 구조와 셋업 코드 생성 가능
- Next.js 초기화, tailwind 설정, 기본 레이아웃 정도
- 예상 생성: 10-15개 파일

**Round 2-5 (핵심 레이어):**

- Domain 타입, 규칙, 포맷팅 함수들
- Infrastructure 어댑터 일부
- 한 번에 한 레이어씩 요청해야 함
- 예상 생성: 30-40개 파일
- 문제: 이전 라운드에서 만든 파일의 정확한 import path를 잊기 시작

**Round 6-10 (페이지 구현):**

- Events 페이지, Leaderboard 같은 비교적 단순한 페이지
- 매 라운드마다 "이전에 만든 XXX 파일을 참고해서" 같은 지시 필요
- 예상 생성: 20-30개 파일
- 문제: ui-spec.json의 각 페이지별 스펙이 200-300줄이므로, 한 번에 1-2페이지만 요청 가능

**Round 11+ (복잡한 기능):**

- Market Detail (3개 variant + 오더북 + 차트 + 트레이딩 패널)
- Trading Panel 상태 머신
- EIP-712 서명 플로우
- 여기서부터 심각한 **컨텍스트 드리프트** 발생:
  - 기존 타입 정의와 불일치
  - Import 경로 오류
  - 아키텍처 패턴 이탈 (예: Presentation에서 직접 API 호출)
  - ui-tokens 값 임의 하드코딩

### 예상 최종 결과물 비교표 (실측 vs 예상)

| 항목 | Ant (실측) | Cursor (예상) |
|------|-----------|--------------|
| 소스 파일 수 | **165개** | 50-80개 |
| 소스 코드 줄 수 | **14,533줄** | 5K-10K |
| 전체 코드 줄 수 | **23,363줄** | 8K-15K |
| 페이지 완성 | **6/6** | 3-4/6 |
| 모달 완성 | **6/6** | 1-2/6 |
| 테스트 파일 | **16개** | 0개 |
| 아키텍처 일관성 | **높음** (4-boundary 완전 준수) | 중-하 (후반부 이탈) |
| Mock/Real 이중 모드 | **완전 구현** (10개 어댑터 쌍) | 부분적 |
| 실시간 기능 | **완전 구현** (WebSocket + hooks) | 미구현 가능성 높음 |
| Trading Panel | **완전 구현** (상태 머신 + EIP-712) | 부분적 |
| Up/Down 라운드 | **완전 구현** (Countdown + Round selector) | 미구현 |
| 빌드 성공 | **높음** (self-healing 2회 자동 복구) | 수동 디버깅 필요 |
| 사용자 개입 횟수 | **0회** | 15-25회 |
| 총 소요 시간 | **67분 (자동)** | 4-8시간 (수동 포함) |

### Cursor의 핵심 병목

1. **컨텍스트 윈도우**: 5개 문서 합계 2,574줄 + 이전에 생성한 코드를 동시에 참조 불가
2. **상태 비지속성**: 매 대화 턴마다 프로젝트 전체 구조를 "재학습"해야 함
3. **태스크 오케스트레이션 부재**: 사용자가 직접 "다음에 뭘 할지" 결정해야 함
4. **자기 치유 없음**: 타입 에러, import 불일치 등을 사용자가 발견하고 교정 지시해야 함
5. **병렬 처리 불가**: 한 번에 하나의 태스크만 진행
6. **테스트 생성 여력 없음**: 기능 구현에만 전력을 쏟아도 시간 부족

---

## 4. Cursor에서 Ant 수준 결과를 위한 추가 입력

### 필수 입력

1. **태스크 분해 문서 (Task Breakdown)**
   - Ant의 decompose 단계가 자동으로 하는 것을 사람이 미리 해줘야 함
   - 실제 Ant가 생성한 15개 태스크 구조를 참고:
     ```
     Task 1:  setup-nextjs (priority 100, 순차)
     Task 2:  domain-layer (priority 200, 순차)
     Task 3:  infrastructure-layer (priority 200, 순차)
     Task 4:  app-shell-auth (priority 300, 순차→병렬 전환)
     Task 5:  events-page (priority 300, 병렬)
     Task 6:  market-detail-layout (priority 300, 병렬)
     Task 7:  portfolio-page (priority 300, 병렬)
     Task 8:  leaderboard-page (priority 300, 병렬)
     Task 9:  user-detail-page (priority 400, 병렬)
     Task 10: referral-page (priority 400, 병렬)
     Task 11: trading-panel-order-flow (priority 500, 병렬)
     Task 12: realtime-updown-rounds (priority 500, 병렬)
     Task 13: testgen (priority 700, 병렬)
     Task 14: doc (priority 800, 병렬)
     Task 15: verification (priority 1000, 순차)
     ```
   - 각 태스크별 생성할 파일 목록과 의존성 명시

2. **디렉토리 구조 명세**
   - 전체 파일 트리를 미리 확정 (위 Boundary별 파일 분포 참고)
   - 각 파일의 역할과 import 관계를 명시
   - 이것이 있어야 크로스-파일 일관성 유지 가능

3. **참조 코드 (Reference Project)**
   - Ant는 `referenceCodeContexts`로 유사 프로젝트 코드를 주입
   - Cursor에서는 사용자가 직접 "이런 패턴으로 만들어라"하고 예시 코드를 제공해야 함
   - 특히: Zustand 스토어 패턴, Adapter 팩토리 패턴, Next.js App Router SSR 패턴

4. **Mock 데이터 (Fixtures)**
   - 각 API 엔드포인트의 mock response JSON
   - 이것이 없으면 화면 렌더링 검증 자체가 불가

### 권장 입력 (효율 향상)

5. **PRD 원문** (`inputs/sources/prd.md`)
   - 현재 제공된 5개 문서는 PRD에서 파생된 것
   - PRD가 있으면 비즈니스 로직(수수료 계산, PnL 공식 등)을 더 정확히 구현 가능

6. **Figma 스크린샷/참조 이미지**
   - `inputs/references/`에 있는 events.png, leaderboard.png 등
   - 시각적 레퍼런스가 있어야 UI 구현 품질이 올라감

7. **Cursor Rules 파일**
   - 프로젝트별 `.cursorrules`에 아키텍처 규칙을 정의
   - "Presentation 레이어에서 직접 fetch 금지" 같은 규칙
   - 이것이 매 턴마다 아키텍처 이탈을 방지

### 작업 전략 (Cursor에서의 최적 접근)

```
[사전 준비]                    [실행 (순서대로)]
태스크 분해 문서 ─┐
디렉토리 구조    ─┼─→ 1. 프로젝트 셋업 → 2. 타입/도메인 → 3. 인프라 어댑터 → 4. 페이지별 구현 → 5. 통합/디버깅
.cursorrules   ─┘
```

- 한 대화에서 하나의 태스크만 진행
- 매 태스크 시작 시 관련 디자인 문서 섹션만 발췌하여 첨부
- 이전 태스크에서 생성된 핵심 파일(타입 정의, 포트 인터페이스)을 매번 참조로 첨부
- Composer 기능 활용하여 다수 파일 동시 편집

---

## 5. 결론

| 관점 | Ant (실측) | Cursor (예상) |
|------|-----------|--------------|
| 적합한 상황 | 0에서 전체 프로젝트 스캐폴딩 | 기존 프로젝트에서 기능 추가/수정 |
| 강점 | 문서 기반 일관된 대규모 코드 생성, 자동 태스크 관리, self-healing | 실시간 피드백, 정밀한 수정, IDE 통합 |
| 약점 | 세밀한 UI 조정, 런타임 디버깅 어려움 | 대규모 프로젝트 일괄 생성 시 일관성 저하 |
| 이 프로젝트(VybX) 최적 활용 | 초기 스캐폴딩 + 전체 구조 생성 (67분, 165파일) | Ant 결과물을 받아 수정/보완/디버깅 |

**실측 결과 기반 요약**: Ant는 5개 디자인 문서로부터 67분 만에 165개 파일(14,533줄), 6페이지 + 6모달 + 16테스트를 사용자 개입 0회로 완성했다. 동일 작업을 Cursor에서 수행하려면 15-25회의 수동 대화와 4-8시간이 필요하며, 결과물은 양과 일관성 모두 절반 이하로 예상된다.

**Ant가 전체를 생성하고, Cursor가 정밀 수정/디버깅/실제 SDK 연동을 담당하는 것이 최적 전략.**
