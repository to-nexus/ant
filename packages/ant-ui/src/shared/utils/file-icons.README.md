# File Icons Utility

파일 확장자별 아이콘을 일관되게 표시하기 위한 유틸리티입니다. VS Code의 file-icons 규칙을 따릅니다.

## 사용된 아이콘 라이브러리

- **lucide-react**: 일반 파일 아이콘 (FileText, Folder, Settings 등)
- **react-icons/si**: 특정 기술 스택 아이콘 (React, TypeScript, JavaScript 등)

## 지원하는 파일 유형

### 프로그래밍 언어
- `.tsx`, `.jsx` → React 아이콘 (🔵 blue #61DAFB)
- `.ts` → TypeScript 아이콘 (🔵 blue #3178C6)
- `.js`, `.mjs`, `.cjs` → JavaScript 아이콘 (🟡 yellow #F7DF1E)
- `.py` → Python 아이콘 (🔵 blue #3776AB)
- `.go` → Go 아이콘 (🔵 cyan #00ADD8)
- `.rs` → Rust 아이콘 (🟠 orange #CE422B)

### 마크업 / 스타일
- `.html`, `.htm` → HTML5 아이콘 (🟠 orange #E34F26)
- `.css` → CSS3 아이콘 (🔵 blue #1572B6)
- `.scss`, `.sass` → Sass 아이콘 (🟣 pink #CC6699)
- `.less` → Less 아이콘 (🔵 dark blue #1D365D)

### 문서 / 설정
- `.md`, `.mdx` → Markdown 아이콘 (회색)
- `.json`, `.jsonc`, `.json5` → JSON 아이콘 (🟡 yellow #FFCA28)
- `.yaml`, `.yml` → YAML 아이콘 (🔴 red #CB171E)
- `.env`, `.env.*` → Settings 톱니바퀴 아이콘 (회색)

### Docker / Git
- `Dockerfile`, `.dockerignore` → Docker 아이콘 (🔵 blue #2496ED)
- `.gitignore`, `.gitattributes` → Git 아이콘 (🟠 orange #F05032)

### 패키지 매니저
- `package.json`, `package-lock.json` → npm 아이콘 (🔴 red #CB3837)
- `yarn.lock` → Yarn 아이콘 (🔵 blue #2C8EBB)
- `pnpm-lock.yaml` → pnpm 아이콘 (🟠 orange #F69220)

### 미디어 파일
- 이미지: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico` (🟣 purple)
- 비디오: `.mp4`, `.mov`, `.avi`, `.webm` (🌸 pink)

### 압축 파일
- `.zip`, `.tar`, `.gz`, `.rar`, `.7z` (🟤 amber)

## 사용법

### 1. 컴포넌트로 사용

```tsx
import { FileIcon } from '@/shared/utils/file-icons';

function MyComponent() {
  return (
    <div>
      <FileIcon filePath="App.tsx" size={16} />
      <FileIcon filePath="package.json" size={20} />
      <FileIcon filePath=".env" />
    </div>
  );
}
```

### 2. 설정 객체만 가져오기

```tsx
import { getFileIcon } from '@/shared/utils/file-icons';

const config = getFileIcon('App.tsx');
// config.icon - React component
// config.color - Tailwind color class (e.g., 'text-[#61DAFB]')

const Icon = config.icon;
return <Icon className={config.color} size={16} />;
```

## 폴더 아이콘

폴더는 lucide-react의 `Folder` / `FolderOpen` 아이콘을 사용합니다:

```tsx
import { Folder, FolderOpen } from 'lucide-react';

{isExpanded ? (
  <FolderOpen className="w-4 h-4 text-blue-500" />
) : (
  <Folder className="w-4 h-4 text-blue-500" />
)}
```

## 적용된 컴포넌트

현재 다음 컴포넌트들에서 파일 아이콘을 사용합니다:

1. **FileBrowser.tsx** - 메인 파일 브라우저
2. **ArtifactsPanel.tsx** - Artifacts 패널의 파일 트리
3. **FeatureDetails.tsx** - Feature 상세의 파일 트리
4. **FileCard.tsx** - 채팅 UI의 파일 카드 헤더

## 새로운 파일 타입 추가하기

`file-icons.tsx`의 `FILE_ICON_MAP` 또는 `SPECIAL_FILENAME_MAP`에 추가:

```typescript
// 확장자 기반
'vue': { icon: SiVuedotjs, color: 'text-[#4FC08D]' },

// 파일명 기반
'webpack.config.js': { icon: SiWebpack, color: 'text-[#8DD6F9]' },
```

## 아이콘 우선순위

1. **특수 파일명** (대소문자 무시): `.gitignore`, `Dockerfile`, `package.json` 등
2. **파일 확장자**: `.tsx`, `.js`, `.py` 등
3. **복합 확장자**: `.spec.ts`, `.test.js` 등 (미래 확장 가능)
4. **기본값**: `FileText` 아이콘 (회색)

## 색상 규칙

- 공식 브랜드 색상 사용 (React blue, TypeScript blue, Python blue 등)
- Hex 색상코드를 Tailwind의 `text-[#HEXCODE]` 형식으로 지정
- 다크 모드 대응을 위해 `dark:text-[#HEXCODE]` 형식도 지원

## 참고

이 아이콘 매핑은 다음 프로젝트들의 규칙을 따릅니다:
- [VS Code File Icons](https://github.com/vscode-icons/vscode-icons)
- [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
- [Simple Icons](https://simpleicons.org/)


