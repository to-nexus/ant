VybX Prediction Market PRD는 Hybrid CLOB 기반 플랫폼의 제품 기획 및 상세 기능, 수수료 계산 방식을 정의합니다.

**현재 버전:** v1.1

| 버전 | 날짜 | 변경 내용 |
|:----:|:----:|----------|
| 0.1 | 2026-02-06 | 초기 PRD 작성 |
| 0.2 | 2026-02-09 | Cross SDK 및 Next.js SSR 기술 스택 추가 |
| 0.3 | 2026-02-09 | 평가서 기반 개선: 비목표 섹션 추가, 비기능 요구사항 추가, 기술 스택 system-design 위임, [ASSUMPTION] 항목 명확화 |
| 1.0 | 2026-03-03 | 정책서 기반 전면 수정: 리더보드·레퍼럴·VIP 초기 미제공, 가격 범위 $0.001~$0.999 반영, 수수료 Taker/Maker 기준 변경, Limit Sell Shares 잠금 추가, Maker Rebate 자동 지급 (컨트랙트 설정), 종료 마켓 리딤 전용, 오라클·정산 참조 추가, 마켓 분류 4타입 변경 (single-once/single-series/multi-once/multi-series-binary) 및 타입 자동 전환, GeoBlock Modal 추가 (2단계 검증 — Buy/Sell/Split/Merge/Redeem 전체), Redeem 기능 정의 추가 |
| 1.1 | 2026-03-04 | 마켓 취소 환불 기준 변경 — 기납부 수수료 환불 제외 (Maker Rebate 즉시 지급 후 회수 불가 구조 반영), Privy 제거 — CROSSx/CROSSx Desktop 지원, Embedded Wallet 추후 연동 예정, SETTLING_PROPOSED / DISPUTE / DISPUTE_DVM 상태 제거, 상태 구조 단순화, 가격 표시 정책 용도별 분리 — 버튼 소수점 2자리/$0 $1 고정/$0.01 미만 ≤$0.01/$0.99 초과 $0.99≤, 오더북/계산 소수점 3자리 유지, 수수료 계수 k 이벤트 카테고리별 설정으로 변경 (Crypto/Politics/Sports/Macro/Culture), Portfolio 페이지 Rebate 탭 추가 (Event/Market/Date/Maker Volume/Rebate Rate/Rebate Amount) |

# Part 1: PRD (제품 요구사항 정의서)

## 목차

