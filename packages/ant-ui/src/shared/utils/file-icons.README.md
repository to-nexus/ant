# File Icons Utility

A utility for displaying per-extension file icons consistently. It follows VS Code's file-icons conventions.

## Icon Libraries Used

- **lucide-react**: generic file icons (FileText, Folder, Settings, etc.)
- **react-icons/si**: technology-specific icons (React, TypeScript, JavaScript, etc.)

## Supported File Types

### Programming Languages
- `.tsx`, `.jsx` → React icon (🔵 blue #61DAFB)
- `.ts` → TypeScript icon (🔵 blue #3178C6)
- `.js`, `.mjs`, `.cjs` → JavaScript icon (🟡 yellow #F7DF1E)
- `.py` → Python icon (🔵 blue #3776AB)
- `.go` → Go icon (🔵 cyan #00ADD8)
- `.rs` → Rust icon (🟠 orange #CE422B)

### Markup / Styles
- `.html`, `.htm` → HTML5 icon (🟠 orange #E34F26)
- `.css` → CSS3 icon (🔵 blue #1572B6)
- `.scss`, `.sass` → Sass icon (🟣 pink #CC6699)
- `.less` → Less icon (🔵 dark blue #1D365D)

### Documents / Configuration
- `.md`, `.mdx` → Markdown icon (gray)
- `.json`, `.jsonc`, `.json5` → JSON icon (🟡 yellow #FFCA28)
- `.yaml`, `.yml` → YAML icon (🔴 red #CB171E)
- `.env`, `.env.*` → Settings gear icon (gray)

### Docker / Git
- `Dockerfile`, `.dockerignore` → Docker icon (🔵 blue #2496ED)
- `.gitignore`, `.gitattributes` → Git icon (🟠 orange #F05032)

### Package Managers
- `package.json`, `package-lock.json` → npm icon (🔴 red #CB3837)
- `yarn.lock` → Yarn icon (🔵 blue #2C8EBB)
- `pnpm-lock.yaml` → pnpm icon (🟠 orange #F69220)

### Media Files
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico` (🟣 purple)
- Video: `.mp4`, `.mov`, `.avi`, `.webm` (🌸 pink)

### Archives
- `.zip`, `.tar`, `.gz`, `.rar`, `.7z` (🟤 amber)

## Usage

### 1. As a component

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

### 2. Fetching the config object only

```tsx
import { getFileIcon } from '@/shared/utils/file-icons';

const config = getFileIcon('App.tsx');
// config.icon - React component
// config.color - Tailwind color class (e.g., 'text-[#61DAFB]')

const Icon = config.icon;
return <Icon className={config.color} size={16} />;
```

## Folder Icons

Folders use the `Folder` / `FolderOpen` icons from lucide-react:

```tsx
import { Folder, FolderOpen } from 'lucide-react';

{isExpanded ? (
  <FolderOpen className="w-4 h-4 text-blue-500" />
) : (
  <Folder className="w-4 h-4 text-blue-500" />
)}
```

## Consuming Components

File icons are currently used by the following components:

1. **ArtifactsPanel/ArtifactFileIcon.tsx** - the file tree in the Artifacts panel
2. **chat/FileCard.tsx** - the file card header in the chat UI
3. **common/PathPicker.tsx** / **common/FileTreePicker.tsx** - file pickers

## Adding a New File Type

Add an entry to `FILE_ICON_MAP` or `SPECIAL_FILENAME_MAP` in `file-icons.tsx`:

```typescript
// By extension
'vue': { icon: SiVuedotjs, color: 'text-[#4FC08D]' },

// By filename
'webpack.config.js': { icon: SiWebpack, color: 'text-[#8DD6F9]' },
```

## Icon Resolution Priority

1. **Special filenames** (case-insensitive): `.gitignore`, `Dockerfile`, `package.json`, etc.
2. **File extension**: `.tsx`, `.js`, `.py`, etc.
3. **Compound extensions**: `.spec.ts`, `.test.js`, etc. (room for future extension)
4. **Default**: the `FileText` icon (gray)

## Color Conventions

- Use official brand colors (React blue, TypeScript blue, Python blue, etc.)
- Specify hex color codes using Tailwind's `text-[#HEXCODE]` form
- The `dark:text-[#HEXCODE]` form is also supported for dark mode

## References

This icon mapping follows the conventions of these projects:
- [VS Code File Icons](https://github.com/vscode-icons/vscode-icons)
- [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
- [Simple Icons](https://simpleicons.org/)
