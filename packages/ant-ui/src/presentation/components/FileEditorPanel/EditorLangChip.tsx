
interface EditorLangChipProps {
  filePath: string | null;
}

function inferLang(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = lower.slice(dot + 1);
  // Map common variants to short canonical labels.
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'md';
    case 'jsonl':
      return 'jsonl';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'tsx':
      return 'tsx';
    case 'jsx':
      return 'jsx';
    case 'ts':
      return 'ts';
    case 'js':
      return 'js';
    case 'svg':
      return 'svg';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'json':
      return 'json';
    case 'py':
      return 'py';
    case 'go':
      return 'go';
    case 'rs':
      return 'rs';
    case 'sh':
      return 'sh';
    case 'txt':
      return 'txt';
    default:
      // For unknown extensions, fall back to the raw ext (short ones only).
      return ext.length <= 5 ? ext : null;
  }
}

/**
 * Aurora pill chip rendering the detected language of the current file.
 * Returns `null` when no path is selected (no chip slot consumed).
 */
export function EditorLangChip({ filePath }: EditorLangChipProps) {
  if (!filePath) return null;
  const lang = inferLang(filePath);
  if (!lang) return null;
  return (
    <span
      style={{
        padding: '2px 8px',
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-pill)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--text-3)',
        fontFamily: 'var(--font-mono)',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {lang}
    </span>
  );
}
