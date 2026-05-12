# @ant/ui

ANT 프론트엔드 패키지. React + Vite 기반 SPA로, Clean Architecture 레이어 구조를 따른다.

## 디렉토리 구조

```
src/
    main.tsx                진입점
    i18n/                   국제화 (en, ko)
    presentation/           UI 레이어
        App.tsx             루트 컴포넌트
        components/
            chat/           ChatPanel, ChatHistory, ChatInput, ChoiceCard, MessageItem
            kanban/         Kanban 보드
            workflow/       워크플로우 그래프 (ReactFlow)
            layout/         MainContentArea, 패널 레이아웃
            auth/           인증
            Transfer/       코드 전송
            FeatureSection/ 피처 관리
            PreviewConfigEditor/ Preview 설정
            ConfigEditor/   프로젝트/계정 설정
        pages/              WelcomePage, QuickStart
        providers/          AlertModal, Toast
    application/            유스케이스 레이어
        hooks/
            features/       useJobExecution, useKanban, useWorkflow
            ui/             useToast, useLayoutState, useChatPolicy
    domain/                 도메인 레이어
        store/
            index.ts        Zustand 스토어 (12 슬라이스)
            slices/         project, file, job, sse, ui, git, preview, auth, config, chat, transfer, reset
        models/             task, chat, session, workflow
    infrastructure/         인프라 레이어
        http/
            api.ts          HTTP 클라이언트
        sse/
            SSEManager.ts   SSE 연결 관리 (싱글톤)
    shared/                 유틸리티
        utils/              path-utils, workspace-path
```

## 아키텍처 규약

```
Presentation -> Application -> Domain <- Infrastructure
```

- Presentation은 Application 훅을 사용한다 (Domain 직접 접근 금지)
- Application은 Domain(스토어)을 사용한다
- Infrastructure는 Domain을 import하지 않는다

## 백엔드 연동

- **HTTP**: `infrastructure/http/api.ts`. Local은 Vite 프록시, Cloud는 `VITE_CLOUD_BACKEND_BASE`
- **SSE**: `infrastructure/sse/SSEManager.ts`. Unified(project/feature) + Workflow(jobId) 두 연결

## 주요 의존성

| 카테고리 | 패키지 |
|----------|--------|
| Core | react, react-dom |
| State | zustand |
| Styling | tailwindcss, tailwind-merge, class-variance-authority |
| UI | @radix-ui/react-slot, lucide-react, framer-motion |
| Visualization | reactflow, dagre |
| i18n | i18next, react-i18next |
| Build | vite, typescript |
| Shared | @ant/shared (workspace) |
