import type { Components } from 'react-markdown';
import { MermaidBlock } from './MermaidBlock';

interface MarkdownComponentsOptions {
  paragraphClassName?: string;
  headingClassName?: {
    h1?: string;
    h2?: string;
    h3?: string;
  };
  paragraphTag?: 'div' | 'p';
}

function extractCodeText(children: React.ReactNode): string {
  return String(children).replace(/\n$/, '');
}

export function createMarkdownComponents(
  options: MarkdownComponentsOptions = {},
): Components {
  const paragraphClassName = options.paragraphClassName ?? 'my-2 leading-relaxed break-words';
  const paragraphTag = options.paragraphTag ?? 'div';

  return {
    pre: ({ node, className, children, ...props }) => (
      <pre
        className="my-2 px-4 py-3 rounded-lg text-sm font-mono whitespace-pre-wrap break-words"
        style={{
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          background: 'var(--bg-surface-2)',
          color: 'var(--text-1)',
          border: '1px solid var(--border-1)',
        }}
        {...props}
      >
        {children}
      </pre>
    ),
    code: ({ node, className, children, ...props }) => {
      const text = extractCodeText(children);
      const hasLanguage = /language-\w+/.test(className || '');
      const isMultiLine = text.includes('\n');
      const isMermaid = /language-mermaid/.test(className || '');

      if (isMermaid) {
        return <MermaidBlock code={text} />;
      }

      if (hasLanguage || isMultiLine) {
        return (
          <code className={className} style={{ color: 'inherit' }} {...props}>
            {children}
          </code>
        );
      }

      return (
        <code
          className="px-1.5 py-0.5 rounded text-sm font-mono break-words"
          style={{
            background: 'var(--bg-surface-3)',
            color: 'var(--text-1)',
            border: '1px solid var(--border-1)',
          }}
          {...props}
        >
          {children}
        </code>
      );
    },
    a: ({ node, children, ...props }) => (
      <a
        className="hover:underline break-words"
        style={{ color: 'var(--violet-600)' }}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    ),
    table: ({ node, children, ...props }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full divide-y divide-[color:var(--border-1)]" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ node, children, ...props }) => (
      <th
        className="px-4 py-2 text-left text-xs font-semibold break-words"
        style={{ background: 'var(--bg-surface-2)', color: 'var(--text-1)' }}
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ node, children, ...props }) => (
      <td
        className="px-4 py-2 border-t border-[color:var(--border-1)] text-sm break-words"
        style={{ color: 'var(--text-1)' }}
        {...props}
      >
        {children}
      </td>
    ),
    p:
      paragraphTag === 'p'
        ? ({ node, children, ...props }) => (
            <p className={paragraphClassName} {...props}>
              {children}
            </p>
          )
        : ({ node, children, ...props }) => (
            <div className={paragraphClassName} {...props}>
              {children}
            </div>
          ),
    h1: ({ node, children, ...props }) => (
      <h1 className={options.headingClassName?.h1 ?? 'text-xl font-bold my-3 break-words'} {...props}>
        {children}
      </h1>
    ),
    h2: ({ node, children, ...props }) => (
      <h2 className={options.headingClassName?.h2 ?? 'text-lg font-bold my-2 break-words'} {...props}>
        {children}
      </h2>
    ),
    h3: ({ node, children, ...props }) => (
      <h3 className={options.headingClassName?.h3 ?? 'text-base font-bold my-2 break-words'} {...props}>
        {children}
      </h3>
    ),
  };
}
