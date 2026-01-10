/**
 * File Icon Mapping Utility
 * 
 * Maps file extensions to appropriate icons following VS Code conventions.
 * Uses a combination of lucide-react (general icons) and react-icons (specific file types).
 */

import { 
  FileText, 
  FileJson, 
  Settings,
  File,
  FileCode,
  FileImage,
  FileVideo,
  FileArchive,
  Database,
  Folder
} from 'lucide-react';

// Import from react-icons for specific file type icons
// These will be installed via: npm install react-icons
import type { IconType } from 'react-icons';
import { 
  SiTypescript,
  SiJavascript,
  SiReact,
  SiPython,
  SiGo,
  SiRust,
  SiCss3,
  SiHtml5,
  SiMarkdown,
  SiJson,
  SiDocker,
  SiGit,
  SiNpm,
  SiYarn,
  SiYaml
} from 'react-icons/si';

export interface FileIconConfig {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  color: string; // Tailwind color class
}

/**
 * File extension to icon mapping
 * Following VS Code file-icons conventions
 */
const FILE_ICON_MAP: Record<string, FileIconConfig> = {
  // TypeScript / JavaScript / React
  'tsx': { icon: SiReact, color: 'text-[#61DAFB]' },          // React blue
  'jsx': { icon: SiReact, color: 'text-[#61DAFB]' },          // React blue
  'ts': { icon: SiTypescript, color: 'text-[#3178C6]' },      // TypeScript blue
  'js': { icon: SiJavascript, color: 'text-[#F7DF1E]' },      // JavaScript yellow
  'mjs': { icon: SiJavascript, color: 'text-[#F7DF1E]' },
  'cjs': { icon: SiJavascript, color: 'text-[#F7DF1E]' },
  
  // Markup / Styling
  'html': { icon: SiHtml5, color: 'text-[#E34F26]' },         // HTML orange
  'htm': { icon: SiHtml5, color: 'text-[#E34F26]' },
  'css': { icon: SiCss3, color: 'text-[#1572B6]' },           // CSS blue
  'scss': { icon: SiCss3, color: 'text-[#CC6699]' },          // Sass pink
  'sass': { icon: SiCss3, color: 'text-[#CC6699]' },
  'less': { icon: SiCss3, color: 'text-[#1D365D]' },
  
  // Markdown / Documentation
  'md': { icon: SiMarkdown, color: 'text-gray-600 dark:text-gray-400' },
  'mdx': { icon: SiMarkdown, color: 'text-gray-600 dark:text-gray-400' },
  'markdown': { icon: SiMarkdown, color: 'text-gray-600 dark:text-gray-400' },
  
  // Configuration / Data
  'json': { icon: SiJson, color: 'text-[#FFCA28]' },          // JSON yellow
  'jsonc': { icon: SiJson, color: 'text-[#FFCA28]' },
  'json5': { icon: SiJson, color: 'text-[#FFCA28]' },
  'yaml': { icon: SiYaml, color: 'text-[#CB171E]' },           // YAML red
  'yml': { icon: SiYaml, color: 'text-[#CB171E]' },
  'toml': { icon: FileCode, color: 'text-gray-600 dark:text-gray-400' },
  'xml': { icon: FileCode, color: 'text-[#FF6600]' },
  
  // Environment / Config
  'env': { icon: Settings, color: 'text-gray-500 dark:text-gray-400' },
  'env.local': { icon: Settings, color: 'text-gray-500 dark:text-gray-400' },
  'env.development': { icon: Settings, color: 'text-gray-500 dark:text-gray-400' },
  'env.production': { icon: Settings, color: 'text-gray-500 dark:text-gray-400' },
  
  // Docker
  'dockerfile': { icon: SiDocker, color: 'text-[#2496ED]' },  // Docker blue
  
  // Git
  'gitignore': { icon: SiGit, color: 'text-[#F05032]' },      // Git orange
  'gitattributes': { icon: SiGit, color: 'text-[#F05032]' },
  
  // Package Managers
  'package.json': { icon: SiNpm, color: 'text-[#CB3837]' },   // npm red
  'package-lock.json': { icon: SiNpm, color: 'text-[#CB3837]' },
  'yarn.lock': { icon: SiYarn, color: 'text-[#2C8EBB]' },     // Yarn blue
  'pnpm-lock.yaml': { icon: FileJson, color: 'text-[#F69220]' },
  
  // Other Languages
  'py': { icon: SiPython, color: 'text-[#3776AB]' },          // Python blue
  'go': { icon: SiGo, color: 'text-[#00ADD8]' },              // Go cyan
  'rs': { icon: SiRust, color: 'text-[#000000] dark:text-[#CE422B]' }, // Rust orange
  
  // Images
  'png': { icon: FileImage, color: 'text-purple-500' },
  'jpg': { icon: FileImage, color: 'text-purple-500' },
  'jpeg': { icon: FileImage, color: 'text-purple-500' },
  'gif': { icon: FileImage, color: 'text-purple-500' },
  'svg': { icon: FileImage, color: 'text-purple-500' },
  'webp': { icon: FileImage, color: 'text-purple-500' },
  'ico': { icon: FileImage, color: 'text-purple-500' },
  
  // Video
  'mp4': { icon: FileVideo, color: 'text-pink-500' },
  'mov': { icon: FileVideo, color: 'text-pink-500' },
  'avi': { icon: FileVideo, color: 'text-pink-500' },
  'webm': { icon: FileVideo, color: 'text-pink-500' },
  
  // Archives
  'zip': { icon: FileArchive, color: 'text-amber-600' },
  'tar': { icon: FileArchive, color: 'text-amber-600' },
  'gz': { icon: FileArchive, color: 'text-amber-600' },
  'rar': { icon: FileArchive, color: 'text-amber-600' },
  '7z': { icon: FileArchive, color: 'text-amber-600' },
  
  // Database
  'sql': { icon: Database, color: 'text-blue-500' },
  'db': { icon: Database, color: 'text-blue-500' },
  'sqlite': { icon: Database, color: 'text-blue-500' },
};

