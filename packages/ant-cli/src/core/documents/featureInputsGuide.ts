export function getFeatureInputsGuideMarkdown(): string {
  return `# Feature Inputs Guide (RAG)

이 문서는 "피처 inputs/sources에 무엇을 넣어야 하는가?"를 채팅에서 RAG로 안내하기 위한 가이드입니다.

## 템플릿/플레이스홀더 처리 규칙 (중요)
- 피처 생성 시 만들어지는 입력 파일에는 기본적으로 **\`<!-- ant:template -->\`** 마커가 들어있습니다.
- 이 마커가 남아있으면 시스템은 해당 파일을 **"아직 비어있는 입력"** 으로 간주하여 프롬프트/컨텍스트에 넣지 않습니다.
- 작성이 끝나면 파일 상단의 **\`<!-- ant:template -->\`** 줄을 삭제하세요.

## 필수(항상)
- **\`inputs/sources/prd.md\`**
  - **design job**: 설계 생성의 주 입력
  - **code job**: 요구사항 컨텍스트(구현 기준)

## 옵션(UI/FE 작업일 때 권장)
- **\`inputs/sources/ui-spec.md\`**: 화면/상태/인터랙션/반응형 규칙
- **\`inputs/sources/components.md\`**: 컴포넌트 variants/sizes/states
- **\`inputs/sources/tokens.md\`**: 색/타이포/스페이싱 토큰
- **\`inputs/sources/ui-assets.md\`**: (선택) 이미지 캡션/주의사항 메모 (비워도 됨)

## 옵션(UI 에셋)
- **\`inputs/sources/assets/screens/*\`**: 화면 스크린샷 (png/jpg/webp/gif)
- **\`inputs/sources/assets/components/*\`**: 컴포넌트 상태 스냅샷 (png/jpg/webp/gif)
- **\`inputs/sources/assets/icons/*\`**: 아이콘 (svg)

## directives는 언제 쓰나?
- **\`inputs/directives/design/directive.md\`**: PRD에 없는 추가 요구/제약을 design job에 전달(옵션)
- **\`inputs/directives/code/directive.md\`**: code job에서 변경 요청/버그 수정 등 추가 지시(옵션)

## IMPORTANT: UI 태스크 판정
- code job의 decompose 출력 task 객체에는 **\`"ui": true|false\`**가 필수
- \`ui:true\`인 태스크에서만 UI 문서/이미지가 동적으로 주입됨
`;
}