1. [제품 개요](#1-제품-개요)
2. [용어 정의](#2-용어-정의)
3. [유저 플로우](#3-유저-플로우)
4. [화면 기획](#4-화면-기획)
5. [기능 정의](#5-기능-정의)
6. [비기능 요구사항](#6-비기능-요구사항)
7. [정보 구조](#7-정보-구조)
8. [기술 스택](#8-기술-스택)
9. [부록](#9-부록)

---

## 공통 포맷 정책

본 문서에서 사용되는 데이터 표시 포맷을 정의합니다.

### 0.1 숫자/금액 포맷

| 항목 | 포맷 | 예시 |
|------|------|------|
| CROSSD 잔액 | 소수점 3자리, 천단위 콤마 | `1,234.567 CROSSD` |
| 가격 — 버튼 표시 (Yes/No/Up/Down) | 소수점 2자리, 달러 단위. 단, $0.00이면 `$0`, $0.01 미만이면 `≤ $0.01`, $0.99 초과이면 `$0.99 ≤`, $1.00이면 `$1` 고정 표기 | `$0.69`, `$0`, `≤ $0.01`, `$0.99 ≤`, `$1` |
| 가격 — 오더북 / 계산 | 소수점 3자리, 달러 단위 | `$0.685` |
| 퍼센트 | 소수점 2자리 + % 기호 | `65.55%` |
| 쉐어 수량 | 양의 정수 | `100` |
| PnL (양수) | + 접두사, 녹색, 천단위 콤마, 소수점 3자리 | `+1,125.500 CROSSD` |
| PnL (음수) | - 접두사, 빨간색, 천단위 콤마, 소수점 3자리 | `-1,050.250 CROSSD` |
| PnL % (양수) | + 접두사, 녹색, 천단위 콤마, 소수점 2자리 | `+1,012.55%` |
| PnL % (음수) | - 접두사, 빨간색, 천단위 콤마, 소수점 2자리 | `-1,008.33%` |
| 거래량 (Volume) | 축약 표기, 소수점 2자리 | `$1.25M`, `$450.00K` |

**거래량 단위:**
| 단위 | 범위 | 예시 |
|------|------|------|
| 없음 | 0 ~ 999 | `$500` |
| K (Thousand) | 1,000 ~ 999,999 | `$1.25K` ~ `$999.99K` |
| M (Million) | 1,000,000 ~ 999,999,999 | `$1.00M` ~ `$999.99M` |
| B (Billion) | 1,000,000,000 ~ 999,999,999,999 | `$1.00B` ~ `$999.99B` |
| T (Trillion) | 1,000,000,000,000 이상 | `$1.00T` ~ |

### 0.2 날짜/시간 포맷

| 항목 | 포맷 | 예시 |
|------|------|------|
| 종료일 (Closes) | MMM DD, YYYY | `Jan 15, 2026` |
| 남은 시간 (긴) | Xd Xh Xm | `2d 5h 30m` |
| 남은 시간 (짧) | MM:SS | `01:23` |
| 거래 시간 | MMM DD, HH:mm | `Jan 15, 14:30` |
| 라운드 표시 | #번호 HH:mm | `#125 14:30` |

### 0.3 지갑 주소 포맷

| 항목 | 포맷 | 예시 |
|------|------|------|
| 축약 주소 | 앞 6자리...뒤 4자리 | `0x742d...5e2f` |
| 전체 주소 | 42자리 전체 | `0x742d35Cc6634C0532925a3b844Bc454e4438f44e` |

### 0.4 입력 규칙

| 항목 | 규칙 | 설명 |
|------|------|------|
| Share 입력 | 양의 정수만 허용 | 음수 및 소수점 입력 불가 |
| CROSSD 입력 | 양수, 소수점 3자리까지 | 음수 입력 불가 |
| 초과 금액 처리 | 버림 처리 후 잔액 반영 | Share가 정수 단위이므로 체결 시 초과된 CROSSD는 버림 처리 |

**버림 처리 예시:**
- 입력: 100.567 CROSSD로 $0.650 Buy
- 가능 Share: floor(100.567 / 0.65) = floor(154.71) = 154 shares
- 실제 체결: 154 shares × 0.65 = 100.100 CROSSD
- 잔여 반환: 100.567 - 100.100 = 0.467 CROSSD (잔액에 반영)

### 0.5 계산 공식

> **기준**: 1 CROSSD = $1

#### 0.5.1 거래 관련 계산

| 항목 | 공식 | 예시 |
|------|------|------|
| **Total (매수 비용)** | `shares × price` | 100 shares × $0.650 = `65.000 CROSSD` |
| **Total (매도 수익)** | `shares × price` | 100 shares × $0.720 = `72.000 CROSSD` |
| **Taker 수수료** | `total × k × p × (1-p)` | k=카테고리별 설정 (기본값 2), p=0.65 → 65 × 2 × 0.65 × 0.35 = `29.575 CROSSD` |
| **Maker 수수료** | 없음 | `0 CROSSD` |

#### 0.5.2 포지션 관련 계산

| 항목 | 공식 | 예시 |
|------|------|------|
| **Market Value (시장 가치)** | `shares × currentPrice` | 100 shares × $0.720 = `72.000 CROSSD` |
| **Cost Basis (매입 원가)** | `shares × avgPrice` | 100 shares × $0.650 = `65.000 CROSSD` |
| **PnL (손익 금액)** | `marketValue - costBasis` | 72.000 - 65.000 = `+7.000 CROSSD` |
| **PnL % (손익률)** | `(PnL / costBasis) × 100` | (7.000 / 65.000) × 100 = `+10.77%` |

#### 0.5.3 Limit Order 계산

| 항목 | 공식 | 예시 |
|------|------|------|
| **Buy Total (Lock 금액)** | `shares × limitPrice` | 100 shares × $0.600 = `60.000 CROSSD` |
| **Sell Total (예상 수익)** | `shares × limitPrice` | 100 shares × $0.750 = `75.000 CROSSD` |

**Limit Order 특성:**
- 체결 방식: 기본 GTC (Good Till Cancelled) - 취소 전까지 유효. 서비스 오픈 후 IOC(Immediate-Or-Cancel), FOK(Fill-Or-Kill) 순차 도입 예정
- Taker/Maker 판정: 즉시 매칭되면 Taker(수수료 부과), 오더북 등록 시 Maker(수수료 없음)
- 오더북 등록: Maker 주문은 오더북에 등록되어 다른 사용자에게 표시
- Open Orders: 내 미체결 주문은 Portfolio 및 Market Detail의 Orders 탭에서 가격/수량 확인 가능
- Limit Sell 잠금: Maker Limit Sell 등록 시 해당 Shares 잠금 처리 (동일 Shares 중복 매도 방지)

#### 0.5.4 Split/Merge 계산

| 항목 | 공식 | 예시 |
|------|------|------|
| **Split** | `1 CROSSD → 1 Yes share + 1 No share` | 100 CROSSD → 100 Yes + 100 No |
| **Merge** | `1 Yes share + 1 No share → 1 CROSSD` | 100 Yes + 100 No → 100 CROSSD |

#### 0.5.5 Portfolio 통계 계산

| 항목 | 공식 | 설명 |
|------|------|------|
| **Total Equity** | `Available CROSSD + In Orders + Shares Value` | 총 자산 가치 |
| **Available CROSSD** | `현재 사용 가능 CROSSD 잔액` | 사용 가능 잔액 |
| **In Orders** | `Σ(미체결 Buy 주문 잠금 금액)` | Sell 주문 미포함 |
| **Shares Value** | `Σ(모든 포지션의 marketValue)` | 활성+종료 포지션 합산 |
| **Total PnL** | `Σ(all positions의 PnL)` | 전체 손익 |
| **Total PnL %** | `(totalPnL / totalCostBasis) × 100` | 전체 손익률 |

#### 0.5.6 수수료 계수 설명

```
fee = total × k × p × (1 - p)

- total: 거래 총액 (CROSSD)
- k: 이벤트 카테고리별 설정값 (Crypto/Politics/Sports/Macro/Culture, Admin §8-2에서 조회·수정)
- p: 가격 (0.001~0.999 범위)
- (1-p): 반대 확률

※ Taker 주문에만 적용. Maker 주문은 수수료 0
※ Taker 판정: 오더북의 기존 주문과 즉시 체결되면 Taker
   - Market 주문은 항상 Taker
   - Limit 주문도 즉시 매칭되면 Taker, 오더북 등록 시 Maker
※ 수수료는 가격이 $0.500일 때 최대 (p × (1-p) = 0.25)
※ 가격이 $0.001 또는 $0.999에 가까울수록 수수료 감소
```

---

## 1. 제품 개요

### 1.1 제품 비전
VybX는 EVM 기반의 탈중앙화 프리딕션 마켓 플랫폼으로, 사용자가 스포츠, 정치, 암호화폐, 매크로 경제, 문화 등 다양한 이벤트의 결과를 예측하고 거래할 수 있는 서비스입니다.

### 1.2 목표 사용자
- 암호화폐에 익숙한 개인 투자자
- 프리딕션 마켓에 관심이 있는 트레이더
- 이벤트 결과 예측을 통해 수익을 얻고자 하는 사용자

### 1.3 핵심 가치 제안
- **다양한 마켓 유형**: single-once-binary, single-series-binary, multi-once-binary, multi-series-binary 마켓 지원
- **하이브리드 CLOB**: Market Order와 Limit Order를 통한 유연한 거래
- **실시간 Up/Down 거래**: 암호화폐 가격 예측 마켓 (BTC, ETH, SOL)
- **이중 오라클 검증**: UMA + Polymarket API 이중 검증(Route A), Chainlink Data Streams(Route B)
- **Maker Rebate**: Taker 수수료의 일정 비율을 Maker에게 자동 환류하여 유동성 강화

### 1.4 비목표 (Non-Goals)
이번 MVP에서 구현하지 않는 항목:
- ❌ 관리자 패널 (Admin Panel) - 별도 스펙으로 개발
- ❌ 다국어 지원 (i18n) - 영어 단일 언어로 시작
- ❌ 모바일 네이티브 앱 (iOS/Android) - 웹 반응형 우선
- ❌ 오프체인 결제 수단 (신용카드, PayPal 등) - 암호화폐 지갑만 지원
- ❌ 소셜 기능 (댓글, 채팅, 팔로우) - 거래 중심 기능에 집중
- ❌ NFT 보상 시스템
- ❌ 자동 거래 봇 API - 수동 거래만 지원
- ❌ VIP 등급 시스템 (Normie/Viber/Prophet/Oracle) - Phase 2
- ❌ 포인트 적립 시스템 - Phase 2
- ❌ 리더보드 (트레이더 순위) - Phase 2
- ❌ 레퍼럴 프로그램 (추천 코드·보상) - Phase 2

---

## 2. 용어 정의

| 용어 | 정의 |
|------|------|
| **Event (이벤트)** | 예측 대상이 되는 실제 사건 (예: "Pro Football Champion: Seattle vs New England") |
| **Market (마켓)** | 이벤트 내 개별 베팅 옵션 (예: "Seattle", "New England") |
| **single-once-binary** | 단일 마켓, 단일 주기 (Yes/No) |
| **single-series-binary** | 단일 마켓, 라운드 반복 (크립토 업다운) |
| **multi-once-binary** | 복수 마켓, 단일 주기 (폴리마켓 멀티 이벤트) |
| **multi-series-binary** | 복수 마켓, 라운드 반복 |
| **Round (라운드)** | single-series-binary / multi-series-binary 마켓에서 시간 기반 거래 단위 (1min, 5min, 15min) |
| **Position (포지션)** | 사용자가 보유한 특정 마켓의 지분 |
| **Outcome** | 마켓의 결과 (Yes, No, Up, Down) |
| **Share (쉐어)** | 마켓 포지션의 단위 |
| **Side (사이드)** | 베팅 방향 (Yes/No 또는 Up/Down) |
| **Order (오더)** | 쉐어 매수/매도 주문 |
| **Market Order** | 현재 시장가로 즉시 체결되는 주문 (항상 Taker) |
| **Limit Order** | 지정가에 도달하면 체결되는 주문 (Maker 또는 Taker) |
| **Taker** | 오더북의 기존 주문과 즉시 체결되는 주문자 (수수료 부과) |
| **Maker** | 오더북에 등록되어 체결을 기다리는 주문자 (수수료 없음) |
| **Orderbook (오더북)** | 현재 대기 중인 매수/매도 주문 목록 |
| **CROSSD** | 플랫폼 내 거래에 사용되는 토큰 단위 (1 CROSSD = $1) |
| **Settlement (정산)** | 마켓 종료 후 결과에 따른 보상 지급 |
| **Split (스플릿)** | 1 CROSSD를 Yes + No 쉐어로 분할하는 행위 |
| **Merge (머지)** | Yes + No 쉐어를 합쳐 1 CROSSD로 변환하는 행위 |
| **Maker Rebate** | Taker 수수료의 일정 비율을 Maker에게 자동 환류하는 보상 |
| **Route A (DUAL_VERIFY)** | 폴리마켓 이벤트용 이중 검증 오라클 (UMA + Polymarket API) |
| **Route B (CHAINLINK_DATA_STREAMS)** | 크립토 가격 마켓용 오라클 (Chainlink Data Streams) |

---

## 3. 유저 플로우

### 3.1 전체 서비스 플로우

```mermaid
flowchart TB
    subgraph Entry["진입"]
        A[앱 접속] --> B{지갑 연결 상태?}
    end

    subgraph NoWallet["지갑 미연결"]
        B -->|미연결| C[이벤트 목록 탐색]
        C --> D[마켓 상세 보기]
        D --> E[Connect Wallet 클릭]
        E --> F[지갑 선택 모달]
        F --> G{연결 성공?}
        G -->|실패| H[에러 메시지]
        H --> F
        G -->|성공| I[지갑 연결 완료]
    end

    subgraph Connected["지갑 연결됨"]
        B -->|연결됨| J[메인 네비게이션]
        I --> J
        J --> K[Events]
        J --> L[Portfolio]
    end

    subgraph Trading["거래 플로우"]
        K --> O[이벤트 선택]
        O --> P[마켓 상세 페이지]
        P --> Q{마켓 상태?}
        Q -->|Active| R[거래 패널]
        Q -->|Closed| S[정산 패널]
        R --> T[Buy/Sell 선택]
        T --> U[주문 실행]
        U --> V{체결 결과}
        V -->|성공| W[포지션 업데이트]
        V -->|실패| X[에러 토스트]
    end
```

### 3.2 지갑 연결 플로우

```mermaid
flowchart LR
    A[Connect Wallet 클릭] --> B[모달 오픈]
    B --> C{지갑 선택}
    C -->|CROSSx| D[CROSSx 앱 승인]
    C -->|CROSSx Desktop| E[브라우저 확장 승인]
    C -->|Embedded Wallet| F[자체 개발 예정 — 추후 연동]
    D --> G{승인 결과}
    E --> G
    F --> G
    G -->|성공| H[지갑 주소 표시]
    G -->|실패| I[에러 메시지]
    I --> B
    H --> J[초기 잔액 로드]
    J --> K[거래 가능 상태]
```

### 3.3 거래 실행 플로우 (Market Order)

```mermaid
flowchart TD
    A[거래 패널] --> B[Buy/Sell 선택]
    B --> C[Yes/No 또는 Up/Down 선택]
    C --> D[Market Order 선택]
    D --> E[수량 입력]
    E --> F{유효성 검사}
    F -->|수량 = 0| G[에러: 수량 입력 필요]
    F -->|잔액 부족| H[에러: 잔액 부족]
    F -->|유효| I[예상 비용/수익 계산]
    I --> J[수수료 계산: total × k × p × (1-p)]
    J --> K[거래 버튼 활성화]
    K --> L[거래 실행]
    L --> M{체결 결과}
    M -->|성공| N[잔액 차감/증가]
    N --> O[포지션 업데이트]
    O --> P[거래 내역 추가]
    P --> Q[성공 토스트]
    M -->|실패| R[에러 토스트]
```

### 3.4 거래 실행 플로우 (Limit Order)

```mermaid
flowchart TD
    A[거래 패널] --> B[Buy/Sell 선택]
    B --> C[Yes/No 또는 Up/Down 선택]
    C --> D[Limit Order 선택]
    D --> E[가격 입력 $0.001~$0.999]
    E --> F[수량 입력]
    F --> G{유효성 검사}
    G -->|가격 범위 오류| H[에러: 자동 보정 또는 범위 초과 차단]
    G -->|잔액 부족| I[에러: 잔액 부족 - Buy 시]
    G -->|쉐어 부족| J[에러: 쉐어 부족 - Sell 시]
    G -->|유효| K[총 비용 계산]
    K --> L[거래 버튼 활성화]
    L --> M[주문 제출]
    M --> N[Buy 시: CROSSD 잔액 Lock]
    N --> O[Open Orders에 추가]
    O --> P[오더북 업데이트]
    P --> Q[성공 토스트]
```

### 3.5 Split/Merge 플로우

```mermaid
flowchart TD
    subgraph Split["Split: CROSSD → Yes + No"]
        A1[Split 버튼 클릭] --> B1[수량 입력]
        B1 --> C1{CROSSD 잔액 >= 수량?}
        C1 -->|부족| D1[에러: 잔액 부족]
        C1 -->|충분| E1[Split 실행]
        E1 --> F1[CROSSD 차감]
        F1 --> G1[Yes 쉐어 추가]
        G1 --> H1[No 쉐어 추가]
        H1 --> I1[거래 내역 기록]
    end

    subgraph Merge["Merge: Yes + No → CROSSD"]
        A2[Merge 버튼 클릭] --> B2[수량 입력]
        B2 --> C2{Yes, No 쉐어 >= 수량?}
        C2 -->|부족| D2[에러: 쉐어 부족]
        C2 -->|충분| E2[Merge 실행]
        E2 --> F2[Yes 쉐어 차감]
        F2 --> G2[No 쉐어 차감]
        G2 --> H2[CROSSD 추가]
        H2 --> I2[거래 내역 기록]
    end
```

---

## 4. 화면 기획

### 4.1 화면 목록

| 화면명 | 목적 |
|--------|------|
| Events (이벤트 목록) | 모든 예측 마켓 탐색 및 필터링 |
| Market Detail | 개별 마켓 상세 정보 및 거래 |
| Portfolio | 사용자 포지션, 주문, 거래 내역 관리 |
| Wallet Connect Modal | 지갑 연결 인터페이스 |
| GeoBlock Modal | 차단 지역 접속 시 서비스 이용 제한 안내 |

---

### 4.2 화면별 상세 기획

#### Events (이벤트 목록)

**화면명**: Events (이벤트 목록)
**화면 목적**: 사용자가 모든 예측 마켓을 탐색하고, 카테고리/상태/정렬 기준으로 필터링하여 원하는 마켓을 찾을 수 있게 함

**진입 경로**:
- 앱 최초 접속 시 기본 화면
- GNB의 "Events" 메뉴 클릭
- 지갑 연결 해제 시 자동 이동

**이탈 경로**:
- 마켓 카드 클릭 → Market Detail
- GNB 메뉴 클릭 → 해당 화면

**UI 요소 목록**:

| 요소 유형 | 요소명 | 설명 | 인터랙션 |
|----------|--------|------|----------|
| 컴포넌트 | Global Navigation Bar | 상단 고정 네비게이션, 로고/메뉴/지갑 연결 포함 | - |
| 텍스트 | Category 레이블 | "CATEGORY" 텍스트 | - |
| 버튼 | 카테고리 버튼 (All/Crypto/Politics/Sports/Macro/Culture) | 해당 카테고리로 마켓 목록 필터링 | 클릭 시 해당 카테고리 마켓만 표시 |
| 텍스트 | Status 레이블 | "STATUS" 텍스트 | - |
| 드롭다운 | Status 드롭다운 | Active/Upcoming/Closed/All 선택 | 클릭 시 옵션 표시, 선택 시 상태 필터 적용 |
| 텍스트 | Sort By 레이블 | "SORT BY" 텍스트 | - |
| 드롭다운 | Sort By 드롭다운 | Volume/Newest/Ending Soon/Price Change | 클릭 시 옵션 표시, 선택 시 정렬 적용 |
| 그리드 | 마켓 카드 그리드 | 4열 반응형 그리드 | - |
| 컴포넌트 | 마켓 카드 | 개별 마켓 정보 카드 | 클릭 시 Market Detail 페이지로 이동 |
| 빈 상태 | 결과 없음 메시지 | "No markets found..." | - |
| 컴포넌트 | Footer | 하단 푸터 | - |

**상태별 화면 변화**:

| 상태 | 변화 |
|------|------|
| 로딩 | 스켈레톤 UI 표시 (카드 형태, shimmer 효과 적용) |
| 빈 상태 | 결과 없음 메시지 표시, 그리드 숨김 |
| 데이터 있음 | 그리드 내 마켓 카드 표시 |
| 필터 선택됨 | 해당 카테고리/상태 버튼 활성화 스타일 |

**반응형 고려사항**:
- xl (1280px+): 4열 그리드
- lg (1024px+): 3열 그리드
- md (768px+): 2열 그리드
- sm: 1열 그리드

---

#### Market Detail (마켓 상세)

**화면명**: Market Detail
**화면 목적**: 개별 마켓의 상세 정보 확인, 차트 분석, 오더북 확인 및 거래 실행

**진입 경로**:
- Events에서 마켓 카드 클릭
- Portfolio에서 포지션/주문 행 클릭
- User Detail에서 마켓 항목 클릭

**이탈 경로**:
- Back 버튼 → Events
- GNB 메뉴 → 해당 화면
- 이벤트 드롭다운에서 다른 이벤트 선택 → 해당 마켓

**UI 요소 목록**:

| 요소 유형 | 요소명 | 설명 | 인터랙션 |
|----------|--------|------|----------|
| 버튼 | Back 버튼 | 이전 화면으로 이동 | 클릭 시 Events 페이지로 이동 |
| 텍스트 | 카테고리 텍스트 | 마켓 카테고리 표시 | - |
| 텍스트 | 이벤트 타이틀 | 이벤트 제목 표시 | - |
| 이미지 | 썸네일 | 이벤트 아이콘 이미지 | - |
| 드롭다운 | 마켓/이벤트 드롭다운 | 마켓 또는 이벤트 선택 | 클릭 시 옵션 표시, 선택 시 해당 마켓으로 전환 |
| 컴포넌트 | 마켓 통계 | Yes/No 가격, Volume, Closes 정보 | - |
| 컴포넌트 | 가격 차트 | 시간별 가격 추이 라인 차트 | 마우스 호버 시 해당 시점 데이터 표시 |
| 버튼 그룹 | 차트 모드 | Up/Down 마켓: Probability/Price | 클릭 시 차트 Y축 모드 전환 |
| 버튼 그룹 | 차트 기간 | 1D/1W/1M/ALL | 클릭 시 차트 데이터 기간 변경 |
| 버튼 그룹 | 차트 라인 선택 | Yes/No/Both | 클릭 시 표시할 라인 토글 |
| 컴포넌트 | 오더북 | 매수/매도 주문 목록 표시, 내 주문은 하이라이트 표시 | 가격 행 클릭 시 해당 가격으로 Limit Price 자동 입력 |
| 행 | Ask 행 | 매도 주문 행 (빨간색 배경), 내 주문 포함 시 별도 표시 | 클릭 시 해당 가격으로 Limit Price 설정 |
| 행 | Bid 행 | 매수 주문 행 (초록색 배경), 내 주문 포함 시 별도 표시 | 클릭 시 해당 가격으로 Limit Price 설정 |
| 영역 | 현재가 표시 | 중앙 현재 가격 표시 | - |
| 마커 | 내 주문 마커 | 오더북에서 내 Limit Order가 걸려있는 가격대 하이라이트 | 해당 가격대에 내 주문 수량 표시 |
| 컴포넌트 | 거래 패널 | 주문 입력 및 실행 UI | - |
| 버튼 | Buy/Sell 탭 | 매수/매도 모드 전환 | 클릭 시 거래 모드 전환, UI 변경 |
| 드롭다운 | Order Type | Market/Limit 선택 | 클릭 시 주문 유형 전환, Price Input 표시/숨김 |
| 버튼 | Yes/Up, No/Down 버튼 | 베팅 방향 선택 | 클릭 시 Side 선택, 가격/잔액 업데이트 |
| 텍스트 | Available Balance | 사용 가능 잔액 표시 (Buy: CROSSD, Sell: 쉐어) | - |
| 입력 필드 | Price Input | Limit 주문 가격 입력 ($0.001~$0.999) | 입력 시 Total 자동 계산 |
| 입력 필드 | Shares Input | 수량 입력 | 입력 시 Total/Fee 자동 계산 |
| 텍스트 | Total | 총 비용/수익 표시 | - |
| 텍스트 | Fee | Taker 수수료 표시 (수식: total × k × p × (1-p)) | - |
| 텍스트 | Avg Price | 평균 체결가 표시 | - |
| 텍스트 | Potential Return | 예상 수익률 표시 | - |
| 버튼 | 거래 실행 버튼 | Buy/Sell 실행 | 클릭 시 거래 실행, 성공/실패 토스트 표시 |
| 드롭다운 | Split/Merge 메뉴 | Split(CROSSD→Yes+No), Merge(Yes+No→CROSSD) | 클릭 시 수량 입력 모달, 실행 시 포지션 업데이트 |
| 탭 컨텐츠 | Positions 탭 | 현재 마켓의 보유 포지션 목록 (아래 테이블 참조) | - |
| 탭 컨텐츠 | Orders 탭 | 현재 마켓의 미체결 주문 목록 (아래 테이블 참조) | - |
| 탭 컨텐츠 | History 탭 | 현재 마켓의 거래 내역 목록 (아래 테이블 참조) | - |
| 버튼 | Connect Wallet | 지갑 미연결 시 표시 | 클릭 시 Wallet Connect Modal 오픈 |

**상태별 화면 변화**:

| 상태 | 변화 |
|------|------|
| 지갑 미연결 | 거래 패널에 "Connect Wallet" 버튼만 표시, 거래 기능 비활성화 |
| 지갑 연결됨 | 전체 거래 패널 활성화, 잔액 표시 |
| Market Order 선택 | Price Input 숨김, 수수료 표시 |
| Limit Order 선택 | Price Input 표시, 수수료 숨김 |
| Buy 선택 | Balance에 CROSSD 표시, "Buy" 버튼 |
| Sell 선택 | Balance에 쉐어 수량 표시, "Sell" 버튼 |
| 마켓 Active | 거래 패널 전체 기능 활성화 |
| 마켓 Closed | 정산 UI 표시, 포지션 매도만 가능 |
| 마켓 Upcoming | 거래 기능 비활성화, "거래 시작 예정" 메시지 표시 |
| Up/Down 마켓 | 라운드 드롭다운 표시, 카운트다운 표시 |
| 에러 발생 | 에러 토스트 메시지 표시 |
| 거래 성공 | 성공 토스트 메시지 표시 |

**하단 탭 테이블 상세**:

**Positions 탭 테이블**:

| 컬럼명 | 데이터 | 포맷 |
|--------|--------|------|
| Side | 포지션 방향 | `Yes` / `No` / `Up` / `Down` (색상 적용) |
| Shares | 보유 쉐어 수량 | 양의 정수 (예: `100`) |
| Avg Price | 평균 매입가 | 소수점 3자리 $ (예: `$0.650`) |
| Current Price | 현재가 | 소수점 3자리 $ (예: `$0.725`) |
| Value | 시장 가치 | 소수점 3자리 CROSSD (예: `72.500 CROSSD`) |
| PnL | 손익 | ±금액 + % (예: `+7.500 (+11.54%)`) |

**Orders 탭 테이블**:

| 컬럼명 | 데이터 | 포맷 |
|--------|--------|------|
| Side | 주문 방향 | `Yes` / `No` / `Up` / `Down` (색상 적용) |
| Type | 주문 유형 | `Buy` / `Sell` |
| Shares | 주문 수량 | 양의 정수 (예: `50`) |
| Filled | 체결 수량 | 양의 정수 (예: `0`) |
| Price | 주문 가격 | 소수점 3자리 $ (예: `$0.600`) |
| Total | 총 금액 | 소수점 3자리 CROSSD (예: `30.000 CROSSD`) |
| Time | 주문 시간 | MMM DD, HH:mm (예: `Jan 15, 14:30`) |
| Action | 취소 버튼 | `Cancel` 버튼 (GTC 주문 취소) |

**History 탭 테이블**:

| 컬럼명 | 데이터 | 포맷 |
|--------|--------|------|
| Side | 거래 방향 | `Yes` / `No` / `Up` / `Down` (색상 적용) |
| Type | 거래 유형 | `Buy` / `Sell` / `Split` / `Merge` |
| Shares | 거래 수량 | 양의 정수 (예: `100`) |
| Price | 체결 가격 | 소수점 3자리 $ (예: `$0.650`) |
| Total | 총 금액 | 소수점 3자리 CROSSD (예: `65.000 CROSSD`) |
| Fee | 수수료 | 소수점 3자리 CROSSD (예: `2.500 CROSSD`) / Limit은 `-` |
| Time | 거래 시간 | MMM DD, HH:mm (예: `Jan 15, 14:30`) |

---

#### Portfolio

**화면명**: Portfolio
**화면 목적**: 사용자의 전체 포트폴리오 현황, 포지션, 주문, 거래 내역 관리

**진입 경로**:
- GNB의 "Portfolio" 메뉴 클릭
- GNB의 Equity/CROSSD 영역 클릭

**이탈 경로**:
- 포지션/주문 행 클릭 → 해당 마켓 (Market Detail)
- GNB 메뉴 → 해당 화면

**UI 요소 목록**:

| 요소 유형 | 요소명 | 설명 | 인터랙션 |
|----------|--------|------|----------|
| 텍스트 | 페이지 제목 | "Portfolio" | - |
| 텍스트 | 부제목 | 페이지 설명 텍스트 | - |
| 카드 | Total Equity | 총 자산 가치 표시 | - |
| 카드 | Total PnL | 총 손익 및 % 표시 (양수: 녹색, 음수: 빨간색) | - |
| 카드 | Available Balance | 사용 가능 CROSSD | - |
| 카드 | Active Markets | 활성 마켓의 Orders/Shares 가치 | - |
| 카드 | Closed Markets | 종료된 마켓의 Orders/Shares 가치 | - |
| 탭 버튼 | Positions/Open orders/History/Rebate 탭 | 탭 전환 | 클릭 시 해당 탭 컨텐츠 표시, 선택된 탭 하단 흰색 라인 |
| 테이블 | 포지션 테이블 | 아래 테이블 참조 | 행 클릭 시 해당 마켓으로 이동 |
| 버튼 | Share PnL | PnL 공유 버튼 (각 행) | 클릭 시 공유 모달 오픈 |
| 테이블 | 주문 테이블 | 아래 테이블 참조 | 행 클릭 시 해당 마켓으로 이동 |
| 버튼 | Cancel | 주문 취소 버튼 (각 행) | 클릭 시 주문 취소, Lock된 CROSSD/Shares 반환 |
| 테이블 | 거래 내역 테이블 | 아래 테이블 참조 | 행 클릭 시 해당 마켓으로 이동 |
| 테이블 | Rebate 내역 테이블 | 아래 테이블 참조 | - |
| 컴포넌트 | 페이지네이션 | 페이지 이동 | 클릭 시 해당 페이지로 이동 |

**상태별 화면 변화**:

| 상태 | 변화 |
|------|------|
| 지갑 미연결 | 모든 수치 0 또는 "-" 표시, 테이블 빈 상태 |
| 지갑 연결됨 | 실제 데이터 표시 |
| 포지션 없음 | 빈 테이블 메시지 |
| PnL 양수 | 녹색 텍스트 + "+" 접두사 |
| PnL 음수 | 빨간색 텍스트 |
| 탭 활성화 | 해당 탭 버튼 하단 흰색 라인 |

**탭별 테이블 상세**:

**Positions 탭 테이블**:

| 컬럼명 | 데이터 | 포맷 |
|--------|--------|------|
| Event | 이벤트 제목 | 텍스트 (예: `Pro Football Champion`) |
| Market | 마켓 이름 | 텍스트, Single 마켓은 `-` |
| Side | 포지션 방향 | `Yes` / `No` / `Up` / `Down` (색상 적용) |
| Shares | 보유 쉐어 수량 | 양의 정수 (예: `100`) |
| Avg Price | 평균 매입가 | 소수점 3자리 $ (예: `$0.650`) |
| Current Price | 현재가 | 소수점 3자리 $ (예: `$0.725`) |
| Value | 시장 가치 | 소수점 3자리 CROSSD (예: `72.500 CROSSD`) |
| PnL | 손익 | ±금액 (색상 적용, 예: `+7.500`) |
| Closes In | 남은 시간 | Xd Xh Xm 또는 `Closed` |
| Action | 공유 버튼 | Share PnL 아이콘 버튼 |

**Open Orders 탭 테이블**:

| 컬럼명 | 데이터 | 포맷 |
|--------|--------|------|
| Event | 이벤트 제목 | 텍스트 |
| Market | 마켓 이름 | 텍스트, Single 마켓은 `-` |
| Side | 주문 방향 | `Yes` / `No` / `Up` / `Down` (색상 적용) |
| Type | 주문 유형 | `Buy` / `Sell` |
| Shares | 주문 수량 | 양의 정수 (예: `50`) |
| Filled | 체결 수량 | 양의 정수 (예: `0`) |
| Price | 주문 가격 | 소수점 3자리 $ (예: `$0.600`) |
| Total | 총 금액 | 소수점 3자리 CROSSD (예: `30.000 CROSSD`) |
| Time | 주문 시간 | MMM DD, HH:mm (예: `Jan 15, 14:30`) |
| Action | 취소 버튼 | `Cancel` 버튼 (GTC 주문 취소) |

**History 탭 테이블**:

| 컬럼명 | 데이터 | 포맷 |
|--------|--------|------|
| Event | 이벤트 제목 | 텍스트 |
| Market | 마켓 이름 | 텍스트, Single 마켓은 `-` |
| Side | 거래 방향 | `Yes` / `No` / `Up` / `Down` (색상 적용) |
| Type | 거래 유형 | `Buy` / `Sell` / `Split` / `Merge` |
| Shares | 거래 수량 | 양의 정수 (예: `100`) |
| Price | 체결 가격 | 소수점 3자리 $ (예: `$0.650`) |
| Total | 총 금액 | 소수점 3자리 CROSSD (예: `65.000 CROSSD`) |
| Fee | 수수료 | 소수점 3자리 CROSSD (예: `2.500 CROSSD`) / Maker은 `-` |
| Time | 거래 시간 | MMM DD, HH:mm (예: `Jan 15, 14:30`) |

**Rebate 탭 테이블**:

| 컬럼명 | 데이터 | 포맷 |
|--------|--------|------|
| Event | 이벤트 제목 | 텍스트 (예: `La Liga Winner`) |
| Market | 마켓 이름 | 텍스트, Single 마켓은 `-` (예: `Seattle`) |
| Date | 체결 시각 | MMM D, YYYY HH:mm:ss (예: `Feb 5, 2026 16:35:40`) |
| Maker Volume | 체결된 Maker 거래 금액 | 소수점 2자리 $, 천단위 콤마 (예: `$1,250.00`) |
| Rebate Rate | 적용된 리베이트 비율 | 소수점 없이 % (예: `5%`) |
| Rebate Amount | 지급된 리베이트 금액 | `+$` 접두사, 소수점 2자리, 녹색 텍스트 (예: `+$62.50`) |

---

#### Wallet Connect Modal

**화면명**: Wallet Connect Modal
**화면 목적**: 지갑 연결 옵션 선택

**진입 경로**:
- GNB의 "Connect Wallet" 버튼 클릭
- 거래 패널의 "Connect Wallet" 버튼 클릭

**이탈 경로**:
- 지갑 선택 → 연결 시도 → 성공 시 모달 닫힘
- X 버튼 → 모달 닫힘
- 모달 외부 영역 클릭 → 모달 닫힘

**UI 요소 목록**:

| 요소 유형 | 요소명 | 설명 | 인터랙션 |
|----------|--------|------|----------|
| 오버레이 | 배경 오버레이 | 반투명 검정 배경 | 클릭 시 모달 닫힘 |
| 모달 | 모달 컨테이너 | 흰색 배경 모달 | - |
| 텍스트 | 제목 | "Connect Wallet" | - |
| 텍스트 | 부제목 | 설명 텍스트 | - |
| 버튼 | 닫기 버튼 | X 아이콘 | 클릭 시 모달 닫힘 |
| 버튼 | CROSSx 옵션 | 로고 + 이름 + "Recommended" 뱃지 | 클릭 시 CROSSx 앱 연결 시도, 성공 시 모달 닫힘 |
| 텍스트 | CROSSx 설명 | "App approval is required" | - |
| 버튼 | CROSSx Desktop 옵션 | 로고 + 이름 + "Install" 뱃지 | 클릭 시 브라우저 확장 연결 시도, 성공 시 모달 닫힘 |
| 텍스트 | Desktop 설명 | "Browser extension approval is required" | - |
| 텍스트 | Embedded Wallet 안내 | 로고 + 이름 + "Coming Soon" 뱃지 | 비활성화 상태 표시 — 자체 개발 완료 후 연동 예정 |
| 영역 | 도움말 영역 | "Wallet not detected?" 및 팁 목록 | - |
| 텍스트 | 약관 안내 | 약관 동의 안내 텍스트 | - |

**상태별 화면 변화**:

| 상태 | 변화 |
|------|------|
| 모달 닫힘 | 컴포넌트 렌더링 안 됨 |
| 모달 열림 | 오버레이 + 모달 표시 |
| 지갑 선택 중 | [ASSUMPTION] 해당 버튼 로딩 상태 |
| 연결 성공 | 모달 자동 닫힘 |
| 연결 실패 | 에러 토스트 표시, 모달 유지하여 재시도 가능 |

**모달 기능 상세**:

| 지갑 옵션 | 연결 방식 | 처리 흐름 |
|----------|----------|----------|
| CROSSx | 모바일 앱 연결 | 1. 옵션 클릭 → 2. CROSSx 앱 실행/딥링크 → 3. 앱에서 승인 요청 → 4. 승인 완료 시 연결 |
| CROSSx Desktop | 브라우저 확장 | 1. 옵션 클릭 → 2. 확장 프로그램 팝업 → 3. 승인 요청 → 4. 승인 완료 시 연결 |
| Embedded Wallet | 자체 개발 예정 | 개발 완료 후 연동 — 현재 Coming Soon 표시 |

**연결 완료 후 처리**:
1. 지갑 주소 저장 및 GNB에 축약 형태로 표시
2. CROSSD 잔액 블록체인에서 조회 및 표시
3. 거래 기능 활성화
4. 모달 자동 닫힘
5. 성공 토스트 표시: "지갑이 연결되었습니다"

---

#### GeoBlock Modal

**화면명**: GeoBlock Modal
**화면 목적**: 차단 지역 접속 시 서비스 이용 제한 안내

**진입 경로**:
- 지갑 연결 시도 시 GeoIP 검증 → 차단 지역 감지
- 지갑 연결 후 자산 거래(Buy/Sell/Split/Merge/Redeem) 시도 시 GeoIP 재검증 → 차단 지역 감지

**이탈 경로**:
- X 버튼 → 모달 닫힘 (거래 기능 비활성 유지)
- 모달 외부 영역 클릭 → 모달 닫힘 (거래 기능 비활성 유지)

**UI 요소 목록**:

| 요소 유형 | 요소명 | 설명 | 인터랙션 |
|----------|--------|------|----------|
| 오버레이 | 배경 오버레이 | 반투명 검정 배경 | 클릭 시 모달 닫힘 |
| 모달 | 모달 컨테이너 | 흰색 배경 모달 | - |
| 아이콘 | 경고 아이콘 | 차단 안내 아이콘 | - |
| 텍스트 | 제목 | "Service Unavailable" | - |
| 텍스트 | 안내 메시지 | "This service is not available in your region." | - |
| 버튼 | 닫기 버튼 | X 아이콘 | 클릭 시 모달 닫힘 |

**GeoBlock 검증 플로우**:

```
[트리거 1: 지갑 연결 시]
Connect Wallet 버튼 클릭
  → GeoIP 검증 (IP 기반)
  +-- 허용 지역 → Wallet Connect Modal 오픈 (정상 플로우)
  +-- 차단 지역 → GeoBlock Modal 표시
       +-> 지갑 연결 차단
       +-> 모달 닫힘 후에도 거래 기능 비활성 유지

[트리거 2: 자산 거래 시도 시]
Buy/Sell/Split/Merge/Redeem 버튼 클릭
  → GeoIP 재검증 (IP 기반)
  +-- 허용 지역 → 거래 실행 (정상 플로우)
  +-- 차단 지역 → GeoBlock Modal 표시
       +-> 해당 거래 차단
       +-> 모든 자산 거래 불가 (Market/Limit Order, Split, Merge, Redeem 포함)
```

**검증 시점 설계 의도**: 지갑 연결 시 1차 검증으로 차단하되, VPN 등으로 우회 후 연결한 뒤 차단 지역에서 거래를 시도하는 경우를 대비하여 거래 시도 시 2차 재검증을 수행한다.

---

### 모달 목록

서비스 내에서 사용되는 모달 목록과 기능 정의입니다.

| 모달명 | 트리거 | 기능 | 확인 액션 | 취소 액션 |
|--------|--------|------|----------|----------|
| Wallet Connect Modal | Connect Wallet 버튼 클릭 | 지갑 연결 옵션 선택 | 지갑 연결 시도 | 모달 닫힘 |
| GeoBlock Modal | 지갑 연결 시 또는 자산 거래(Buy/Sell/Split/Merge/Redeem) 시도 시 차단 지역 감지 | 접속 차단 안내 | - (확인 액션 없음) | 모달 닫힘 (기능 비활성 유지) |
| Split Modal | Split 메뉴 선택 | CROSSD → Yes+No 쉐어 분할 | Split 실행, 포지션 업데이트 | 모달 닫힘 |
| Merge Modal | Merge 메뉴 선택 | Yes+No 쉐어 → CROSSD 병합 | Merge 실행, 잔액 업데이트 | 모달 닫힘 |
| Share PnL Modal | Share PnL 버튼 클릭 | 손익 이미지 공유 | 이미지 다운로드/공유 | 모달 닫힘 |

---

## 5. 기능 정의

### 5.1 기능 목록

| 카테고리 | 기능명 | 설명 |
|----------|--------|------|
| 공통 | Global Navigation | 상단 고정 네비게이션, 로고/메뉴/지갑 연결 |
| 공통 | Wallet Connect | 지갑 연결 (CROSSx, CROSSx Desktop) — Embedded Wallet 추후 연동 예정 |
| 공통 | Wallet Disconnect | 지갑 연결 해제 |
| 공통 | GeoBlock 검증 | 차단 지역 접속 차단 (지갑 연결 시 1차, 자산 거래 시도 시 2차 재검증 — Buy/Sell/Split/Merge/Redeem 전체) |
| Events | Category Filter | 카테고리별 마켓 필터링 (All/Crypto/Politics/Sports/Macro/Culture) |
| Events | Status Filter | 상태별 마켓 필터링 (Active/Upcoming/Closed/All) |
| Events | Sort Filter | 정렬 기준 변경 (Volume/Newest/Ending Soon/Price Change) |
| Events | Market Card Click | 마켓 상세 페이지로 이동 |
| Market Detail | Back Navigation | 이전 화면(Events)으로 이동 |
| Market Detail | Market/Event Dropdown | multi-once/multi-series 마켓에서 마켓 옵션 선택, 이벤트 간 전환 |
| Market Detail | Price Chart | 가격 추이 라인 차트 표시 |
| Market Detail | Chart Controls | 차트 모드/기간/라인 선택 |
| Market Detail | Orderbook Display | 매수/매도 주문 목록 표시 |
| Market Detail | Orderbook Price Click | 클릭한 가격으로 Limit Price 자동 입력 |
| Market Detail | Trading Panel | 주문 입력 및 실행 UI |
| Market Detail | Buy/Sell Toggle | 매수/매도 모드 전환 |
| Market Detail | Order Type Selection | Market/Limit 주문 유형 선택 |
| Market Detail | Side Selection | Yes/No 또는 Up/Down 선택 |
| Market Detail | Trade Execution | 거래 실행 (Market/Limit Order) |
| Market Detail | Split/Merge | CROSSD ↔ Yes+No 쉐어 변환 |
| Portfolio | Tab Navigation | Positions/Open orders/History/Rebate 탭 전환 |
| Portfolio | Position Table | 보유 포지션 목록 표시, 행 클릭 시 마켓 이동 |
| Portfolio | Order Cancel | 미체결 주문 취소, Lock된 CROSSD(Buy) 또는 Shares(Sell) 반환 |
| Portfolio | PnL Share | 손익 공유 기능 |
| Portfolio | Pagination | 페이지 이동 |

---

### 5.2 기능별 상세 정의

#### Wallet Connect

**기능명**: Wallet Connect
**기능 설명**: 사용자가 암호화폐 지갑을 앱에 연결하여 거래 기능을 활성화

**관련 화면**: Events, Market Detail, Wallet Connect Modal, GeoBlock Modal

**선행 조건**:
- 앱이 정상적으로 로드됨
- 지갑이 현재 연결되어 있지 않음

**트리거**:
- "Connect Wallet" 버튼 클릭 (GNB, 거래 패널)

**처리 로직**:
1. GeoIP 검증 (차단 지역 확인)
   - 차단 지역 → GeoBlock Modal 표시, 지갑 연결 차단 (이후 단계 진행 안 함)
   - 허용 지역 → 다음 단계 진행
2. Wallet Connect Modal 오픈
3. 사용자가 지갑 옵션 선택 (CROSSx, CROSSx Desktop)
4. 선택된 지갑 타입에 따라 연결 시도
5. 연결 성공 시:
   - `isWalletConnected` 상태를 `true`로 설정
   - `connectedWallet`에 지갑 이름 저장 (예: "CROSSx")
   - `walletAddress`에 축약 주소 저장 (예: "0x742d...5e2f")
   - 초기 잔액 로드 (CROSSD: 1000.00)
6. 모달 닫기

**결과/피드백**:
- 성공: GNB에 지갑 주소 및 잔액 표시, 거래 기능 활성화
- 실패: 에러 메시지 표시, 모달 유지

**예외 처리**:
| 에러 케이스 | 대응 |
|------------|------|
| 차단 지역 접속 | GeoBlock Modal 표시, 지갑 연결 차단 |
| 지갑 앱 미설치 | "지갑을 설치해주세요" 메시지 + 공식 웹사이트 링크 제공 |
| 연결 거부 | 모달 유지, 재시도 가능 |
| 네트워크 오류 | 에러 토스트 표시 + "다시 시도" 버튼 제공 |

**연관 기능**: Wallet Disconnect, CROSSx/CROSSx Desktop 연결, Embedded Wallet (추후 연동)

---

#### Trade Execution

**기능명**: Trade Execution
**기능 설명**: Market Order 또는 Limit Order로 쉐어를 매수/매도

**관련 화면**: Market Detail

**선행 조건**:
- 지갑이 연결되어 있음
- 마켓이 Active 상태
- 유효한 수량이 입력됨
- (Limit Order) 유효한 가격이 입력됨 ($0.001~$0.999)

**트리거**:
- Buy/Sell 버튼 클릭

**처리 로직**:

**유효성 검증 순서**: GeoIP 재검증 → 지갑 연결 확인 → 수량 입력 확인 → (Limit) 가격 범위 확인 → 잔액/잔량 확인

**Taker/Maker 판정 규칙**:
- Market Order → 항상 Taker (수수료 부과)
- Limit Order → 즉시 매칭 시 Taker (수수료 부과), 오더북 등록 시 Maker (수수료 없음)

**Market Order - Buy (Taker):**
1. 입력값 유효성 검사
2. 총 비용 계산: `total = shares × price`
3. Taker 수수료 계산: `fee = total × k × p × (1-p)` (k=이벤트 카테고리별 설정값, p=price)
4. 잔액 확인: `CROSSD >= total + fee`
5. 잔액 차감: `CROSSD -= (total + fee)`
6. 포지션 추가/업데이트 (totalShares += shares, totalCost += total + fee)
7. 거래 내역 추가 (action: "buy", fee 포함)
8. 성공 메시지 표시

**Market Order - Sell (Taker):**
1. 입력값 유효성 검사
2. 가용 쉐어 확인: `availableShares (= totalShares - lockedShares) >= shares`
3. 총 수익 계산: `total = shares × price`
4. Taker 수수료 계산 (동일)
5. 포지션 차감 (totalShares -= shares)
6. 잔액 추가: `CROSSD += (total - fee)`
7. 거래 내역 추가
8. 성공 메시지 표시

**Limit Order - Buy (Maker 등록 시):**
1. 입력값 유효성 검사 (가격 $0.001~$0.999)
2. 총 비용 계산: `total = shares × limitPrice`
3. 잔액 확인: `CROSSD >= total`
4. 잔액에서 비용 Lock: `CROSSD -= total` (lockedInOrders += total)
5. Open Orders에 추가
6. 성공 메시지 표시 ("Limit order placed")
7. 체결 시: lockedInOrders -= total, totalShares += shares (Maker 수수료 없음)

**Limit Order - Sell (Maker 등록 시):**
1. 입력값 유효성 검사 (가격 $0.001~$0.999)
2. 가용 쉐어 확인: `availableShares (= totalShares - lockedShares) >= shares`
3. Shares Lock: `lockedShares += shares` (동일 Shares 중복 매도 방지)
4. Open Orders에 추가
5. 성공 메시지 표시
6. 체결 시: lockedShares -= shares, totalShares -= shares, CROSSD += total (Maker 수수료 없음)

**Limit Order 즉시 매칭 시 (Taker):**
- Limit 주문이 제출 즉시 오더북의 기존 주문과 매칭되면 Taker로 판정
- Taker 수수료 부과: `fee = total × k × p × (1-p)`
- 처리 로직은 Market Order와 동일

**결과/피드백**:
- 성공:
  - 토스트 메시지: "Bought/Sold X [Side] shares" (Market) 또는 "Limit order placed" (Limit)
  - 잔액/포지션 즉시 업데이트
  - 입력 필드 초기화
- 실패: 에러 토스트 메시지

**예외 처리**:
| 에러 케이스 | 에러 메시지 |
|------------|------------|
| 차단 지역 접속 | GeoBlock Modal 표시, 거래 차단 |
| 지갑 미연결 | "Please connect your wallet" |
| 수량 미입력/0 | "Please enter a valid amount of shares" |
| Limit 가격 범위 오류 | "Please enter a valid limit price ($0.001~$0.999)" |
| CROSSD 잔액 부족 | "Insufficient balance" |
| 쉐어 잔량 부족 | "Insufficient [Side] shares" |

**연관 기능**: Trading Panel, Buy/Sell Toggle, Order Type Selection, Side Selection

---

#### Split/Merge

**기능명**: Split/Merge
**기능 설명**: CROSSD를 Yes+No 쉐어로 분할(Split)하거나, Yes+No 쉐어를 합쳐 CROSSD로 변환(Merge)

**관련 화면**: Market Detail

**선행 조건**:
- 지갑이 연결되어 있음
- 마켓이 Active 상태

**트리거**:
- Split/Merge 드롭다운에서 옵션 선택 후 수량 입력 및 확인

**처리 로직**:

**Split:**
1. GeoIP 재검증 → 차단 지역 시 GeoBlock Modal 표시, 차단
2. 수량 입력 확인
2. CROSSD 잔액 확인: `CROSSD >= amount`
3. CROSSD 차감: `CROSSD -= amount`
4. Yes 쉐어 추가: `position[Yes] += amount`
5. No 쉐어 추가: `position[No] += amount`
6. 거래 내역 추가 (action: "split", 각 side별로)

**Merge:**
1. GeoIP 재검증 → 차단 지역 시 GeoBlock Modal 표시, 차단
2. 수량 입력 확인
2. Yes, No 쉐어 확인: `position[Yes] >= amount && position[No] >= amount`
3. Yes 쉐어 차감: `position[Yes] -= amount`
4. No 쉐어 차감: `position[No] -= amount`
5. CROSSD 추가: `CROSSD += amount`
6. 거래 내역 추가 (action: "merge")

**결과/피드백**:
- 성공: 토스트 메시지, 잔액/포지션 업데이트, 모달 닫힘
- 실패: 에러 토스트 메시지

**예외 처리**:
| 에러 케이스 | 에러 메시지 |
|------------|------------|
| 차단 지역 접속 | GeoBlock Modal 표시, 거래 차단 |
| Split - CROSSD 부족 | "Insufficient CROSSD balance" |
| Merge - Yes 쉐어 부족 | "Insufficient Yes shares" |
| Merge - No 쉐어 부족 | "Insufficient No shares" |

**연관 기능**: Trade Execution

---

#### Redeem

**기능명**: Redeem
**기능 설명**: 정산 완료된 마켓에서 보유 Shares를 CROSSD로 수령

**관련 화면**: Market Detail, Portfolio, GeoBlock Modal

**선행 조건**:
- 지갑이 연결되어 있음
- 마켓이 RESOLVED 또는 REDEEMABLE 상태
- 해당 사이드에 보유 Shares가 존재

**트리거**:
- "Redeem All {Side} Shares" 버튼 클릭

**처리 로직**:
1. GeoIP 재검증 → 차단 지역 시 GeoBlock Modal 표시, 리딤 차단
2. 보유 Shares 확인: `position[Side].totalShares > 0`
3. 리딤 금액 계산:
   - 승리 사이드: `redeemAmount = $1.00 × totalShares`
   - 패배 사이드: `redeemAmount = $0.00 × totalShares` (가치 0)
4. CROSSD 지급: `CROSSD += redeemAmount`
5. 포지션 제거: `position[Side].totalShares = 0`
6. 거래 내역 추가 (action: "redeem", side, shares, amount)

**수수료**: 없음 (정산 리딤은 수수료 면제)

**결과/피드백**:
- 성공: 토스트 "Redeemed {shares} {Side} shares for {amount} CROSSD", 잔액 업데이트
- 패배 사이드: 토스트 "Redeemed {shares} {Side} shares (value: $0.00)", 포지션 제거

**예외 처리**:
| 에러 케이스 | 대응 |
|------------|------|
| 차단 지역 접속 | GeoBlock Modal 표시, 리딤 차단 |
| 보유 Shares 없음 | "No shares to redeem" 메시지 표시 |
| 마켓 미종료 | Redeem 버튼 비활성화 (ACTIVE 상태에서는 표시 안 함) |

**연관 기능**: Trade Execution, Split/Merge

---

#### Order Cancel

**기능명**: Order Cancel
**기능 설명**: 미체결 Limit Order를 취소하고 Lock된 자금 또는 Shares 반환

**관련 화면**: Market Detail, Portfolio

**선행 조건**:
- 지갑이 연결되어 있음
- 취소할 주문이 존재함

**트리거**:
- 주문 테이블의 "Cancel" 버튼 클릭

**처리 로직**:
1. 주문 ID로 해당 주문 찾기
2. 주문이 Buy인 경우:
   - Lock된 금액 반환: `CROSSD += order.total` (lockedInOrders -= order.total)
3. 주문이 Sell인 경우:
   - Lock된 Shares 반환: `lockedShares -= order.shares` (availableShares 복원)
4. Open Orders에서 해당 주문 제거
5. 성공 메시지 표시

**결과/피드백**:
- 성공: 토스트 "Order cancelled", 잔액 복구, 주문 목록에서 제거

**예외 처리**:
| 에러 케이스 | 대응 |
|------------|------|
| 주문 미존재 | 주문 목록 자동 새로고침 후 에러 토스트 표시 |

**연관 기능**: Trade Execution, Open Orders Display

---

### 5.3 마이크로 인터랙션 정의

#### 오더북 가격 클릭

**트리거**: 오더북의 가격 행 클릭
**동작**:
1. Order Type이 "Limit"으로 자동 변경
2. Price Input에 클릭한 가격 자동 입력
**UI 반응**: Price Input 필드 하이라이트, 값 변경
**타이밍**: 즉시

---

#### 카운트다운 타이머 (Up/Down 마켓)

**트리거**: Up/Down 마켓 진입
**동작**:
1. 실제 Up/Down 이벤트의 라운드 종료 시간 기준 카운트다운 시작 [임시: 60초]
2. 매초 1씩 감소
3. 0 도달 시 다음 라운드 시작 (새 라운드 카운트다운 시작)
**UI 반응**: "Closes in" 값 실시간 업데이트 (MM:SS 형식)
**타이밍**: 1초 간격 업데이트
**참고**: 카운트다운 시간은 실제 Up/Down 이벤트 설정에 따라 결정됨 (1min, 5min, 15min 라운드)

---

#### 차트 호버 데이터 표시

**트리거**: 차트 영역 마우스 호버
**동작**:
1. 해당 시점의 Yes/No 퍼센트 값 추출
2. 차트 상단 버튼에 해당 값 표시
**UI 반응**: Yes/No 버튼 텍스트에 호버 시점 값 표시
**타이밍**: 즉시, 마우스 이동 따라 업데이트

---

#### 거래 성공 토스트

**트리거**: 거래 실행 성공
**동작**:
1. 성공 메시지 토스트 표시
2. 자동 사라짐
**UI 반응**: 화면 하단/상단에 녹색 토스트 메시지
**타이밍**: 3초 후 자동 닫힘

---

#### 거래 실패 토스트

**트리거**: 거래 실행 실패
**동작**:
1. 에러 메시지 토스트 표시
2. 자동 사라짐
**UI 반응**: 화면 하단/상단에 빨간색 토스트 메시지
**타이밍**: 3초 후 자동 닫힘

---

#### 드롭다운 외부 클릭 닫기

**트리거**: 드롭다운이 열린 상태에서 외부 영역 클릭
**동작**: 드롭다운 닫힘
**UI 반응**: 드롭다운 메뉴 숨김
**타이밍**: 즉시

---

#### 클립보드 복사 피드백

**트리거**: Copy 버튼 클릭 (지갑 주소)
**동작**:
1. 클립보드에 텍스트 복사
2. 아이콘 변경 (Copy → Check)
3. 원래 아이콘으로 복구
**UI 반응**: Copy 아이콘 → Check 아이콘 (녹색)
**타이밍**: 2초 후 원래 아이콘 복구

---

#### 호버 효과 목록

| 요소 | 트리거 | 인터랙션 |
|------|--------|----------|
| 마켓 카드 | 마우스 호버 | 카드 시각적 피드백 (상세 디자인 참조) |
| Yes/No, Up/Down 버튼 | 마우스 호버 | 버튼 시각적 피드백 (상세 디자인 참조) |
| GNB 메뉴 | 마우스 호버 | 메뉴 텍스트 색상 변경 |
| GNB 버튼 | 마우스 호버 | 버튼 배경색 변경 |
| 오더북 행 | 마우스 호버 | 행 하이라이트 |
| 포지션/주문 테이블 행 | 마우스 호버 | 행 하이라이트 |

---

#### 탭 전환

**트리거**: 탭 버튼 클릭
**동작**: 해당 탭 컨텐츠 표시
**UI 반응**:
- 선택된 탭 버튼 하단에 흰색 라인 (Underline)
- 이전 탭 컨텐츠 숨김, 새 탭 컨텐츠 표시
**타이밍**: 즉시

---

## 6. 비기능 요구사항

서비스 품질과 관련된 요구사항을 정의합니다.

### 6.1 성능 요구사항

| 항목 | 목표 | 측정 방법 |
|------|------|----------|
| API 응답 시간 | 평균 500ms 이내 | P95 기준 |
| 초기 페이지 로드 | 3초 이내 | LCP (Largest Contentful Paint), 3G 환경 기준 |
| 차트 렌더링 | 60fps 유지 | 가격 차트 인터랙션 시 |
| 오더북 업데이트 | 1초 이내 | 주문 체결 후 UI 반영 시간 |
| 거래 체결 응답 | 5초 이내 | 블록체인 트랜잭션 제출부터 UI 피드백까지 |

### 6.2 보안 요구사항

| 항목 | 요구사항 |
|------|----------|
| 지갑 연결 | EIP-1193 표준 준수, 사용자 명시적 승인 필수 |
| 트랜잭션 서명 | 모든 거래는 사용자 지갑에서 서명, 서버에서 private key 보관 금지 |
| 데이터 전송 | HTTPS 필수, API 통신 암호화 |
| XSS 방지 | React 기본 이스케이핑 적용, dangerouslySetInnerHTML 사용 금지 |
| CSRF 방지 | 지갑 서명 기반 인증으로 CSRF 토큰 불필요 |

### 6.3 접근성 요구사항

| 항목 | 요구사항 |
|------|----------|
| 키보드 네비게이션 | 모든 인터랙티브 요소 Tab 키로 접근 가능 |
| 포커스 표시 | 포커스된 요소 명확한 시각적 표시 |
| 색상 대비 | WCAG 2.1 AA 준수 (최소 대비율 4.5:1) |
| 스크린 리더 | 주요 버튼 및 입력 필드에 aria-label 적용 |
| 반응형 디자인 | 320px ~ 3840px 해상도 지원 |

### 6.4 신뢰성 요구사항

| 항목 | 요구사항 |
|------|----------|
| 서비스 가용성 | 99.5% 이상 (월 3.6시간 이하 다운타임) |
| 데이터 정합성 | 주문/체결 데이터 DB-Redis 간 동기화 보장 |
| 에러 복구 | 블록체인 트랜잭션 실패 시 자동 재시도 (최대 3회) |
| 데이터 백업 | 일일 자동 백업, 7일 보관 |

### 6.5 확장성 요구사항

| 항목 | 요구사항 |
|------|----------|
| 동시 접속자 | 1,000명 이상 지원 |
| 주문 처리량 | 초당 100건 이상 (매칭엔진 기준) |
| 데이터 증가 | 연간 100만 건 이상의 주문/체결 데이터 저장 가능 |

---

## 7. 정보 구조

서비스에서 다루는 핵심 정보와 그 관계를 정의합니다.

### 6.1 핵심 정보 항목

#### 마켓 정보

사용자에게 표시되는 마켓 관련 정보입니다.

| 정보 항목 | 설명 | 표시 위치 |
|----------|------|----------|
| 이벤트 제목 | 예측 대상 이벤트명 | 마켓 카드, 상세 페이지 |
| 썸네일 | 이벤트 대표 이미지 | 마켓 카드, 상세 페이지 |
| 카테고리 | Crypto / Politics / Sports / Macro / Culture | 마켓 카드, 필터 |
| 상태 | Active / Upcoming / Closed | 마켓 카드, 필터 |
| 마켓 타입 | single-once-binary / single-series-binary / multi-once-binary / multi-series-binary | 상세 페이지 |
| 거래량 | 누적 거래 금액 | 마켓 카드, 상세 페이지 |
| 종료일 | 마켓 종료 일시 | 마켓 카드, 상세 페이지 |
| 남은 시간 | 종료까지 남은 시간 | 마켓 카드, 상세 페이지 |
| 가격 변동률 | 24시간 가격 변동 % | 마켓 카드 |
| 설명 | 마켓 상세 설명 | 상세 페이지 |

#### 마켓 옵션 정보 (multi-once-binary / multi-series-binary)

| 정보 항목 | 설명 | 표시 위치 |
|----------|------|----------|
| 옵션 이름 | 베팅 선택지명 (예: Seattle, New England) | 상세 페이지 드롭다운 |
| 현재 확률 | 해당 옵션의 예측 확률 (%) | 상세 페이지 |
| Yes 가격 | Yes 쉐어 현재가 ($) | 상세 페이지, 오더북 |
| No 가격 | No 쉐어 현재가 ($) | 상세 페이지, 오더북 |
| 결과 | 종료된 마켓의 최종 결과 | 상세 페이지 |

#### 라운드 정보 (single-series-binary / multi-series-binary)

| 정보 항목 | 설명 | 표시 위치 |
|----------|------|----------|
| 라운드 번호 | 라운드 식별 번호 | 라운드 드롭다운 |
| 라운드 상태 | Active / Closed | 라운드 드롭다운 |
| 기준 가격 | 라운드 시작 시점 자산 가격 | 상세 페이지 |
| 현재 가격 | 현재 자산 가격 | 상세 페이지 |
| Up/Down 확률 | 각 방향 예측 확률 (%) | 상세 페이지 |
| 남은 시간 | 라운드 종료까지 카운트다운 | 상세 페이지 |
| 결과 | 종료된 라운드의 최종 결과 (Up/Down) | 상세 페이지 |

#### 사용자 포지션 정보

| 정보 항목 | 설명 | 표시 위치 |
|----------|------|----------|
| 이벤트명 | 포지션이 속한 이벤트 | Portfolio, 상세 페이지 |
| 마켓명 | 포지션이 속한 마켓 (Single은 "-") | Portfolio |
| Side | 포지션 방향 (Yes/No/Up/Down) | Portfolio, 상세 페이지 |
| 보유 쉐어 | 보유한 쉐어 수량 | Portfolio, 상세 페이지 |
| 평균 매입가 | 평균 구매 가격 ($) | Portfolio, 상세 페이지 |
| 현재가 | 현재 쉐어 가격 ($) | Portfolio, 상세 페이지 |
| 시장 가치 | 현재 포지션 가치 (CROSSD) | Portfolio, 상세 페이지 |
| 손익 | 수익/손실 금액 및 % | Portfolio, 상세 페이지 |
| 종료일 | 해당 마켓 종료일 | Portfolio |

#### 주문 정보

| 정보 항목 | 설명 | 표시 위치 |
|----------|------|----------|
| 이벤트명 | 주문이 속한 이벤트 | Portfolio, 상세 페이지 |
| 마켓명 | 주문이 속한 마켓 | Portfolio |
| Side | 주문 방향 (Yes/No/Up/Down) | Portfolio, 상세 페이지 |
| 유형 | Buy / Sell | Portfolio, 상세 페이지 |
| 주문 수량 | 주문한 쉐어 수량 | Portfolio, 상세 페이지 |
| 체결 수량 | 체결된 쉐어 수량 | Portfolio, 상세 페이지 |
| 주문 가격 | 지정한 가격 ($) | Portfolio, 상세 페이지, 오더북 |
| 총 금액 | 주문 총액 (CROSSD) | Portfolio, 상세 페이지 |
| 주문 시간 | 주문 생성 일시 | Portfolio, 상세 페이지 |

#### 거래 내역 정보

| 정보 항목 | 설명 | 표시 위치 |
|----------|------|----------|
| 이벤트명 | 거래가 발생한 이벤트 | Portfolio, 상세 페이지 |
| 마켓명 | 거래가 발생한 마켓 | Portfolio |
| Side | 거래 방향 (Yes/No/Up/Down) | Portfolio, 상세 페이지 |
| 유형 | Buy / Sell / Split / Merge | Portfolio, 상세 페이지 |
| 거래 수량 | 거래된 쉐어 수량 | Portfolio, 상세 페이지 |
| 체결 가격 | 체결된 가격 ($) | Portfolio, 상세 페이지 |
| 총 금액 | 거래 총액 (CROSSD) | Portfolio, 상세 페이지 |
| 수수료 | Taker 수수료 (CROSSD) | Portfolio, 상세 페이지 |
| 거래 시간 | 거래 체결 일시 | Portfolio, 상세 페이지 |

#### 사용자 계정 정보

| 정보 항목 | 설명 | 표시 위치 |
|----------|------|----------|
| 지갑 주소 | 연결된 지갑 주소 | GNB, Portfolio |
| CROSSD 잔액 | 사용 가능 CROSSD | GNB, Portfolio, 거래 패널 |
| Total Equity | 총 자산 가치 (Available + In Orders + Shares Value) | Portfolio |
| Total PnL | 전체 손익 | Portfolio |
| In Orders | 미체결 Buy 주문 잠금 금액 합계 | Portfolio |
| totalShares | 마켓별 총 보유 Shares | Portfolio, 거래 패널 |
| lockedShares | Limit Sell에 잠긴 Shares | Portfolio, 거래 패널 |
| availableShares | totalShares − lockedShares (거래 가능) | Portfolio, 거래 패널 |
| totalCost | 마켓별 누적 매입 원가 | Portfolio |

### 6.2 정보 간 관계

서비스 내 주요 정보들의 관계를 설명합니다.

```
사용자 (User)
├── 보유 자산
│   ├── CROSSD 잔액 (Available)
│   ├── In Orders (미체결 Buy 잠금 금액)
│   ├── 활성 마켓 포지션들 (totalShares, lockedShares, availableShares, totalCost)
│   └── 종료 마켓 포지션들
├── 주문
│   └── 활성 마켓 미체결 주문들 (GTC)
├── 거래 내역
│   └── Buy / Sell / Split / Merge 기록
└── Maker Rebate
    └── 체결 시 자동 지급된 리베이트 내역

마켓 (Market)
├── 기본 정보
│   ├── 제목, 썸네일, 카테고리
│   ├── 상태 (ACTIVE / PENDING_APPROVAL / RESOLVED / REDEEMABLE / CANCELLED)
│   ├── 타입 (single-once-binary / single-series-binary / multi-once-binary / multi-series-binary)
│   └── 거래량, 종료일
├── 마켓 옵션들 (multi-once-binary / multi-series-binary)
│   └── 각 옵션별 Yes/No 가격
├── 라운드들 (single-series-binary / multi-series-binary)
│   └── 각 라운드별 Up/Down 가격
├── 오라클/정산
│   ├── Route A: UMA + Polymarket API 이중 검증 (1시간 쿨링)
│   └── Route B: Chainlink Data Streams (즉시 정산)
└── 오더북
    ├── Ask (매도 주문) 목록
    └── Bid (매수 주문) 목록
```

### 6.3 화면별 필요 정보

각 화면에서 필요로 하는 정보를 정리합니다.

| 화면 | 필요 정보 |
|------|----------|
| Events | 마켓 목록 (제목, 썸네일, 카테고리, 상태, 거래량, 종료일, Yes/No 가격) |
| Market Detail | 마켓 상세, 옵션/라운드, 오더북, 차트 데이터, 내 포지션/주문/내역 |
| Portfolio | 사용자 자산 현황 (Available, In Orders, Shares Value), 포지션 목록, 주문 목록, 거래 내역, Rebate 내역 |

---

## 8. 기술 스택

> **참고**: 기술 스택의 상세 명세(프레임워크 버전, 라이브러리 선택, 아키텍처 설계 등)는 **system-design 작업**에서 정의됩니다.

### 8.1 기술 스택 개요

본 프로젝트는 다음과 같은 주요 기술 영역으로 구성됩니다:

**프론트엔드:**
- SSR(Server-Side Rendering) 프레임워크 사용 권장
- Cross SDK (`@to-nexus/sdk/react`) 통합 필수
  - 참고 예제: https://github.com/to-nexus/cross-sdk-js/tree/main/examples/sdk-react
- 필수: Cross SDK 사용위해선 .npmrc 에 아래 레지스트리를 등록해야함
  - @to-nexus:registry=https://package.cross-nexus.com/repository/cross-sdk-js

**백엔드:**
- API 서버, 매칭엔진, Processor 구성
- 메시지 큐 기반 이벤트 처리
- 관계형 데이터베이스 및 캐시 사용

**블록체인:**
- EVM 호환 체인
- PredictionExchange 컨트랙트 (CTF Exchange 기반)
- ERC-1155 (Conditional Tokens), ERC-20 (Collateral) 표준

상세한 기술 스택 명세는 system-design 문서를 참조하십시오.

---

## 9. 부록

### 9.1 화면별 주요 기능

| 화면명 | 주요 기능 |
|--------|----------|
| Events | GNB, 카테고리/상태/정렬 필터, 마켓 카드 클릭 |
| Market Detail | 차트, 오더북, 거래 패널, Split/Merge, 포지션/주문/내역 탭 |
| Portfolio | 자산 현황 카드, 포지션/주문/내역 탭, 주문 취소 (CROSSD/Shares 반환), PnL 공유 |
| Wallet Connect Modal | CROSSx/CROSSx Desktop 연결 옵션 — Embedded Wallet Coming Soon 표시 |
| GeoBlock Modal | 차단 지역 접속 시 서비스 이용 제한 안내 (지갑 연결 시 + 거래 시도 시) |

### 9.2 MarketType 분류

| 타입 | 마켓 수 | 라운드 | Pair 수 | 설명 | 예시 |
|------|:------:|:-----:|:------:|------|------|
| single-once-binary | 1 | 없음 | 2 | 단일 마켓, 단일 주기 | 정부 셧다운 예측 |
| single-series-binary | 1 | 있음 | 2 | 단일 마켓, 라운드 반복 (크립토 업다운) | BTC 1min Up/Down |
| multi-once-binary | N | 없음 | 2 | 복수 마켓, 단일 주기 (폴리마켓 멀티 이벤트) | Fed Chair 후보 예측 |
| multi-series-binary | N | 있음 | 2 | 복수 마켓, 라운드 반복 | TBD |

**타입 자동 전환:** 이벤트의 마켓 수가 변동되면 시스템이 자동으로 타입을 전환한다. 마켓 추가 시 single→multi (예: single-once-binary → multi-once-binary), 마켓 삭제/비활성화로 활성 마켓이 1개로 감소하면 multi→single 역전환 (예: multi-once-binary → single-once-binary). 라운드 속성(once/series)은 이벤트 생성 시 확정되며 변경 불가.

**마켓 내부 상태 (시스템):**

| 시스템 상태 | 프론트엔드 표시 | 설명 |
|------------|---------------|------|
| ACTIVE | Active | 거래 가능 |
| PENDING_APPROVAL | Closed | 결과 확인 중 — 관리자 승인 대기 |
| RESOLVED | Closed | 정산 완료, 리딤 전용 (매수/매도 불가) |
| REDEEMABLE | Closed | 리딤 가능 |
| CANCELLED | Closed | 취소됨, totalCost 환불 (수수료 제외) |

### 9.3 single-series-binary 마켓 자산 및 타임프레임

| Asset | Timeframes |
|-------|------------|
| BTC | 1min, 5min, 15min |
| ETH | 1min, 5min, 15min |
| SOL | 1min, 5min, 15min |

**Price Oracle**: 미정

### 9.4 수수료 계산 공식

**Taker 수수료 (Market Order 및 즉시 매칭 Limit Order):**
```
fee = total × k × p × (1 - p)

- total: 거래 금액 (shares × price)
- k: 이벤트 카테고리별 설정값 (Crypto/Politics/Sports/Macro/Culture)
- p: 가격 (0.001~0.999 범위)
```

예시: 100 shares @ $0.650 (p=0.65)
- total = 100 × 0.65 = 65 CROSSD
- fee = 65 × 2 × 0.65 × 0.35 = 29.575 CROSSD

**Maker 수수료:** 없음 (0)

**Maker Rebate:**
- Taker 수수료의 일정 비율을 Maker에게 자동 지급 (별도 Claim 불필요)
- 체결 시점에 즉시 지급
- Rebate 비율은 스마트 컨트랙트에서 마켓 타입별 설정 (Admin은 조회만 가능)
- 복수 Maker 체결 시 각 Maker의 유동성 기여분에 비례 배분

### 9.5 오라클 및 정산 참조

본 PRD에서 다루는 거래 및 UI 기능의 근간이 되는 오라클/정산 구조는 별도 정책서에서 상세히 정의합니다.

| 경로 | 대상 | 오라클 | 정산 타이밍 |
|------|------|--------|-----------|
| Route A (DUAL_VERIFY) | 폴리마켓 이벤트 | UMA Optimistic Oracle + Polymarket API 이중 검증 | 이중 검증 일치 후 1시간 쿨링 |
| Route B (CHAINLINK_DATA_STREAMS) | 크립토 가격 마켓 | Chainlink Data Streams | 즉시 정산 |

> **Price Oracle (§9.3 참고)**: single-series-binary 마켓은 Chainlink Data Streams (Route B)를 사용합니다.

### 9.6 변경 이력

| 버전 | 일자 | 작성자 | 변경 내용 |
|:----:|:----:|:------:|----------|
| 0.1 | 2026-02-06 | - | 초기 PRD 작성 |
| 0.2 | 2026-02-09 | - | Cross SDK 및 Next.js SSR 기술 스택 추가 |
| 0.3 | 2026-02-09 | - | 평가서 기반 개선: 비목표 섹션 추가, 비기능 요구사항 추가, 기술 스택 system-design 위임, [ASSUMPTION] 항목 명확화 |
| 1.0 | 2026-03-03 | - | 정책서 기반 전면 수정: VIP/리더보드/레퍼럴 삭제, Taker/Maker 수수료, Limit Sell 잠금, Maker Rebate (컨트랙트 설정), 오라클·정산 참조, 마켓 4타입 분류 및 자동 전환, GeoBlock 2단계 검증, Redeem 기능 정의, 가격 범위 $0.001~$0.999 |


---
---

# Part 2: PRD 요구사항 확인서




# PRD 요구사항 확인서

> 이 문서는 [prd.md](prd.md)에서 추출한 요구사항을 체크리스트 형식으로 정리한 것입니다.

---

## 0. 문제/목표

### 0.1 문제
- 론칭 후 사용자를 효과적으로 유치할 방법 모색

### 0.2 목표
- 폴리마켓에 공개된 이벤트, 마켓 등을 크롤링하여 우리 서비스에도 제공
- 폴리마켓과 우리마켓의 가격차를 이용하려는 유저들이 자연스럽게 유입

### 0.3 비목표 (이번에 하지 않는 것)
- Admin 모듈은 별도 스펙으로 개발

---

## 1. 기능 요구사항 (Functional Requirements)

### 1.1 사용자 기능

- [ ] **FR-001**: 이벤트 리스트 조회 및 관심 분야 이벤트 선택 기능
- [ ] **FR-002**: 마켓 내 토큰(Yes/No) 선택 후 매수 기능
- [ ] **FR-003**: 보유 토큰 매도 기능
- [ ] **FR-004**: 이벤트 종료 후 정산을 통한 CROSSD 교환 (정답 토큰 1개 = 1 CROSSD)

### 1.2 토큰/거래 시스템

- [ ] **FR-005**: ERC1155 tid 매핑 구조 (이벤트 > 마켓 > 토큰)
- [ ] **FR-006**: CTF Exchange 컨트랙트 연동 ([Polymarket/ctf-exchange](https://github.com/Polymarket/ctf-exchange))
- [ ] **FR-007**: 토큰 가격 범위 0.00 ~ 1.00 적용

### 1.3 데이터 연동

- [ ] **FR-008**: Polymarket 이벤트 데이터 크롤링 ([docs.polymarket.com](https://docs.polymarket.com/quickstart/fetching-data))
- [ ] **FR-009**: Polymarket 정답 데이터 크롤링
- [ ] **FR-010**: Polymarket 가격정보 노출 (시세 차익 효과 제공)

### 1.4 Admin 모듈

- [ ] **FR-011**: Polymarket에서 크롤링한 이벤트 중 원하는 이벤트 선택 및 서비스 등록 기능

---

## 2. 매칭엔진 요구사항

### 2.1 주문 처리

- [ ] **ME-001**: EIP-712 서명 기반 주문 수신
- [ ] **ME-002**: 주문 메시지 규격 구현
  - event (address): 예측 시장 컨트랙트 주소
  - tokenType (uint8): 0=Yes, 1=No
  - side (uint8): 0=Buy, 1=Sell
  - price (uint256): 주문 가격 (Market Buy: MAX, Market Sell: 0)
  - base amount (uint256): 주문 수량
  - quote amount (uint256): 주문 총액 (Market Buy용)
  - deadline (uint256): 주문 유효 마감시간
  - nonce (uint256): 계정별 주문 고유 번호

### 2.2 데이터베이스

- [ ] **ME-003**: 매수(Buy) 테이블 정렬 - Price DESC, IDENTITY ASC
- [ ] **ME-004**: 매도(Sell) 테이블 정렬 - Price ASC, IDENTITY ASC
- [ ] **ME-005**: 주문 추가 필드 관리
  - OrderHash, Timestamp, Owner, IDENTITY
  - FilledAmount, FilledNotional, Status (Active/Cancelled/FullyFilled)

### 2.3 사전 리스크 관리

- [ ] **ME-006**: 매 블록마다 유저별 주문 그룹화
- [ ] **ME-007**: 우선순위 정렬 (가격 및 nonce순)
- [ ] **ME-008**: 누적 자산 검증 (온체인 잔고/승인량 조회)
- [ ] **ME-009**: 자금 부족 주문 자동 Cancelled 처리

### 2.4 매칭 로직 (3단계)

- [ ] **ME-010**: Step 1 - 일반 매칭 (Complementary Matching)
  - Buy Yes vs Sell Yes
  - Buy No vs Sell No
  - 조건: 매수가 >= 매도가
- [ ] **ME-011**: Step 2 - Mint 매칭 (발행)
  - Buy Yes vs Buy No
  - 조건: Buy Yes Price + Buy No Price >= $1.0
- [ ] **ME-012**: Step 3 - Merge 매칭 (소각)
  - Sell Yes vs Sell No
  - 조건: Sell Yes Price + Sell No Price <= $1.0

### 2.5 트랜잭션 처리

- [ ] **ME-013**: matchOrders() 트랜잭션 생성 (일반 매칭)
- [ ] **ME-014**: mintMatch() 트랜잭션 생성 (Mint 매칭)
- [ ] **ME-015**: mergeMatch() 트랜잭션 생성 (Merge 매칭)
- [ ] **ME-016**: 트랜잭션 실패 시 다음 Maker로 진행 (try-catch 또는 return false)
- [ ] **ME-017**: 다음 블록에서 남은 물량 재처리

### 2.6 정산 및 이벤트 처리

- [ ] **ME-018**: 블록체인 이벤트 모니터링 (LogTrade, LogMint, LogMerge)
- [ ] **ME-019**: FilledAmount/FilledNotional 필드 업데이트
- [ ] **ME-020**: 완전 체결 시 Status를 FullyFilled로 변경 및 아카이브 이동

### 2.7 주문 취소

- [ ] **ME-021**: Soft Cancel - DB Status를 Cancelled로 변경
- [ ] **ME-022**: Hard Cancel - incrementMinNonce() 온체인 호출
- [ ] **ME-023**: 컨트랙트 레벨 Nonce 검증 (CurrentNonce < MinNonce 시 Revert)

### 2.8 프론트엔드 표현

- [ ] **ME-024**: 교차 오더북 처리 - 잠정적 체결로 간주하여 UI에서 교차되지 않게 출력

---

## 3. 시스템 아키텍처

### 3.1 모듈 구성

- [ ] **AR-001**: Front 모듈 - React, TypeScript (UX 제공)
- [ ] **AR-002**: API 서버 - Golang (백엔드 API 제공)
- [ ] **AR-003**: 매칭엔진 - Golang (주문 매칭 처리)
- [ ] **AR-004**: 폴리마켓 크롤러 - 폴리마켓의 이벤트/마켓 정보 수집, 정답 공개 시 우리 마켓에도 처리
- [ ] **AR-005**: Admin 모듈 - 이벤트/마켓/토큰 관리, 크롤링된 이벤트의 Front 노출 여부 결정 (별도 스펙)

### 3.2 데이터 흐름

```mermaid
flowchart LR
    Front[Front\nReact/TS] --> API[API Server\nGolang]
    API --> MQ[Message Queue]
    MQ --> Engine[Matching Engine\nGolang]
    Engine --> Chain[Blockchain\nCTF Exchange]
    Crawler[Polymarket Crawler] -.->|크롤링| Polymarket[Polymarket API]
    Crawler --> DB[(Database)]
    Admin[Admin Module] --> API
    Admin --> DB
```

---

## 4. 비기능 요구사항 (Non-Functional Requirements)

### 4.1 성능

- [ ] **NFR-001**: 목표 TPS: 2,000 ~ 5,000

### 4.2 보안

- [ ] **NFR-002**: 주문 API EIP-712 서명 필수

### 4.3 가용성

- [ ] **NFR-003**: API 서버 Auto-scale 지원
- [ ] **NFR-004**: 매칭엔진 Message Queue 기반 안정적 처리

### 4.4 안정성

- [ ] **NFR-005**: 서버 재기동 시 데이터 보존
- [ ] **NFR-006**: 데이터 정합성 유지 보장
- [ ] **NFR-007**: 토큰 무한 생성에 대비한 메모리 효율적 관리
- [ ] **NFR-008**: 매칭엔진 자체 주문 처리 판단 로직 설계

---

## 요약

| 카테고리 | 요구사항 수 |
|----------|-------------|
| 기능 요구사항 (FR) | 11개 |
| 매칭엔진 (ME) | 24개 |
| 아키텍처 (AR) | 5개 |
| 비기능 요구사항 (NFR) | 8개 |
| **총계** | **48개** |


---
---

# Part 3: Matching Engine (README)

# Cross Prediction Market Matching Engine

Polymarket 스타일의 예측 시장을 위한 고성능 매칭 엔진입니다. Yes/No 바이너리 옵션에 대한 주문을 매칭하고, PredictionExchange 컨트랙트와 연동하여 체결을 처리합니다.

## 개요

이 매칭 엔진은 다음과 같은 특징을 가집니다:

- **이벤트 기반 아키텍처**: 모든 주문 처리 및 상태 변경을 이벤트로 발행하여 외부 시스템과 느슨하게 결합
- **컨트랙트 기반 정산**: 장부거래로 인한 사후 정산이 아닌 PredictionExchange 스마트 컨트랙트를 통해 즉각 체결 정산
- **비동기 처리**: Message Queue를 통한 주문 접수 및 이벤트 발행
- **플러그형 오더북 저장소**: Local(인메모리) 또는 Redis 중 선택 가능한 오더북 구현
- **사전 리스크 검증**: 매칭 전 온체인 잔고/허용량 검증으로 Revert 최소화
- **Operator 서명 분리**: TX sender와 Operator 서명 키를 분리하여 보안 강화 및 다중 인스턴스 지원
- **이벤트별 동적 구독**: 서버 인덱스 기반으로 이벤트(마켓)별 큐를 동적 구독

## 시스템 아키텍처

```
┌─────────────┐                ┌────────────────┐                ┌─────────────────┐
│  API Server │ ──pub(order)──>│  Message Queue │ ──sub(order)──>│ Matching Engine │
│             │                │                │ <──pub(event)──│                 │
└─────────────┘                └────────────────┘                └────────┬────────┘
                                       │                                  │
                                       │                                  │ ┌─────────────────┐
                                       │ pub (events)                     ├─┤ Local (Memory)  │
                                       │                                  │ │   or Redis      │
                                       │                                  │ └─────────────────┘
                                       │                                  │ (Orderbook Storage)
                                       │                                  │
                                       │                                  │ matchOrdersWithSignature()
                                       ▼                                  ▼
                                  ┌──────────┐                  ┌───────────────────┐
                                  │Processor │                  │ PredictionExchange│
                                  │(External)│                  │     Contract      │
                                  └──────────┘                  └───────────────────┘
```

### 키 분리 아키텍처

| 구분 | Validator Key (keystore) | TX Sender Key (mnemonic) |
|------|--------------------------|--------------------------|
| 역할 | OPERATOR_ROLE 보유 | 권한 불필요 |
| 용도 | EIP-712 서명 생성 | TX 전송 |
| 특징 | 오프라인 서명만 사용 | Gas 비용 지불 |
| 장점 | 노출 위험 최소화 | 다중 인스턴스 독립 운영 |

```
matchOrdersWithSignature(
    orders,
    fillAmounts,
    takerSignature,    <- Signed by Validator Key
    makerSignatures[], <- Signed by Validator Key
    validatorAddress   <- Address with OPERATOR_ROLE
)

└──> Sent by TX Sender Key
```

### 데이터 흐름

1. **주문 접수**: API 서버 → Message Queue (`orders_{event_slug}`) → Matching Engine
2. **주문 저장**: Matching Engine → Orderbook Repository (Local 또는 Redis)
3. **매칭 처리**: Matching Engine → Orderbook Repository 조회 → Matching Logic
4. **리스크 검증**: Matching Engine → 온체인 잔고/허용량 확인 (RiskService)
5. **서명 생성**: Matching Engine → Validator Key로 EIP-712 서명 생성
6. **체결 실행**: Matching Engine → TX Sender Key로 `matchOrdersWithSignature()` 호출
7. **이벤트 발행**: Matching Engine → RabbitMQ → External Processor

## 프로젝트 구조

```
prediction-market-matching-engine/
├── cmd/
│   ├── main.go                    # Entry point (mnemonicIndex flag 지원)
│   ├── app/
│   │   └── app.go                 # Application lifecycle management
│   └── config.toml                # Configuration file
├── internal/
│   ├── config/
│   │   └── config.go              # Configuration parsing
│   ├── contracts/
│   │   ├── prediction_exchange.go # PredictionExchange contract binding
│   │   ├── conditional_tokens.go  # ConditionalTokens (ERC1155) binding
│   │   └── ierc20.go              # IERC20 contract binding
│   ├── types/
│   │   ├── order.go               # Order structure (based on CTF Exchange)
│   │   ├── orderbook.go           # Orderbook summary types
│   │   ├── event.go               # Queue event types & Match structure
│   │   ├── eip712.go              # EIP-712 typed data hashing & signing
│   │   ├── const.go               # Constants (Side, MatchType, EventType)
│   │   └── errors.go              # Error definitions
│   ├── repository/
│   │   ├── interface.go           # OrderbookRepository interface
│   │   └── impl/
│   │       ├── orderbook_local.go # In-memory orderbook implementation
│   │       └── orderbook_redis.go # Redis orderbook implementation
│   └── service/
│       ├── orderbook_service.go   # Orderbook management & matching logic
│       ├── queue_service.go       # Queue subscription & order processing
│       ├── risk_service.go        # Pre-match balance/allowance validation
│       └── service_test.go        # Integration tests
```

## 핵심 컴포넌트

### 1. Order Type (`internal/types/order.go`)

PredictionExchange 컨트랙트의 Order 구조를 Go로 구현합니다:

- `Salt`: Unique order identifier
- `Maker`: Order creator address
- `Signer`: Signature creator address
- `Taker`: Specific taker address (0x0 for anyone)
- `TokenID`: Prediction market outcome token ID
- `MakerAmount`: Amount maker provides
- `TakerAmount`: Amount maker wants
- `Expiration`: Order expiration timestamp
- `Nonce`: User nonce for cancellation
- `FeeRateBps`: Fee rate in basis points
- `Side`: BUY (0) or SELL (1)
- `SignatureType`: EOA, POLY_PROXY, or POLY_1271
- `Signature`: Order signature
- `OppositeTokenID`: Opposite outcome token ID (for MINT/MERGE matching)
- `CachedHash`: Pre-calculated EIP-712 hash

### 2. EIP-712 Signing (`internal/types/eip712.go`)

컨트랙트와 일치하는 EIP-712 해싱 및 서명 기능:

**Order Hash:**
```go
// Order(address maker,uint16 feeBps,uint8 side,uint256 makerAmount,uint256 takerAmount,uint256 tokenId,uint256 expiration,uint256 nonce,bytes32 salt)
OrderTypeHash = crypto.Keccak256Hash([]byte("Order(address maker,uint16 feeBps,uint8 side,uint256 makerAmount,uint256 takerAmount,uint256 tokenId,uint256 expiration,uint256 nonce,bytes32 salt)"))
```

**Operator Signatures:**
```go
// MatchTaker(bytes32 orderHash,uint256 fillAmount,uint256 salt,uint256 expiration)
MatchTakerTypeHash = crypto.Keccak256Hash([]byte("MatchTaker(bytes32 orderHash,uint256 fillAmount,uint256 salt,uint256 expiration)"))

// MatchMaker(bytes32 takerSignatureHash,bytes32 orderHash,uint256 fillAmount,uint256 expiration)
MatchMakerTypeHash = crypto.Keccak256Hash([]byte("MatchMaker(bytes32 takerSignatureHash,bytes32 orderHash,uint256 fillAmount,uint256 expiration)"))
```

**주요 함수:**
```go
SignMatchTaker(domain, orderHash, fillAmount, salt, expiration, privateKey) ([]byte, error)
SignMatchMaker(domain, takerSigHash, orderHash, fillAmount, expiration, privateKey) ([]byte, error)
```

### 3. Orderbook Service (`internal/service/orderbook_service.go`)

**책임:**
- TokenId별 BUY/SELL 오더북 관리 (Local 또는 Redis 저장소 사용)
- Price-Time Priority 매칭 알고리즘 구현
- COMPLEMENTARY, MINT, MERGE 3가지 매칭 타입 지원
- EIP-712 해시 계산 및 캐싱
- 주문 취소, 일괄 취소 처리
- Operator 서명 생성 및 `matchOrdersWithSignature()` 호출

**구조체:**
```go
type OrderbookService struct {
    orderbookRepo    repository.OrderbookRepository
    ethClient        *ethclient.Client
    exchange         *contracts.PredictionExchange
    transactOpts     *bind.TransactOpts     // TX Sender (mnemonic 파생)
    validatorKey     *ecdsa.PrivateKey      // Operator 서명용 (keystore)
    validatorAddress common.Address          // OPERATOR_ROLE 보유 주소
    eip712Domain     *types.EIP712Domain
}
```

**Redis 저장소 사용 시 데이터 구조:**
```
# Sorted Set - 가격-시간 우선순위 인덱스
orderbook_index:{tokenID}:{side}
  └── member: orderHash, score: price * 1e18 (BUY: 음수, SELL: 양수)

# Hash - 주문 데이터 저장
orders:{tokenID}:{side}
  └── field: orderHash
      value: {
        "salt": "12345...",
        "maker": "0xABC...",
        "signer": "0xABC...",
        "taker": "0x000...",
        "tokenId": "98765...",
        "makerAmount": "1000000000000000000",
        "takerAmount": "500000000000000000",
        "expiration": 1735689600,
        "nonce": "1",
        "feeRateBps": "100",
        "side": 0,
        "signatureType": 0,
        "signature": "0x...",
        "oppositeTokenId": "98766...",
        "createdAt": 1735600000,
        "remainingAmount": "1000000000000000000",
        "eventSlug": "super-bowl-2026",
        "marketSlug": "winner"
      }
```

**Local 저장소 사용 시 내부 구조:**
```go
// map["{tokenID}:{side}"] -> map[orderHash] -> orderEntry
orders map[string]map[string]*orderEntry
```

**주요 메서드:**
```go
AddOrder(ctx context.Context, order *types.Order) ([]*types.Match, error)
CancelOrder(ctx context.Context, tokenID string, side types.Side, orderHash common.Hash) error
CancelAllOrders(ctx context.Context, maker string) (*CancelAllOrdersResult, error)
ExecuteMatches(ctx context.Context, matches []*types.Match) error
GetOrderbookSummary(ctx context.Context, tokenID string, side types.Side) (*types.OrderbookSummary, error)
GetOrderHash(order *types.Order) common.Hash
```

### 4. Queue Service (`internal/service/queue_service.go`)

**책임:**
- Event별 Message Queue 동적 구독 (`orders_{event_slug}`)
- 서버 인덱스 기반 이벤트 할당 (MySQL에서 조회)
- 메시지 파싱 및 검증
- TokenID별 로컬 Mutex를 통한 동시성 제어
- Orderbook Service로 주문 전달
- 매칭 전 RiskService를 통한 잔고 검증
- 오더북 변경 이벤트 발행
- 주기적 구독 갱신 (새 이벤트 구독, 제거된 이벤트 해제)

**구독 방식:**
```go
// 서버 시작 시
eventSlugs := eventRepo.GetEventSlugsForServer(ctx, serverIndex)
for _, slug := range eventSlugs {
    subscribeToEvent(slug)  // orders_{slug} 큐 구독
}

// 주기적 갱신 (30초마다)
refreshSubscriptions(ctx)  // 새 이벤트 구독, 제거된 이벤트 해제
```

**지원 액션:**
- `add`: 주문 추가
- `cancel`: 개별 주문 취소
- `cancel_all`: Maker별 전체 주문 취소

**메시지 구조체:**

`add` - 주문 추가:
```json
{
  "action": "add",
  "tokenId": "68885395636897...",
  "salt": "12345678901234567890",
  "maker": "0x7099...79C8",
  "signer": "0x7099...79C8",
  "taker": "0x0000...0000",
  "makerAmount": "500000000000000000",
  "takerAmount": "1000000000000000000",
  "expiration": 4923331200,
  "nonce": "0",
  "feeRateBps": "0",
  "side": 0,
  "signatureType": 0,
  "signature": "0xabcd...1234",
  "oppositeTokenId": "68885395636898...",
  "eventSlug": "super-bowl-2026",
  "marketSlug": "winner"
}
```

`cancel` - 개별 주문 취소:
```json
{
  "action": "cancel",
  "tokenId": "68885395636897...",
  "side": 0,
  "orderHash": "0x1234...abcd"
}
```

`cancel_all` - Maker별 전체 주문 취소:
```json
{
  "action": "cancel_all",
  "maker": "0x7099...79C8",
  "tokenId": ""
}
```
- `tokenId`: 선택 사항. 비어있으면 해당 Maker의 모든 토큰 주문 취소, 값이 있으면 해당 토큰 주문만 취소

### 5. Risk Service (`internal/service/risk_service.go`)

**책임:**
- 매칭 전 온체인 잔고 검증 (Pre-Match Validation)
- Collateral Token (ERC20) 잔고 및 허용량 확인
- Conditional Token (ERC1155) 잔고 확인
- 온체인 주문 상태 확인 (취소 여부, 체결량)

**주요 메서드:**
```go
ValidateOrderForMatch(ctx context.Context, order *types.Order, orderHash common.Hash, fillAmount *big.Int) (bool, error)
```

**검증 항목:**
- BUY 주문: Collateral Token 잔고 및 Exchange 컨트랙트에 대한 allowance 확인
- SELL 주문: Conditional Token 잔고 확인
- 온체인 주문 취소 여부 및 기체결량 동기화

### 6. Repository Layer

#### Orderbook Repository Interface (`internal/repository/interface.go`)

오더북 저장소 인터페이스를 정의합니다. 두 가지 구현체를 제공합니다:

| 구현체 | 파일 | 용도 |
|--------|------|------|
| **LocalOrderbookRepository** | `impl/orderbook_local.go` | 인메모리 저장 (테스트, 단일 인스턴스) |
| **RedisOrderbookRepository** | `impl/orderbook_redis.go` | Redis 영속화 (프로덕션, 다중 인스턴스) |

**인터페이스 메서드:**
```go
type OrderbookRepository interface {
    AddOrder(ctx, order) error
    RemoveOrder(ctx, tokenID, side, orderHash) error
    GetOrder(ctx, tokenID, side, orderHash) (*Order, error)
    GetTopOrders(ctx, tokenID, side, limit) ([]*Order, error)
    OrderExists(ctx, tokenID, side, orderHash) (bool, error)
    UpdateOrder(ctx, order) error
    GetAllTokenIDs(ctx) ([]string, error)
    GetOrdersByMaker(ctx, maker) ([]*Order, error)
    FlushDB(ctx) error
    Ping(ctx) error
    Close() error
}
```

#### Local Orderbook Repository (`impl/orderbook_local.go`)

**특징:**
- 인메모리 저장 (재시작 시 데이터 소실)
- sync.RWMutex 기반 동시성 제어
- 테스트 및 개발 환경에 적합
- Redis 의존성 없이 동작

**내부 구조:**
```go
type LocalOrderbookRepository struct {
    mu     sync.RWMutex
    orders map[string]map[string]*orderEntry  // key: "{tokenID}:{side}" -> orderHash -> orderEntry
    log    *zap.Logger
}
```

#### Redis Orderbook Repository (`impl/orderbook_redis.go`)

**특징:**
- Redis 기반 영속화 (재시작 시 복구 가능)
- 다중 인스턴스 간 오더북 공유
- Sorted Set을 통한 가격-시간 우선순위 정렬
- 프로덕션 환경에 적합

**Redis 데이터 구조:**
```
# Sorted Set - 가격-시간 우선순위 인덱스
orderbook_index:{tokenID}:{side}
  └── member: orderHash, score: price * 1e18 (BUY: 음수, SELL: 양수)

# Hash - 주문 데이터 저장
orders:{tokenID}:{side}
  └── field: orderHash, value: JSON(Order)
```

#### 구현 선택 기준

| 상황 | 권장 구현 |
|------|----------|
| 로컬 테스트, 단일 인스턴스 | LocalOrderbookRepository |
| 프로덕션, 다중 인스턴스 | RedisOrderbookRepository |
| 블록체인 연동 없이 매칭 로직 테스트 | LocalOrderbookRepository |
| 재시작 시 오더북 복구 필요 | RedisOrderbookRepository |

#### Event Repository

**책임:**
- 서버 인덱스별 이벤트 할당 조회
- 이벤트-서버 매핑 관리

**주요 메서드:**
```go
GetEventSlugsForServer(ctx context.Context, serverIndex int) ([]string, error)
```

## 이벤트 타입

매칭 엔진은 다음 이벤트들을 Message Queue로 발행합니다:

| Event Type | Description |
|------------|-------------|
| `ORDER_ADDED` | 새 주문이 오더북에 추가됨 |
| `ORDER_CANCELLED` | 개별 주문이 취소됨 |
| `ORDER_ALL_CANCELLED` | Maker의 모든 주문이 취소됨 |
| `ORDER_MATCHED` | 주문이 매칭됨 (체결 실행 후) |

## 매칭 알고리즘

### Price-Time Priority

1. **가격 우선**: 더 나은 가격의 주문이 먼저 매칭
   - BUY: 높은 가격 우선
   - SELL: 낮은 가격 우선

2. **시간 우선**: 같은 가격이면 먼저 들어온 주문이 우선

3. **부분 체결**: 주문량이 부족하면 부분 체결 지원

### 매칭 타입 (PredictionExchange 기반)

- **COMPLEMENTARY** (0): BUY vs SELL 매칭 (동일 TokenID)
- **MINT** (1): YES BUY + NO BUY (가격 합 >= 1, 새로운 포지션 생성)
- **MERGE** (2): YES SELL + NO SELL (가격 합 <= 1, 포지션 합병)

### 사전 리스크 관리 (Pre-Matching Risk Engine)

RiskService가 매칭 실행 전 온체인 잔고를 검증합니다:

1. **온체인 상태 확인**: 
   - 주문 취소 여부 (`isCancelled`)
   - 기체결량 동기화 (`getFilledAmount`)

2. **잔고 검증**:
   - BUY: `min(collateralBalance, collateralAllowance) >= requiredCollateral`
   - SELL: `tokenBalance >= requiredTokenAmount && isApprovedForAll(maker, exchange)`

3. **검증 실패 시 처리**:
   - 해당 주문을 오더북에서 제거
   - `match_cancelled` 이벤트 발행
   - 다른 유효한 주문들과 매칭 계속 진행

## 다중 인스턴스 운영

### 이벤트 기반 샤딩

```
┌───────────────────────────────────────────────────────────────────┐
│                        MySQL (event_assignments)                  │
├───────────────────────────────────────────────────────────────────┤
│  event_slug      │  server_index  │  created_at                   │
├──────────────────┼────────────────┼───────────────────────────────┤
│  btc-100k-2026   │  0             │  2026-01-01 00:00:00          │
│  eth-5k-2026     │  0             │  2026-01-01 00:00:00          │
│  sol-500-2026    │  1             │  2026-01-01 00:00:00          │
│  trump-2028      │  1             │  2026-01-01 00:00:00          │
└──────────────────┴────────────────┴───────────────────────────────┘

┌─────────────────────┐    ┌─────────────────────┐
│ Matching Engine #0  │    │ Matching Engine #1  │
│ (--mnemonic-index=0)│    │ (--mnemonic-index=1)│
├─────────────────────┤    ├─────────────────────┤
│ sub:                │    │ sub:                │
│ • orders_btc-100k   │    │ • orders_sol-500    │
│ • orders_eth-5k     │    │ • orders_trump-2028 │
└─────────────────────┘    └─────────────────────┘
```

### 장점

| 기존 방식 (matchOrders) | 새 방식 (matchOrdersWithSignature) |
|------------------------|----------------------------------|
| TX sender가 OPERATOR_ROLE 필요 | TX sender는 권한 불필요 |
| Nonce 충돌 위험 (다중 인스턴스) | 각 인스턴스가 독립적 TX 전송 |
| OPERATOR 키가 TX에 노출 | Validator 키는 오프라인 서명만 |

## 설정 예시

```toml
# config.toml

[app]
name = "cross-prediction-market-matching-engine"
environment = "development"
price_decimals = 3  # 가격 표시 소수점 자릿수

# Redis 설정 (선택사항)
# - host가 비어있거나 [redis] 섹션이 없으면 Local(인메모리) 오더북 사용
# - host가 설정되어 있으면 Redis 오더북 사용
[redis]
host = "localhost"  # 빈 문자열이면 Local 모드
port = 6379
password = ""
database = 0

[mysql]
host = "localhost"
port = 3306
user = "root"
password = ""
database = "prediction_market"
max_open_conns = 10
max_idle_conns = 5
conn_max_lifetime_seconds = 300

[queue]
broker_url = "amqp://guest:guest@localhost:5672/"
username = ""
password = ""
order_queue_prefix = "orders_"  # 실제 큐: orders_{event_slug}
event_queue = "events"

[blockchain]
endpoint = "https://polygon-rpc.com"
ctf_exchange_address = "0x..."
collateral_token_address = "0x..."
conditional_tokens_address = "0x..."

[keystore]
path = "/path/to/validator/keystore.json"  # OPERATOR_ROLE 보유 키
password = "keystore_password"

[keystore.tx_sender]
mnemonic = "your twelve word mnemonic phrase here"
start_index = 0  # 인스턴스별로 다른 인덱스 사용

[log]
level = "info"
```

## 실행

### Local 모드 (인메모리 오더북)

```bash
# config.toml에서 [redis] 섹션 주석 처리 또는 host = "" 설정
go run cmd/main.go --config=cmd/config.toml --mnemonic-index=0
```

### Redis 모드 (영속화 오더북)

```bash
# config.toml에서 [redis] host 설정
# [redis]
# host = "localhost"
# port = 6379

go run cmd/main.go --config=cmd/config.toml --mnemonic-index=0
```

### 다중 인스턴스 실행

```bash
# 인스턴스 0 실행
go run cmd/main.go --config=cmd/config.toml --mnemonic-index=0

# 인스턴스 1 실행 (다른 터미널)
go run cmd/main.go --config=cmd/config.toml --mnemonic-index=1
```

## 테스트

### 테스트 환경 설정

```bash
# Redis 실행
docker run -d --name test-redis -p 6379:6379 redis:7-alpine

# RabbitMQ 실행
docker run -d --name test-rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4.2-management

# MySQL 실행
docker run -d --name test-mysql -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=prediction_market \
  mysql:8.0
```

### 테스트 실행

```bash
go test -v ./internal/service/...
```

### 테스트 케이스 목록

| 테스트 함수 | 설명 |
|------------|------|
| `TestAddBuyAndSellOrders` | BUY/SELL 주문 추가 (체결 없음) |
| `TestAddMultipleOrdersWithoutMatching` | 다수 주문 추가 (체결 없음) |
| `TestAddOrdersWithSamePriceWithoutMatching` | 동일 가격 주문 추가 |
| `TestAddOrdersWithOneMatch` | 단일 체결 발생 |
| `TestPartialFill` | 부분 체결 |
| `TestMultiplePriceLevelMatching` | 다중 가격대 체결 (BUY sweep) |
| `TestMultipleSellPriceLevelMatching` | 다중 가격대 체결 (SELL sweep) |
| `TestMintMatching` | MINT 매칭 (YES BUY + NO BUY) |
| `TestMintPartialFill` | MINT 부분 체결 |
| `TestMintMultiplePriceLevelMatching` | MINT 다중 가격대 체결 |
| `TestMergeMatching` | MERGE 매칭 (YES SELL + NO SELL) |
| `TestMergePartialFill` | MERGE 부분 체결 |
| `TestMergeMultiplePriceLevelMatching` | MERGE 다중 가격대 체결 |
| `TestCancelBuyOrder` | 단일 주문 취소 |
| `TestCancelSecondOfThreeOrders` | 특정 주문 취소 |
| `TestCancelOneOfThreeSamePriceOrders` | 동일 가격 중 특정 주문 취소 |
| `TestCancelAllOrdersForOneMaker` | Maker별 전체 주문 취소 |
| `TestMatchWithSufficientBalance` | 잔고 충분 시 매칭 성공 |
| `TestMatchWithInsufficientMakerBalance` | Maker 잔고 부족 시 주문 취소 |

## 기술 스택

- **Language**: Go 1.25
- **Frontend**: Next.js (SSR), React, TypeScript
- **Cross SDK**: `@to-nexus/sdk/react` (참고: https://github.com/to-nexus/cross-sdk-js/tree/main/examples/sdk-react)
- **Message Queue**: RabbitMQ (AWS MQ)
- **Orderbook Storage**: Local (In-memory) 또는 Redis 7.0+ 선택 가능
- **Database**: MySQL (Event assignment)
- **Blockchain**: go-ethereum (geth)
- **Smart Contract**: PredictionExchange (matchOrdersWithSignature)
- **Configuration**: TOML format
- **Testing**: Go standard testing package (TDD)

## 참고 자료

- [Polymarket](https://polymarket.com/) - 예측 시장 플랫폼
- [Polymarket CTFExchange Contract](https://github.com/Polymarket/ctf-exchange) - 스마트 컨트랙트 소스


## 개발 영역
- 해당 프로잭트는 ANT 외부에서 개발됩니다.

---
---

# Part 4: Prediction Market Processor 기술 명세서

# Prediction Market Processor

## Document Information

| 항목 | 내용 |
|------|------|
| 문서명 | Prediction Market Processor 기술 명세서 |
| 버전 | 1.1.0 |
| 최종 수정일 | 2026-02-09 |
| 상태 | Draft |

---

## Table of Contents

1. [개요](#1-개요)
2. [시스템 아키텍처](#2-시스템-아키텍처)
3. [이벤트 명세](#3-이벤트-명세)
4. [데이터베이스 스키마](#4-데이터베이스-스키마)
5. [오더북 관리](#5-오더북-관리)
6. [캔들 차트](#6-캔들-차트)
7. [기술 스택](#7-기술-스택)

---

## 1. 개요

### 1.1 목적

Prediction Market Processor는 Prediction Market 플랫폼의 핵심 데이터 처리 서비스입니다. 매칭엔진에서 발행하는 이벤트를 실시간으로 구독하여 주문 및 체결 데이터를 영속화하고, 오더북 상태를 관리합니다.

### 1.2 주요 기능

| 기능 | 설명 |
|------|------|
| 이벤트 처리 | 매칭엔진 이벤트 구독 및 처리 |
| 주문 관리 | 주문 생성, 체결, 취소 상태 관리 |
| 오더북 관리 | Redis 기반 실시간 오더북 관리 |
| 체결 기록 | 거래 체결 내역 저장 |
| 캔들 차트 | OHLCV 데이터 생성 및 관리 |

### 1.3 용어 정의

| 용어 | 설명 |
|------|------|
| CTF | Conditional Token Framework - 조건부 토큰 프레임워크 |
| Maker | 오더북에 유동성을 제공하는 주문자 |
| Taker | 오더북의 유동성을 소비하는 주문자 |
| Outcome Token | 예측 마켓의 결과에 따른 토큰 (Yes/No 등) |
| Collateral | 담보 토큰 (USDC 등) |

---

## 2. 시스템 아키텍처

### 2.1 컴포넌트 구조

```
┌─────────────────────────────────────────────────────────────┐
│                     Matching Engine                         │
│                   (Event Publisher)                         │
└─────────────────────────┬───────────────────────────────────┘
                          │ RabbitMQ
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      Processor                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  Event Consumer                         ││
│  └────────────────────────┬────────────────────────────────┘│
│                           │                                 │
│  ┌────────────────────────▼────────────────────────────────┐│
│  │               Event Processor Service                   ││
│  └────────────────────────┬────────────────────────────────┘│
│                           │                                 │
│  ┌────────────────────────▼────────────────────────────────┐│
│  │                   Repositories                          ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      ││
│  │  │   Orders    │  │   Trades    │  │  Candles    │      ││
│  │  │   (MySQL)   │  │   (MySQL)   │  │   (MySQL)   │      ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘      ││
│  │  ┌─────────────────────────────────────────────────┐    ││
│  │  │            Orderbook (Redis)                    │    ││
│  │  └─────────────────────────────────────────────────┘    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 2.2 데이터 흐름

1. **이벤트 수신**: RabbitMQ를 통해 매칭엔진으로부터 이벤트 수신
2. **이벤트 처리**: 이벤트 타입에 따른 비즈니스 로직 수행
3. **데이터 영속화**: MySQL에 주문/체결/캔들 데이터 저장
4. **오더북 갱신**: Redis에 오더북 상태 업데이트

### 2.3 프로젝트 구조
```
prediction-market-processor/
├── cmd/
│   ├── main.go                    # 엔트리포인트
│   ├── app/
│   │   └── app.go                 # 애플리케이션 초기화 및 라이프사이클
│   └── config.toml                # 설정 파일
├── internal/
│   ├── config/
│   │   └── config.go              # 설정 파싱
│   ├── repository/
│   │   ├── interface.go           # Repository 인터페이스 정의
│   │   └── impl/
│   │       ├── order_mysql.go     # orders MySQL 구현
│   │       ├── order_local.go     # orders 인메모리 구현 (테스트용)
│   │       ├── trade_mysql.go     # trades MySQL 구현
│   │       ├── trade_local.go     # trades 인메모리 구현 (테스트용)
│   │       ├── orderbook_redis.go # Redis 오더북 구현
│   │       └── orderbook_local.go # 인메모리 오더북 구현 (테스트용)
│   ├── service/
│   │   ├── event_processor.go     # 이벤트 처리 비즈니스 로직
│   │   ├── queue_consumer.go      # RabbitMQ 컨슈머
│   │   └── event_processor_test.go # 테스트
│   └── types/
│       ├── const.go               # 상수 정의
│       ├── errors.go              # 에러 타입 정의
│       ├── event.go               # 이벤트 타입 정의
│       ├── order.go               # Order 모델
│       ├── trade.go               # Trade 모델
│       └── orderbook.go           # Orderbook 모델
├── docs/
│   ├── prd.md
│   └── prd_comfirm.md
├── go.mod
└── go.sum
```

---

## 3. 이벤트 명세

### 3.1 이벤트 타입

| 이벤트 | 설명 | 트리거 |
|--------|------|--------|
| ORDER_ADDED | 새 주문 추가 | 주문이 오더북에 등록될 때 |
| ORDER_MATCHED | 주문 매칭 완료 | 두 주문이 체결될 때 |
| ORDER_CANCELLED | 단일 주문 취소 | 사용자가 주문을 취소할 때 |
| ORDER_ALL_CANCELLED | 전체 주문 취소 | 사용자가 전체/토큰별 주문을 취소할 때 |
| FORCE_CANCEL | 강제 취소 | 리스크 검증 실패 시 |

### 3.2 ORDER_ADDED

주문이 오더북에 추가될 때 발생합니다.

```json
{
  "type": "ORDER_ADDED",
  "timestamp": <unix_timestamp>,
  "data": {
    "orderHash": "0x...",
    "order": {
      "salt": "...",
      "maker": "0x...",
      "signer": "0x...",
      "taker": "0x...",
      "tokenId": "...",
      "makerAmount": <amount>,
      "takerAmount": <amount>,
      "expiration": <unix_timestamp>,
      "nonce": <nonce>,
      "feeRateBps": <bps>,
      "side": <0|1>,              // 0: BUY, 1: SELL
      "signatureType": <0|1>,     // 0: EOA, 1: EIP-1271
      "signature": "0x...",
      "oppositeTokenId": "...",
      "createdAt": <unix_timestamp>,
      "remainingAmount": <amount>,
      "eventSlug": "...",
      "marketSlug": "..."
    }
  }
}
```

**처리 로직**:
1. `orders` 테이블에 새 레코드 삽입 (status: active)
2. Redis 오더북 업데이트

### 3.3 ORDER_MATCHED

두 주문이 매칭되어 체결될 때 발생합니다.

```json
{
  "type": "ORDER_MATCHED",
  "timestamp": <unix_timestamp>,
  "data": {
    "match": {
      "matchId": "<maker_order_hash>:<taker_order_hash>",
      "tokenId": "...",
      "makerOrder": { <Order> },   // ORDER_ADDED의 order 구조와 동일
      "takerOrder": { <Order> },   // ORDER_ADDED의 order 구조와 동일
      "matchType": <0|1|2>,        // 0: COMPLEMENTARY, 1: MINT, 2: MERGE
      "fillAmount": <amount>,
      "timestamp": <unix_timestamp>,
      "price": "<price>"
    },
    "txHash": "0x..."
  }
}
```

**Match Type**:

| 값 | 타입 | 설명 |
|----|------|------|
| 0 | COMPLEMENTARY | 같은 토큰, 반대 방향 매칭 (BUY ↔ SELL) |
| 1 | MINT | 다른 토큰, 모두 BUY (collateral → outcome tokens) |
| 2 | MERGE | 다른 토큰, 모두 SELL (outcome tokens → collateral) |

**처리 로직**:
1. Maker/Taker 주문 업데이트 (filled_amount, remaining_amount, tx_hash)
2. remaining_amount가 0이면 status를 fullyFilled로 변경
3. `trades` 테이블에 체결 내역 삽입
4. 캔들 차트 데이터 업데이트 (1H, 6H, 1D, 1W)
5. Redis 오더북 업데이트

### 3.4 ORDER_CANCELLED

사용자가 단일 주문을 취소할 때 발생합니다.

```json
{
  "type": "ORDER_CANCELLED",
  "timestamp": <unix_timestamp>,
  "data": {
    "orderHash": "0x...",
    "order": { <Order> },    // ORDER_ADDED의 order 구조와 동일
    "txHash": "0x..."
  }
}
```

- `order` 필드에 취소된 주문의 전체 정보가 포함되어 있어 DB 조회 없이 Redis 오더북 업데이트 가능

**처리 로직**:
1. 해당 주문의 status를 cancelled로 변경
2. tx_hash, updated_at 업데이트
3. Redis 오더북 업데이트 (이벤트의 order 정보 사용)

### 3.5 ORDER_ALL_CANCELLED

사용자가 전체 주문 또는 특정 토큰의 전체 주문을 취소할 때 발생합니다.

```json
{
  "type": "ORDER_ALL_CANCELLED",
  "timestamp": <unix_timestamp>,
  "data": {
    "maker": "0x...",
    "tokenId": "...",              // optional (없으면 전체 토큰)
    "cancelledOrders": [
      { <Order> },    // ORDER_ADDED의 order 구조와 동일
      { <Order> }
    ],
    "cancelledOrderHashes": [
      "0x...",        // cancelledOrders와 1:1 매핑
      "0x..."
    ],
    "lastNonce": <nonce>,
    "txHash": "0x..."
  }
}
```

- `cancelledOrders` 필드에 취소된 주문들의 전체 정보가 포함되어 있어 DB 조회 없이 Redis 오더북 업데이트 가능
- `cancelledOrderHashes` 필드에 각 주문의 해시가 포함되어 DB 업데이트에 사용

**처리 로직**:
1. cancelledOrders의 모든 주문에 대해 status를 cancelled로 변경
2. tx_hash, updated_at 업데이트
3. 해당 토큰들의 Redis 오더북 업데이트 (이벤트의 order 정보 사용)

### 3.6 FORCE_CANCEL

리스크 검증 실패로 인해 주문이 강제 취소될 때 발생합니다.

```json
{
  "type": "FORCE_CANCEL",
  "timestamp": <unix_timestamp>,
  "data": {
    "orderHash": "0x...",
    "order": { <Order> },    // ORDER_ADDED의 order 구조와 동일
    "reason": "<cancel_reason>"
  }
}
```

**취소 사유 예시**:
- `insufficient collateral balance or allowance`
- `insufficient token balance or approval`

**처리 로직**:
1. 해당 주문의 status를 cancelled로 변경
2. reason 필드에 취소 사유 저장
3. updated_at 업데이트
4. Redis 오더북 업데이트 (이벤트의 order 정보 사용)

---

## 4. 데이터베이스 스키마

### 4.1 orders

주문 정보를 저장하는 테이블입니다.

| 필드명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| _id | BIGINT | Primary Key | AUTO_INCREMENT |
| order_hash | VARCHAR(66) | EIP-712 기반 주문 해시 | UNIQUE, NOT NULL |
| salt | VARCHAR(66) | 주문 고유성 보장용 값 | NOT NULL |
| maker | VARCHAR(42) | 주문 생성자 주소 | NOT NULL |
| signer | VARCHAR(42) | 서명자 주소 | NOT NULL |
| taker | VARCHAR(42) | 지정 taker 주소 | NOT NULL |
| token_id | VARCHAR(78) | CTF outcome token ID | NOT NULL |
| maker_amount | DECIMAL(78,0) | 주문 수량 | NOT NULL |
| taker_amount | DECIMAL(78,0) | 교환 대상 수량 | NOT NULL |
| price | DECIMAL(18,6) | 주문 가격 | NOT NULL |
| expiration | BIGINT | 주문 만료 시간 (Unix timestamp) | NOT NULL |
| nonce | BIGINT | 일괄 취소용 nonce | NOT NULL |
| fee_rate_bps | INT | 수수료율 (basis points) | NOT NULL |
| side | TINYINT | 주문 방향 | NOT NULL |
| signature_type | TINYINT | 서명 타입 | NOT NULL |
| signature | TEXT | EIP-712 서명 데이터 | NOT NULL |
| opposite_token_id | VARCHAR(78) | 반대 outcome token ID | NOT NULL |
| event_slug | VARCHAR(255) | 이벤트 식별자 | NOT NULL |
| market_slug | VARCHAR(255) | 마켓 식별자 | NOT NULL |
| remaining_amount | DECIMAL(78,0) | 미체결 잔여 수량 | NOT NULL |
| filled_amount | DECIMAL(78,0) | 누적 체결 수량 | DEFAULT 0 |
| filled_notional | DECIMAL(65,0) | 누적 체결 금액 (collateral wei) | DEFAULT 0 |
| status | TINYINT | 주문 상태 | DEFAULT 0 |
| tx_hash | VARCHAR(66) | 트랜잭션 해시 | NULL |
| reason | TEXT | 강제 취소 사유 | NULL |
| created_at | BIGINT | 생성 시간 (Unix timestamp) | NOT NULL |
| updated_at | BIGINT | 수정 시간 (Unix timestamp) | NULL |

**side 값**:

| 값 | 설명 |
|----|------|
| 0 | BUY |
| 1 | SELL |

**signature_type 값**:

| 값 | 설명 |
|----|------|
| 0 | EOA (Externally Owned Account) |
| 1 | EIP-1271 (Smart Contract Wallet) |

**status 값**:

| 값 | 상태 | 설명 |
|----|------|------|
| 0 | active | 활성 주문 (오더북에 존재) |
| 1 | cancelled | 취소된 주문 |
| 2 | fullyFilled | 전량 체결 완료 |

**인덱스**:

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| idx_token_id_side_status | (token_id, side, status) | 오더북 조회 |
| idx_maker_status | (maker, status) | 사용자별 주문 조회 |
| idx_event_slug | (event_slug) | 이벤트별 주문 조회 |
| idx_created_at | (created_at) | 시간순 정렬 |

### 4.2 trades

체결 내역을 저장하는 테이블입니다.

| 필드명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | BIGINT | Primary Key | AUTO_INCREMENT |
| match_id | VARCHAR(135) | 매칭 ID | UNIQUE, NOT NULL |
| token_id | VARCHAR(78) | CTF outcome token ID | NOT NULL |
| maker_order_hash | VARCHAR(66) | Maker 주문 해시 | NOT NULL |
| taker_order_hash | VARCHAR(66) | Taker 주문 해시 | NOT NULL |
| maker_address | VARCHAR(42) | Maker 주소 | NOT NULL |
| taker_address | VARCHAR(42) | Taker 주소 | NOT NULL |
| taker_side | TINYINT | Taker 주문 방향 (0: BUY, 1: SELL) | NOT NULL |
| match_type | TINYINT | 매칭 타입 | NOT NULL |
| fill_amount | DECIMAL(65,0) | 체결 수량 (token wei) | NOT NULL |
| price | DECIMAL(18,6) | 체결 가격 | NOT NULL |
| tx_hash | VARCHAR(66) | 트랜잭션 해시 | NOT NULL |
| event_slug | VARCHAR(255) | 이벤트 식별자 | NOT NULL |
| market_slug | VARCHAR(255) | 마켓 식별자 | NOT NULL |
| created_at | BIGINT | 체결 시간 (Unix timestamp) | NOT NULL |

**taker_side 값**:

| 값 | 설명 |
|----|------|
| 0 | BUY |
| 1 | SELL |

**match_type 값**:

| 값 | 타입 | 설명 |
|----|------|------|
| 0 | COMPLEMENTARY | 같은 토큰, 반대 방향 매칭 |
| 1 | MINT | CTF split을 통한 토큰 생성 |
| 2 | MERGE | CTF merge를 통한 토큰 병합 |

**인덱스**:

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| idx_token_id_created_at | (token_id, created_at DESC) | 토큰별 최근 체결 조회 |
| idx_maker_created_at | (maker_address, created_at DESC) | Maker 거래 이력 조회 |
| idx_taker_created_at | (taker_address, created_at DESC) | Taker 거래 이력 조회 |
| idx_event_slug_created_at | (event_slug, created_at DESC) | 이벤트별 체결 조회 |

### 4.3 candles (향후 구현)

캔들 차트 데이터를 저장하는 테이블입니다. 인터벌별로 별도 테이블을 운영합니다.

- `candles_1h` (1시간)
- `candles_6h` (6시간)
- `candles_1d` (1일)
- `candles_1w` (1주)

| 필드명 | 타입 | 설명 | 제약조건 |
|--------|------|------|----------|
| id | BIGINT | Primary Key | AUTO_INCREMENT |
| token_id | VARCHAR(78) | CTF outcome token ID | NOT NULL |
| interval_start | BIGINT | 인터벌 시작 시간 (Unix timestamp) | NOT NULL |
| open_price | DECIMAL(18,6) | 시가 | NOT NULL |
| high_price | DECIMAL(18,6) | 고가 | NOT NULL |
| low_price | DECIMAL(18,6) | 저가 | NOT NULL |
| close_price | DECIMAL(18,6) | 종가 | NOT NULL |
| volume | DECIMAL(78,0) | 거래량 | NOT NULL |
| trade_count | INT | 체결 건수 | NOT NULL |

**인덱스**:

| 인덱스명 | 컬럼 | 용도 |
|----------|------|------|
| uk_token_interval | (token_id, interval_start) | 중복 방지 (UNIQUE) |
| idx_token_id | (token_id) | 토큰별 캔들 조회 |

---

## 5. 오더북 관리

Processor는 Redis에서 오더북 집계 데이터만 관리합니다. 개별 주문 데이터(`orders`)와 주문 인덱스(`orderbook_index`)는 매칭엔진에서 관리합니다.

### 5.1 데이터 구조

Redis에 저장되는 오더북 집계 데이터 구조입니다.

```json
{
  "tokenId": "...",
  "side": "BID" | "ASK",
  "totalOrders": 100,
  "totalVolume": "1000000000000000000",
  "priceLevels": [
    {
      "price": "0.500",
      "volume": "500000000000000000",
      "orders": 5
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| tokenId | string | CTF outcome token ID |
| side | string | 방향 (BID: 매수, ASK: 매도) |
| totalOrders | int | 총 주문 수 |
| totalVolume | string | 총 볼륨 |
| priceLevels | array | 가격 레벨별 집계 |
| priceLevels[].price | string | 가격 |
| priceLevels[].volume | string | 해당 가격의 총 볼륨 |
| priceLevels[].orders | int | 해당 가격의 주문 수 |

### 5.2 Redis 키 구조

| 키 패턴 | 설명 |
|---------|------|
| `orderbook:{tokenId}:BID` | 매수 오더북 |
| `orderbook:{tokenId}:ASK` | 매도 오더북 |

### 5.3 초기화

서버 시작 시 DB 기준으로 오더북을 재구성합니다 (DB가 source of truth).

1. `orders` 테이블에서 active 상태인 모든 주문의 고유 token_id 조회
2. 각 token_id에 대해:
   - DB에서 active 주문을 조회하여 오더북 생성
   - Redis에 저장 (기존 오더북 덮어쓰기)
3. 이벤트 구독 시작

**참고**: Redis 오더북은 DB의 캐시/인덱스 역할이므로, DB-Redis 불일치 시 DB 기준으로 동기화됩니다.

### 5.4 업데이트 시점

| 이벤트 | 업데이트 대상 |
|--------|-------------|
| ORDER_ADDED | 해당 토큰의 BID/ASK |
| ORDER_MATCHED | 매칭된 토큰의 BID/ASK |
| ORDER_CANCELLED | 해당 토큰의 BID/ASK |
| ORDER_ALL_CANCELLED | 취소된 모든 토큰의 BID/ASK |
| FORCE_CANCEL | 해당 토큰의 BID/ASK |

### 5.5 업데이트 로직

**ORDER_ADDED**:
1. Redis에서 해당 token_id, side의 오더북 조회
2. 주문의 price에 해당하는 priceLevel 찾기
   - 있으면: volume += remainingTokenAmount, orders += 1
   - 없으면: 새 priceLevel 추가
3. totalOrders += 1, totalVolume += remainingTokenAmount
4. priceLevels 정렬 후 Redis에 저장

**볼륨 계산 (`RemainingTokenAmount`)**:
- BUY 주문: `remainingCollateral * takerAmount / makerAmount` (담보 → 토큰 수량 변환)
- SELL 주문: `remainingAmount` 그대로 사용 (이미 토큰 수량)

**ORDER_MATCHED**:
1. Redis에서 해당 token_id, side의 오더북 조회
2. 매칭된 주문의 price에 해당하는 priceLevel 찾기
3. volume -= fillAmount
4. remaining_amount가 0이면 orders -= 1
5. volume이 0이면 해당 priceLevel 제거
6. totalOrders, totalVolume 재계산 후 Redis에 저장

**ORDER_CANCELLED / ORDER_ALL_CANCELLED**:
- 이벤트에 포함된 order 정보를 직접 사용 (Redis 조회 불필요)
1. Redis에서 해당 token_id, side의 오더북 조회
2. 취소된 주문의 price에 해당하는 priceLevel 찾기
3. volume -= order.remainingAmount, orders -= 1
4. volume이 0이면 해당 priceLevel 제거
5. totalOrders, totalVolume 재계산 후 Redis에 저장

**FORCE_CANCEL**:
- 이벤트에 포함된 order 정보를 직접 사용
1. Redis에서 해당 token_id, side의 오더북 조회
2. 취소된 주문의 price에 해당하는 priceLevel 찾기
3. volume -= order.remainingAmount, orders -= 1
4. volume이 0이면 해당 priceLevel 제거
5. totalOrders, totalVolume 재계산 후 Redis에 저장

**priceLevels 정렬**:
- BID: price 내림차순 (높은 가격이 먼저)
- ASK: price 오름차순 (낮은 가격이 먼저)

---

## 6. 캔들 차트

> **참고**: 캔들 차트 기능은 향후 구현 예정입니다.

### 6.1 인터벌 정의 (향후 구현)

| 인터벌 | 초 단위 | 테이블 |
|--------|--------|--------|
| 1H | 3,600 | candles_1h |
| 6H | 21,600 | candles_6h |
| 1D | 86,400 | candles_1d |
| 1W | 604,800 | candles_1w |

### 6.2 업데이트 로직 (향후 구현)

ORDER_MATCHED 이벤트 처리 시:

1. **인터벌 시작 시간 계산**
   ```
   interval_start = timestamp - (timestamp % interval_seconds)
   ```

2. **캔들 조회 또는 생성**
   - 해당 token_id와 interval_start의 캔들 조회
   - 캔들이 없으면 새로 생성

3. **캔들 업데이트**
   - 새 캔들: open, high, low, close = price / volume = fillAmount / trade_count = 1
   - 기존 캔들: high = max(high, price) / low = min(low, price) / close = price / volume += fillAmount / trade_count += 1

---

## 7. 기술 스택

| 구분 | 기술 | 용도 |
|------|------|------|
| Language | Go | 서버 개발 |
| Frontend | Next.js (SSR), React, TypeScript | 웹 애플리케이션 |
| Cross SDK | `@to-nexus/sdk/react` | 지갑 연결 및 블록체인 트랜잭션 처리 |
| Message Queue | RabbitMQ | 이벤트 수신 |
| Database | MySQL | 데이터 영속화 |
| Cache | Redis | 오더북 관리 |
| SQL Library | sqlx | 쿼리 실행 |

**참고 자료:**
- Cross SDK React 예제: https://github.com/to-nexus/cross-sdk-js/tree/main/examples/sdk-react

---

## Appendix

### A. 데이터 정합성

- 이벤트는 토큰별 락을 사용하여 순서대로 처리
- 트랜잭션 내에서 order, trade, candle 업데이트
- 실패 시 재처리 로직 적용

### B. 성능 고려사항

- 캔들 업데이트는 UPSERT 사용
- Redis 오더북은 변경 시에만 업데이트
- 인덱스 활용을 통한 조회 최적화

### C. 확장성

- 토큰별 파티셔닝 고려
- 캔들 테이블은 시간 기반 파티셔닝 고려


## 개발 영역
- 해당 프로잭트는 ANT 외부에서 개발됩니다.