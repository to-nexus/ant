# 🪙 코인 시세 조회 프론트엔드 — PRD (Product Requirements Document)

## 1. 프로젝트 개요
- **제품명:** CoinWatcher (임시 이름)  
- **목적:** 사용자가 실시간 코인 시세를 간단히 조회할 수 있는 웹 인터페이스 제공  
- **타겟 사용자:** 일반 사용자, 가벼운 트레이더, 개발자  

---

## 2. 주요 기능 (MVP)

| 기능 | 설명 |
|------|------|
| 🔍 코인 검색 | 사용자가 코인 이름 또는 심볼(BTC, ETH 등)을 입력하면 해당 코인 시세 조회 |
| 💰 시세 표시 | 현재가, 24시간 변동률, 거래량 표시 |
| 📈 자동 갱신 | 10초마다 자동으로 데이터 갱신 |
| 🧭 코인 리스트 | 주요 코인(BTC, ETH, SOL, XRP, DOGE 등)의 기본 시세 리스트 표시 |
| ⚙️ 통화 단위 선택 | USD / KRW 변환 토글 가능 (단순 환율 변환으로 처리) |

---

## 3. 기술 요구사항

### 프론트엔드
- **Framework:** React (Next.js or Vite)
- **UI Library:** TailwindCSS
- **상태관리:** useState / useEffect 수준 (Redux 불필요)
- **데이터 Fetch:** CoinGecko API (https://api.coingecko.com/api/v3/)
- **자동 업데이트:** `setInterval` 이용

### API 예시
