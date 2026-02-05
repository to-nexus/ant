# Chat Pinned Query Specification

> **Version:** 1.0  
> **Last Updated:** 2025-02-05  
> **Components:** `ChatHistory.tsx`, `PinnedQuery.tsx`, `ChatPanel.tsx`

---

## Overview

Pinned Query는 사용자가 현재 보고 있는 AI 응답에 해당하는 질문을 상단에 고정 표시하는 기능입니다. Cursor/Copilot과 유사한 UX를 제공합니다.

---

## 핵심 규칙

### Pin 표시 조건

> **"화면에 보이는 가장 위쪽 메시지(firstVisibleIndex)를 기준으로 결정"**

| firstVisibleIndex 타입 | Pin 동작 |
|----------------------|---------|
| **user 메시지** | Pin 없음 (해당 질문이 이미 화면에 보임) |
| **assistant 메시지** | 그 assistant 바로 위의 user 메시지를 Pin |

### 예시

```
Index 0: [user1] "첫 번째 질문"
Index 1: [asst1] 첫 번째 응답...
Index 2: [user2] "두 번째 질문"  
Index 3: [asst2] 두 번째 응답...
Index 4: [user3] "세 번째 질문"
Index 5: [asst3] 세 번째 응답...
```

| 화면에 보이는 것 | firstVisibleIndex | 타입 | Pin |
|-----------------|-------------------|------|-----|
| asst3(5)만 | 5 | assistant | **user3** (index 4) |
| asst2(3) + asst3(5) | 3 | assistant | **user2** (index 2) |
| user2(2) + asst2(3) | 2 | user | **없음** |
| asst1(1) + user2(2) | 1 | assistant | **user1** (index 0) |
| user1(0) + asst1(1) | 0 | user | **없음** |

---

## 스크롤 동작

### 1. 초기 로드

- **동작**: 페이지 접속 시 즉시 맨 아래로 스크롤
- **애니메이션**: 없음 (instant scroll)
- **구현**: `initialTopMostItemIndex` + 초기 1회 `scrollToIndex`

### 2. 최하단에서 메시지 추가 (스트리밍 등)

- **동작**: 자동으로 따라가며 스크롤
- **구현**: Virtuoso의 `followOutput="smooth"` 사용
- **조건**: 사용자가 이미 최하단에 있을 때만 작동

### 3. 최하단이 아닐 때 메시지 추가

- **동작**: 스크롤하지 않음
- **이유**: 사용자가 이전 내용을 보고 있으므로 방해하지 않음
- **구현**: `followOutput`의 기본 동작 (최하단이 아니면 스크롤 안함)

---

## Pin UI 동작

### 기본 상태

- **높이**: 고정 (line-clamp-2로 2줄까지)
- **긴 메시지**: 잘림 처리
- **힌트**: 150자 이상일 경우 "Hover to see full message" 표시

### 호버 상태

- **높이**: 컨텐츠 높이만큼 확장 (max-height: 50vh)
- **스크롤**: 내용이 길면 내부 스크롤
- **효과**: shadow-lg 추가
- **전환**: transition-all duration-200

---

## 기술 구현

### IntersectionObserver 기반 가시성 추적

```typescript
// Virtuoso의 scrollerRef를 IntersectionObserver의 root로 사용
const observerRef = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      const index = entry.target.getAttribute('data-msg-index');
      if (entry.isIntersecting) {
        visibleMessages.add(index);
      } else {
        visibleMessages.delete(index);
      }
    });
  },
  {
    root: scrollerRef.current,  // Virtuoso의 스크롤 컨테이너
    rootMargin: '0px',
    threshold: 0.1,  // 10% 이상 보이면 visible
  }
);
```

### Pin 계산 로직

```typescript
// 1. 보이는 메시지 중 가장 작은 인덱스 찾기
const firstVisibleIndex = Math.min(...visibleMessages);

// 2. 해당 메시지 타입 확인
if (messages[firstVisibleIndex].role === 'user') {
  // User 메시지가 보이면 pin 없음
  return null;
}

// 3. Assistant 메시지면 위의 user 메시지 찾기
for (let i = firstVisibleIndex - 1; i >= 0; i--) {
  if (messages[i].role === 'user') {
    return messages[i].contents[0]?.content;
  }
}
```

---

## 컴포넌트 구조

### ChatHistory.tsx

- IntersectionObserver 설정 및 관리
- 메시지 가시성 추적
- Pin할 메시지 계산
- `onPinnedUserMessageChange` 콜백으로 부모에 전달

### ChatPanel.tsx

- `pinnedQuery` state 관리
- PinnedQuery 컴포넌트 렌더링 조건 결정

### PinnedQuery.tsx

- Pin UI 렌더링
- 호버 시 확장 동작
- 스타일링 (backdrop blur, border 등)

---

## 테스트 케이스

### 기본 동작

- [ ] 초기 로드 시 맨 아래에 위치
- [ ] 마지막 메시지가 assistant일 때 pin 표시
- [ ] 마지막 메시지가 user일 때 pin 없음

### 스크롤 동작

- [ ] 위로 스크롤 시 해당 응답의 질문으로 pin 변경
- [ ] user 메시지가 보이면 pin 사라짐
- [ ] 아래로 스크롤 시 pin 복원
- [ ] 스트리밍 중 최하단이면 자동 스크롤
- [ ] 스트리밍 중 최하단 아니면 스크롤 안함

### Pin UI

- [ ] 긴 메시지 잘림 처리
- [ ] 호버 시 전체 내용 표시
- [ ] 호버 해제 시 다시 잘림

---

## 관련 파일

| 파일 | 역할 |
|-----|------|
| `presentation/components/chat/ChatHistory.tsx` | 가시성 추적, Pin 계산 |
| `presentation/components/chat/ChatPanel.tsx` | Pin state 관리 |
| `presentation/components/chat/PinnedQuery.tsx` | Pin UI 컴포넌트 |

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 |
|-----|------|---------|
| 1.0 | 2025-02-05 | 초기 스펙 문서 작성 |

---

**Maintained By:** Frontend Team
