# Code Directive: Todo List Feature

## Context

설계 문서를 기반으로 Todo List 애플리케이션 코드를 생성합니다.

## Requirements

1. TypeScript strict 모드
2. React functional components + hooks
3. 컴포넌트별 파일 분리
4. Props 타입 정의
5. 깔끔한 코드 스타일

## Files to Generate

```
outputs/code/
├── App.tsx              # 메인 컴포넌트
├── components/
│   ├── AddTodo.tsx     # 입력 폼
│   ├── FilterButtons.tsx # 필터 버튼
│   ├── TodoList.tsx    # Todo 리스트
│   └── TodoItem.tsx    # 개별 Todo 아이템
├── types/
│   └── todo.ts         # 타입 정의
└── hooks/
    └── useTodos.ts     # Todo 상태 관리 hook
```

## Code Quality

- ESLint 규칙 준수
- 명확한 변수명
- 주석 최소화 (자명한 코드)
- 테스트 가능한 구조

## Mode

generate (새로 생성)

