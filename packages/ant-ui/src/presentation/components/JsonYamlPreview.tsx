import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import YAML from 'yaml';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface JsonYamlPreviewProps {
  content: string;
  fileType: 'json' | 'jsonl' | 'yaml';
}

interface RenderValueProps {
  value: unknown;
  indent: number;
  defaultExpanded?: boolean;
}

function RenderValue({ value, indent, defaultExpanded = true }: RenderValueProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const indentStyle = { marginLeft: '12px' };

  if (value === null) {
    return <span className="text-[color:var(--text-3)] italic">null</span>;
  }

  if (value === undefined) {
    return <span className="text-[color:var(--text-3)] italic">undefined</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className="text-purple-600 font-medium">
        {value ? 'true' : 'false'}
      </span>
    );
  }

  if (typeof value === 'number') {
    return <span className="text-blue-600">{value}</span>;
  }

  if (typeof value === 'string') {
    return (
      <span className="text-green-600">
        "{value}"
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-[color:var(--text-3)]">[]</span>;
    }

    return (
      <span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center text-gray-500 hover:text-gray-700"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <span className="text-[color:var(--text-3)]">[</span>
        {!expanded && (
          <span className="text-[color:var(--text-4)] text-xs ml-1">
            {value.length} items...
          </span>
        )}
        {expanded && (
          <div>
            {value.map((item, idx) => (
              <div key={idx} style={indentStyle}>
                <span className="text-[color:var(--text-4)] mr-1 select-none">{idx}:</span>
                <RenderValue value={item} indent={indent + 1} />
              </div>
            ))}
          </div>
        )}
        <span className="text-[color:var(--text-3)]">]</span>
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-[color:var(--text-3)]">{'{}'}</span>;
    }

    return (
      <span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center text-gray-500 hover:text-gray-700"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <span className="text-[color:var(--text-3)]">{'{'}</span>
        {!expanded && (
          <span className="text-[color:var(--text-4)] text-xs ml-1">
            {entries.length} keys...
          </span>
        )}
        {expanded && (
          <div>
            {entries.map(([key, val]) => (
              <div key={key} style={indentStyle}>
                <span className="text-rose-600 font-medium mr-1">"{key}"</span>
                <span className="text-[color:var(--text-3)] mr-1">:</span>
                <RenderValue value={val} indent={indent + 1} />
              </div>
            ))}
          </div>
        )}
        <span className="text-[color:var(--text-3)]">{'}'}</span>
      </span>
    );
  }

  return <span className="text-[color:var(--text-3)]">{String(value)}</span>;
}

interface JsonlLine {
  index: number;
  parsed: unknown;
  error: string | null;
  raw: string;
}

function JsonlPreview({ content, t }: { content: string; t: (key: string) => string }) {
  const lines = useMemo<JsonlLine[]>(() => {
    return content
      .split('\n')
      .map((raw, i) => ({ raw, index: i }))
      .filter(({ raw }) => raw.trim() !== '')
      .map(({ raw, index }) => {
        try {
          return { index, parsed: JSON.parse(raw), error: null, raw };
        } catch (e) {
          return { index, parsed: null, error: e instanceof Error ? e.message : t('editor.parseError'), raw };
        }
      });
  }, [content, t]);

  if (lines.length === 0) {
    return (
      <div className="p-4 text-[color:var(--text-3)] text-sm">
        Empty file
      </div>
    );
  }

  return (
    <div className="p-4 font-mono text-sm leading-relaxed space-y-2">
      {lines.map(({ index, parsed, error, raw }) => (
        <div key={index} className="border border-[color:var(--border-1)] rounded-md overflow-hidden">
          <div className="px-2 py-1 bg-[color:var(--bg-surface-2)] text-xs text-[color:var(--text-4)] select-none">
            Line {index + 1}
          </div>
          <div className="p-2">
            {error ? (
              <>
                <div className="text-red-500 text-xs mb-1">⚠️ Parse Error: {error}</div>
                <pre className="text-xs text-[color:var(--text-3)] whitespace-pre-wrap">{raw}</pre>
              </>
            ) : (
              <RenderValue value={parsed} indent={1} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function JsonYamlPreview({ content, fileType }: JsonYamlPreviewProps) {
  const { t } = useTranslation('artifacts');

  if (fileType === 'jsonl') {
    return <JsonlPreview content={content} t={t} />;
  }

  const { parsed, error } = (() => {
    if (!content.trim()) {
      return { parsed: null, error: null };
    }

    try {
      if (fileType === 'json') {
        return { parsed: JSON.parse(content), error: null };
      } else {
        return { parsed: YAML.parse(content), error: null };
      }
    } catch (e) {
      return { parsed: null, error: e instanceof Error ? e.message : t('editor.parseError') };
    }
  })();

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-500 font-medium mb-2">
          ⚠️ {fileType.toUpperCase()} Parse Error
        </div>
        <pre className="text-sm text-red-600 bg-red-50 p-3 rounded-md overflow-x-auto">
          {error}
        </pre>
        <div className="mt-4 text-[color:var(--text-3)] text-sm">
          Raw content:
        </div>
        <pre className="mt-2 text-sm font-mono text-[color:var(--text-2)] whitespace-pre-wrap">
          {content}
        </pre>
      </div>
    );
  }

  if (parsed === null && !content.trim()) {
    return (
      <div className="p-4 text-[color:var(--text-3)] text-sm">
        Empty file
      </div>
    );
  }

  return (
    <div className="p-4 font-mono text-sm leading-relaxed">
      <RenderValue value={parsed} indent={1} />
    </div>
  );
}
