# GameRoomPage WebSocket 메시지 프로토콜 수정 완료

## ✅ 수정 완료

### 문제: Frontend-Backend 메시지 프로토콜 불일치

**Frontend가 보내던 형식 (잘못됨):**
```typescript
// 송신
{ type: 'join_room', payload: { roomId: "abc" } }
{ type: 'paddle_move', payload: { y: 250 } }
{ type: 'leave_room', payload: { roomId: "abc" } }

// 수신
message.payload.role  // room_joined
message.payload.winner  // game_end
```

**Backend가 기대하는 형식:**
```typescript
// 수신 (Backend가 받는 것)
{ type: 'join_room', roomId: "abc" }
{ type: 'paddle_move', y: 250 }
{ type: 'leave_room', roomId: "abc" }

// 송신 (Backend가 보내는 것)
{ type: 'room_joined', role: "left" }  // payload 없음!
{ type: 'game_end', winner: "left" }  // payload 없음!
{ type: 'game_state', payload: {...} }  // payload 있음
```

---

## 🔧 수정 내용

### 1. join_room 메시지 (Line 52-56)
```diff
  sendMessage({
    type: 'join_room',
-   payload: { roomId }
+   roomId: roomId
  });
```

### 2. paddle_move 메시지 (Line 103-107)
```diff
  sendMessage({
    type: 'paddle_move',
-   payload: { y: paddleY.current }
+   y: paddleY.current
  });
```

### 3. leave_room 메시지 (Line 130-134)
```diff
  sendMessage({
    type: 'leave_room',
-   payload: { roomId }
+   roomId: roomId
  });
```

### 4. room_joined 응답 처리 (Line 24)
```diff
  case 'room_joined':
-   setRole(message.payload.role);
+   setRole(message.role);  // Backend: { type, role }
    break;
```

### 5. game_end 응답 처리 (Line 32)
```diff
  case 'game_end':
-   setWinner(message.payload.winner);
+   setWinner(message.winner);  // Backend: { type, winner }
    break;
```

---

## 📊 Backend 메시지 형식 정리

| 메시지 타입 | Backend 형식 | payload 여부 |
|------------|-------------|-------------|
| `room_joined` | `{ type, role }` | ❌ No |
| `opponent_joined` | `{ type }` | ❌ No |
| `game_state` | `{ type, payload: {...} }` | ✅ Yes |
| `game_end` | `{ type, winner }` | ❌ No |
| `error` | `{ type, message }` | ❌ No |

**일관성 없는 Backend API:**
- `game_state`만 `payload` 사용
- 나머지는 필드를 직접 포함

---

## ✅ 이제 작동해야 할 것

1. WebSocket 연결 성공 ✅
2. `join_room` 메시지 정상 처리
3. `room_joined` 응답 정상 수신
4. 게임 시작
5. Paddle 이동 동기화
6. 게임 종료 처리

**Frontend dev server를 재시작하면** 정상 작동할 것입니다!

---

## 🎓 교훈

**또 다시 API Contract Mismatch!**

이번 문제들:
1. REST API: `{ rooms: [] }` vs `[]`
2. WebSocket Path: `/ws` vs `/game`
3. WebSocket Message: `payload` vs 직접 필드

**근본 원인:**
- Frontend와 Backend 개발자가 다름 (또는 같은 개발자가 시간 차이로 개발)
- API 명세서/계약 문서 없음
- Integration test 없음
- TypeScript interface 공유 안 함

**해결 방법:**
- Shared types package (`@ant-pong/types`)
- OpenAPI/Swagger 스펙
- WebSocket 프로토콜 문서화
- E2E integration test

