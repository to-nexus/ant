# 코인 시세 모니터링 서비스

## Overview
실시간 암호화폐 시세를 확인할 수 있는 웹 서비스입니다. 사용자는 주요 코인의 현재가, 24시간 변동률, 거래량 등을 한눈에 확인할 수 있습니다.

## Goals
- 주요 암호화폐의 실시간 시세 정보 제공
- 직관적이고 빠른 사용자 경험
- 모바일/데스크톱 모두에서 최적화된 UI

## User Stories
- As a 암호화폐 투자자, I want 주요 코인의 실시간 가격을 확인하고 싶다 so that 투자 결정을 빠르게 내릴 수 있다
- As a 일반 사용자, I want 코인 가격의 변동 추이를 쉽게 파악하고 싶다 so that 시장 흐름을 이해할 수 있다
- As a 모바일 사용자, I want 어디서든 빠르게 시세를 확인하고 싶다 so that 실시간으로 시장을 모니터링할 수 있다

## Requirements

### Functional Requirements
1. **코인 목록 표시**
   - 주요 코인 10개 이상 (BTC, ETH, XRP, ADA, SOL, DOGE, DOT, MATIC, LINK, UNI)
   - 코인 심볼, 이름, 로고 표시

2. **시세 정보 표시**
   - 현재 가격 (USD/KRW)
   - 24시간 변동률 (% 및 절대값)
   - 24시간 거래량
   - 시가총액
   - 상승/하락 색상 표시 (빨강/파랑)

3. **실시간 업데이트**
   - 30초마다 자동 갱신
   - 가격 변동 시 애니메이션 효과

4. **정렬 및 필터**
   - 가격, 변동률, 거래량 기준 정렬
   - 코인 이름 검색 기능

5. **반응형 디자인**
   - 모바일: 리스트 형태
   - 데스크톱: 테이블 형태

### Non-Functional Requirements
- **Performance**: 초기 로딩 시간 2초 이내, API 응답 시간 500ms 이내
- **Security**: API 키 환경변수 관리, HTTPS 사용
- **Accessibility**: WCAG 2.1 AA 준수
- **Reliability**: 99% uptime, API 장애 시 에러 처리

## Design References
- 참고: Coinbase, Binance의 시세 페이지
- 색상: 상승(#16c784 green), 하락(#ea3943 red)
- 폰트: Inter, Roboto Mono (숫자)

## Technical Constraints
- **Technology stack**: 
  - Frontend: React 18 + TypeScript
  - Styling: Tailwind CSS
  - State Management: React Query (for caching)
  - API: CoinGecko Free API (https://www.coingecko.com/en/api)
  
- **Dependencies**:
  - axios (API 요청)
  - react-query (데이터 캐싱)
  - date-fns (시간 포맷팅)

- **API Constraints**:
  - CoinGecko Free API: 10-30 calls/minute
  - Rate limiting 대응 필요

## Success Metrics
- 페이지 로딩 속도: < 2초
- API 에러율: < 1%
- 모바일 반응성: 320px ~ 768px 완벽 지원
- 코드 커버리지: > 80%