/**
 * Special filename mappings (exact match, case-insensitive)
 */
const SPECIAL_FILENAME_MAP: Record<string, FileIconConfig> = {
  'dockerfile': { icon: SiDocker, color: 'text-[#2496ED]' },
  '.dockerignore': { icon: SiDocker, color: 'text-[#2496ED]' },
  '.gitignore': { icon: SiGit, color: 'text-[#F05032]' },
  '.gitattributes': { icon: SiGit, color: 'text-[#F05032]' },
  '.env': { icon: Settings, color: 'text-gray-500 dark:text-gray-400' },
  '.env.local': { icon: Settings, color: 'text-gray-500 dark:text-gray-400' },
  '.env.development': { icon: Settings, color: 'text-gray-500 dark:text-gray-400' },
  '.env.production': { icon: Settings, color: 'text-gray-500 dark:text-gray-400' },
  'package.json': { icon: SiNpm, color: 'text-[#CB3837]' },
  'package-lock.json': { icon: SiNpm, color: 'text-[#CB3837]' },
  'yarn.lock': { icon: SiYarn, color: 'text-[#2C8EBB]' },
  'pnpm-lock.yaml': { icon: FileJson, color: 'text-[#F69220]' },
  'tsconfig.json': { icon: SiTypescript, color: 'text-[#3178C6]' },
  'jsconfig.json': { icon: SiJavascript, color: 'text-[#F7DF1E]' },
};

/**
 * Get file icon configuration for a given file path or name
 * @param filePath - Full file path or filename (directories end with /)
 * @returns Icon configuration with component and color
 */
export function getFileIcon(filePath: string): FileIconConfig {
  // ✅ CRITICAL: Handle non-string inputs (FileWithSource objects, etc.)
  if (!filePath || typeof filePath !== 'string') {
    return {
      icon: FileText,
      color: 'text-gray-500 dark:text-gray-400'
    };
  }
  
  // 0. Check if it's a directory (ends with /)
  if (filePath.endsWith('/')) {
    return {
      icon: Folder,
      color: 'text-blue-500 dark:text-blue-400'
    };
  }
  
  const fileName = filePath.split('/').pop() || filePath;
  const lowerFileName = fileName.toLowerCase();
  
  // 1. Check special filename (exact match)
  if (SPECIAL_FILENAME_MAP[lowerFileName]) {
    return SPECIAL_FILENAME_MAP[lowerFileName];
  }
  
  // 2. Check file extension
  const extension = fileName.includes('.') 
    ? fileName.split('.').pop()?.toLowerCase() 
    : undefined;
  
  if (extension && FILE_ICON_MAP[extension]) {
    return FILE_ICON_MAP[extension];
  }
  
  // 3. Check compound extensions (e.g., .spec.ts, .test.js)
  const parts = fileName.split('.');
  if (parts.length > 2) {
    const compoundExt = parts.slice(-2).join('.').toLowerCase();
    if (FILE_ICON_MAP[compoundExt]) {
      return FILE_ICON_MAP[compoundExt];
    }
  }
  
  // 4. Default: generic file icon
  return {
    icon: FileText,
    color: 'text-gray-500 dark:text-gray-400'
  };
}

/**
 * Render file icon as a React component
 * @param filePath - Full file path or filename (can be string or FileWithSource object)
 * @param size - Icon size (default: 16)
 * @param className - Additional CSS classes
 */
export function FileIcon({ 
  filePath, 
  size = 16, 
  className = '' 
}: { 
  filePath: string | any; 
  size?: number; 
  className?: string;
}) {
  // ✅ CRITICAL: Handle FileWithSource objects {path, sources, priority, hasLocalChanges}
  const path = typeof filePath === 'string' ? filePath : filePath?.path || '';
  const config = getFileIcon(path);
  const Icon = config.icon;
  
  return (
    <Icon 
      className={`${config.color} ${className} flex-shrink-0`} 
      size={size}
    />
  );
}

