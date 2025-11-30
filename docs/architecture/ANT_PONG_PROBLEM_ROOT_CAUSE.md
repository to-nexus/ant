# ant-pong Frontend-Backend 연동 문제 분석 및 해결

## 🔴 실제 문제 발견

### 사용자 환경
- **ant-pong-be**: Port 3000에서 실행 (`npm run start:dev`)
- **ant-pong-fe**: Port 5173에서 실행 (Vite dev server)
- **에러**: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

---

## 🔍 문제 분석

### 1. Backend 응답 확인
```bash
$ curl http://localhost:3000/rooms
{"rooms":[]}
```
✅ Backend는 정상적으로 JSON을 반환하고 있음

### 2. Frontend 코드 확인

**문제 발견: Backend 응답 형식 불일치**

**Backend (`RoomsController.getRooms()`):**
```typescript
@Get()
getRooms() {
  const rooms = this.gameGateway.getRooms();
  return { rooms };  // ← 객체로 감싸서 반환: { rooms: [] }
}
```

**Frontend (`LobbyPage.tsx:24-25`):**
```typescript
const data = await response.json();
setRooms(data);  // ❌ data는 { rooms: [] } 형식인데, 배열로 취급
```

**문제:**
- Frontend는 `data`를 직접 `setRooms()`에 전달
- `RoomListItem[]` 타입을 기대하는데 `{ rooms: [] }` 객체가 전달됨
- TypeScript 타입 체크에서는 잡히지 않음 (any 또는 느슨한 타입)

### 3. 추가 문제: `.env` 파일 오타

```bash
$ cat .env
VITE_WS_BASE_URL=ws://localhost:3000/ws
VITE_API_BASE_URL==http://localhost:3000
                  ^^
                  ❌ 등호 2개!
```

이로 인해 환경변수가 제대로 로드되지 않음 (값이 `=http://localhost:3000`이 됨)

---

## 📊 에러 발생 원인

### "Unexpected token '<', "<!DOCTYPE"" 에러의 의미

이 에러는 **HTML 페이지를 JSON으로 파싱하려고 할 때** 발생합니다.

**가능한 시나리오:**
1. ❌ Backend가 404 HTML 페이지 반환 → Frontend가 JSON 파싱 시도
2. ❌ 잘못된 URL로 요청 (예: Vite dev server의 index.html)
3. ❌ CORS 에러로 인한 프리플라이트 실패 → HTML 에러 페이지
4. ❌ Backend가 HTML을 반환하는 다른 엔드포인트로 리다이렉트

**현재 상황에서의 추정:**
- `.env` 오타로 인해 `VITE_API_BASE_URL`이 제대로 로드 안 됨
- Fallback `http://localhost:3000` 사용
- 하지만 Backend 응답 형식 불일치로 `data.rooms`가 undefined
- 또는 다른 경로로 요청이 갔을 가능성

---

## 🔧 해결 방법

### 1. Frontend 수정: 응답 데이터 올바르게 파싱

```typescript
// ❌ BEFORE
const data = await response.json();
setRooms(data);

// ✅ AFTER
const data = await response.json();
setRooms(data.rooms || []);  // Backend가 { rooms: [] } 형식으로 반환
```

### 2. .env 파일 오타 수정

```bash
# ❌ BEFORE
VITE_API_BASE_URL==http://localhost:3000

# ✅ AFTER
VITE_API_BASE_URL=http://localhost:3000
```

### 3. Vite Dev Server 재시작 필요

`.env` 파일 변경 시 Vite dev server를 재시작해야 환경변수가 반영됨:
```bash
# Frontend dev server 재시작
cd ant-pong-fe/codebase
npm run dev
```

---

## 🤖 에이전트가 못 고친 이유

### 1. **Cross-Project Context 부족**

**에이전트가 본 것:**
```
Project: ant-pong-be (Backend only)
Codebase: Backend 코드만
Directive: "REST API 문제 해결해라"
```

**실제 필요한 것:**
```
Project: ant-pong-be + ant-pong-fe (Both)
Issue: Frontend가 Backend 응답을 잘못 파싱
Fix: Frontend 코드 수정 필요
```

→ **에이전트는 Backend 코드만 보고 Backend를 계속 수정함**

### 2. **응답 형식 불일치 미인식**

**에이전트의 접근:**
```
1. Backend에 REST Controller 추가 ✅
2. CORS 설정 추가 ✅
3. Port 설정 ✅
4. curl 테스트: {"rooms":[]} 정상 ✅

결론: Backend는 완벽함! → 작업 완료
```

**실제 문제:**
```
Backend 응답: { rooms: [] }
Frontend 기대: []
                ↓
Frontend 코드에서 data.rooms를 사용해야 함!
```

### 3. **Frontend 코드를 보지 못함**

**에이전트가 수정한 파일들:**
```
✅ src/rooms/rooms.controller.ts
✅ src/rooms/rooms.service.ts
✅ src/rooms/rooms.module.ts
✅ src/app.module.ts
✅ src/main.ts
```

**수정했어야 할 파일:**
```
❌ ant-pong-fe/src/routes/LobbyPage.tsx (다른 프로젝트!)
❌ ant-pong-fe/.env (gitignore되어 보이지 않음)
```

### 4. **에러 메시지를 사용자가 제공하지 않음**

**에이전트가 받은 Directive:**
```
"REST API가 없다"
"이 문제를 계속 해결 못하는 이유를 설명하고 해결해라"
```

**실제 필요한 정보:**
```
"Frontend에서 'Unexpected token <!DOCTYPE' 에러 발생"
"Network 탭에서 어떤 URL로 요청하는지"
"응답이 JSON인지 HTML인지"
```

