import { useMemo, useState } from 'react';
import YAML from 'yaml';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface JsonYamlPreviewProps {
  content: string;
  fileType: 'json' | 'yaml';
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
    return <span className="text-gray-500 dark:text-gray-400 italic">null</span>;
  }

  if (value === undefined) {
    return <span className="text-gray-500 dark:text-gray-400 italic">undefined</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className="text-purple-600 dark:text-purple-400 font-medium">
        {value ? 'true' : 'false'}
      </span>
    );
  }

  if (typeof value === 'number') {
    return <span className="text-blue-600 dark:text-blue-400">{value}</span>;
  }

  if (typeof value === 'string') {
    return (
      <span className="text-green-600 dark:text-green-400">
        "{value}"
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-gray-600 dark:text-gray-400">[]</span>;
    }

    return (
      <span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <span className="text-gray-600 dark:text-gray-400">[</span>
        {!expanded && (
          <span className="text-gray-400 dark:text-gray-500 text-xs ml-1">
            {value.length} items...
          </span>
        )}
        {expanded && (
          <div>
            {value.map((item, idx) => (
              <div key={idx} style={indentStyle}>
                <span className="text-gray-400 dark:text-gray-500 mr-1 select-none">{idx}:</span>
                <RenderValue value={item} indent={indent + 1} />
              </div>
            ))}
          </div>
        )}
        <span className="text-gray-600 dark:text-gray-400">]</span>
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-gray-600 dark:text-gray-400">{'{}'}</span>;
    }

    return (
      <span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <span className="text-gray-600 dark:text-gray-400">{'{'}</span>
        {!expanded && (
          <span className="text-gray-400 dark:text-gray-500 text-xs ml-1">
            {entries.length} keys...
          </span>
        )}
        {expanded && (
          <div>
            {entries.map(([key, val]) => (
              <div key={key} style={indentStyle}>
                <span className="text-rose-600 dark:text-rose-400 font-medium mr-1">"{key}"</span>
                <span className="text-gray-500 dark:text-gray-400 mr-1">:</span>
                <RenderValue value={val} indent={indent + 1} />
              </div>
            ))}
          </div>
        )}
        <span className="text-gray-600 dark:text-gray-400">{'}'}</span>
      </span>
    );
  }

  return <span className="text-gray-600 dark:text-gray-400">{String(value)}</span>;
}

export function JsonYamlPreview({ content, fileType }: JsonYamlPreviewProps) {
  const { parsed, error } = useMemo(() => {
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
      return { parsed: null, error: e instanceof Error ? e.message : 'Parse error' };
    }
  }, [content, fileType]);

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-500 dark:text-red-400 font-medium mb-2">
          ⚠️ {fileType.toUpperCase()} Parse Error
        </div>
        <pre className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-md overflow-x-auto">
          {error}
        </pre>
        <div className="mt-4 text-gray-500 dark:text-gray-400 text-sm">
          Raw content:
        </div>
        <pre className="mt-2 text-sm font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
          {content}
        </pre>
      </div>
    );
  }

  if (parsed === null && !content.trim()) {
    return (
      <div className="p-4 text-gray-500 dark:text-gray-400 text-sm">
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
