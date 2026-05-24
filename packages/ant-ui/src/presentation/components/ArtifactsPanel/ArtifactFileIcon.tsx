
import type { ReactElement } from 'react';
import { FileText, Database, Terminal, Palette, File } from 'lucide-react';

/**
 * ArtifactFileIcon — artifact-tree row file icon using the reference
 * b3-explorer.jsx 5-bucket palette.
 *
 * Distinct from the shared `@/shared/utils/file-icons` `FileIcon`
 * (VS Code brand palette) so the artifact area can render the flat
 * palette specified by the reference design while other surfaces keep
 * the richer per-extension iconography.
 *
 * Buckets (matched on lowercased extension):
 *   • md / mdx / txt / doc                       → FileText  + violet-500
 *   • json / yaml / yml / toml                   → Database  + orange-500
 *   • ts / tsx / js / jsx / sh                   → Terminal  + teal-500
 *   • svg / png / jpg / jpeg / gif / webp        → Palette   + pink-500
 *     css / scss
 *   • (default)                                  → File      + text-3
 */
export function ArtifactFileIcon({ name, size = 12 }: { name: string; size?: number }): ReactElement {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';

  switch (ext) {
    case 'md':
    case 'mdx':
    case 'txt':
    case 'doc':
      return <FileText size={size} style={{ color: 'var(--violet-500)', flexShrink: 0 }} />;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return <Database size={size} style={{ color: 'var(--orange-500)', flexShrink: 0 }} />;
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'sh':
      return <Terminal size={size} style={{ color: 'var(--teal-500)', flexShrink: 0 }} />;
    case 'svg':
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'css':
    case 'scss':
      return <Palette size={size} style={{ color: 'var(--pink-500)', flexShrink: 0 }} />;
    default:
      return <File size={size} style={{ color: 'var(--text-3)', flexShrink: 0 }} />;
  }
}