→ **구체적인 에러 정보 없이는 문제 진단 불가능**

### 5. **타입 체크 부재**

**Frontend 타입 정의:**
```typescript
// types/room.ts
export interface RoomListItem {
  id: string;
  players: number;
  status: string;
}

// LobbyPage.tsx
const [rooms, setRooms] = useState<RoomListItem[]>([]);
```

**Backend 응답:**
```typescript
return { rooms: [...] };  // { rooms: RoomListItem[] }
```

**문제:**
```typescript
setRooms(data);  // ❌ data는 { rooms: [] }이지만 타입 에러 없음
                 // → TypeScript가 느슨하게 설정되었거나 any 타입
```

만약 strict TypeScript였다면:
```typescript
// Type Error!
setRooms(data);  // Type '{ rooms: RoomListItem[] }' is not assignable to type 'RoomListItem[]'
```

---

## 💡 근본 원인 요약

### Backend-Frontend 계약 불일치

**Backend가 반환하는 것:**
```json
{
  "rooms": [
    { "id": "abc", "players": 2, "status": "playing" }
  ]
}
```

**Frontend가 기대하는 것:**
```json
[
  { "id": "abc", "players": 2, "status": "playing" }
]
```

### 해결 방법 (2가지 선택)

**Option 1: Frontend 수정 (권장)**
```typescript
// ✅ Backend 응답 형식에 맞춤
const data = await response.json();
setRooms(data.rooms || []);
```

**Option 2: Backend 수정**
```typescript
// ❌ Breaking change (다른 곳에서도 사용 중일 수 있음)
@Get()
getRooms() {
  return this.gameGateway.getRooms();  // 배열 직접 반환
}
```

---

## 🎯 에이전트 개선 방안

### 1. **Cross-Project Context 인식**

**필요한 기능:**
```
Directive: "Frontend에서 Backend 호출 시 에러"
          ↓
Agent: Frontend 프로젝트도 함께 분석
       - API 호출 코드 확인
       - 응답 처리 로직 확인
       - 타입 정의 확인
```

### 2. **API 계약 검증**

**필요한 검증:**
```typescript
// Backend Response
type BackendResponse = { rooms: Room[] };

// Frontend Expectation
type FrontendExpectation = Room[];

// ❌ Contract Mismatch Detected!
```

### 3. **에러 재현 및 디버깅**

**에이전트가 해야 할 것:**
```bash
1. curl http://localhost:3000/rooms
   → {"rooms":[]} 확인

2. Frontend 코드 분석
   → setRooms(data) 발견
   
3. 타입 확인
   → data는 { rooms: [] }
   → setRooms는 [] 기대
   
4. ❌ Contract Mismatch!
```

### 4. **사용자에게 질문하기**

**에이전트가 물어봐야 할 것:**
```
"Backend는 정상적으로 JSON을 반환하고 있습니다.
 
 Frontend에서 다음을 확인해주세요:
 1. 브라우저 Network 탭에서 실제 요청 URL
 2. 응답 Status Code와 Body
 3. Console에서 정확한 에러 메시지
 
 이 정보를 공유해주시면 정확히 진단하겠습니다."
```

---

## ✅ 수정 완료

### 변경 사항

**1. Frontend (`LobbyPage.tsx`):**
```typescript
setRooms(data.rooms || []);  // ✅ Backend 응답 형식에 맞춤
```

**2. .env 파일:**
```bash
VITE_API_BASE_URL=http://localhost:3000  # ✅ 등호 1개로 수정
```

**3. Backend (`package.json`):**
```json
"dev": "nest start --watch"  # ✅ dev 스크립트 추가
```

**4. Backend (`main.ts`):**
```typescript
app.useWebSocketAdapter(new WsAdapter(app));  # ✅ WS adapter 설정
```

### 테스트 방법

```bash
# 1. Backend 실행 (Port 3000)
cd ant-pong-be/codebase
PORT=3000 npm run dev

# 2. Backend API 테스트
curl http://localhost:3000/rooms
# Expected: {"rooms":[]}

# 3. Frontend 재시작 (Port 5173)
cd ant-pong-fe/codebase
npm run dev

# 4. 브라우저에서 http://localhost:5173 접속
# Expected: Lobby page with "No rooms available" message
```

---

## 📝 교훈

### 1. API 계약은 명확하게

```typescript
// ✅ GOOD: API 응답 타입 정의
interface GetRoomsResponse {
  rooms: RoomListItem[];
}

// Backend
@Get()
getRooms(): GetRoomsResponse {
  return { rooms: this.gameGateway.getRooms() };
}

// Frontend
const data: GetRoomsResponse = await response.json();
setRooms(data.rooms);
```

### 2. 에러 발생 시 Full Context 제공

```
"Frontend에서 에러 발생"
  ↓
✅ 어떤 페이지? (LobbyPage)
✅ 어떤 API? (GET /rooms)
✅ 에러 메시지? (Unexpected token <!DOCTYPE)
✅ Network 탭? (Status, Response)
✅ 환경? (localhost:5173 → localhost:3000)
```

### 3. Cross-Project 문제는 양쪽 다 봐야 함

```
Frontend ↔ Backend 연동 이슈
  ↓
Backend만 보면 해결 불가능
Frontend도 함께 분석 필요
```

---

**구현 완료**: 2025-11-30  
**문제 유형**: API Response Contract Mismatch + .env Typo  
**해결 방법**: Frontend response parsing 수정 + .env 오타 수정

