import { memo, useEffect, useMemo, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidBlockProps {
  code: string;
}

type MermaidState =
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string };

const svgCache = new Map<string, string>();
let mermaidInitialized = false;
let sequence = 0;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
  });
  mermaidInitialized = true;
}

function createRenderId(code: string): string {
  sequence += 1;
  const normalized = code.trim();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `mermaid-${hash.toString(36)}-${sequence}`;
}

function FallbackCodeBlock({ code, errorMessage }: { code: string; errorMessage?: string }) {
  return (
    <div className="space-y-2">
      {errorMessage && (
        <div className="text-xs" style={{ color: 'var(--status-error-fg)' }}>
          Mermaid rendering failed: {errorMessage}
        </div>
      )}
      <pre
        className="my-2 px-4 py-3 rounded-lg bg-[color:var(--bg-canvas)] text-sm font-mono whitespace-pre-wrap break-words"
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        <code className="language-mermaid">{code}</code>
      </pre>
    </div>
  );
}

export const MermaidBlock = memo(function MermaidBlock({ code }: MermaidBlockProps) {
  const normalizedCode = useMemo(() => code.trim(), [code]);
  const [state, setState] = useState<MermaidState>(() => {
    const cached = svgCache.get(normalizedCode);
    if (cached) {
      return { status: 'rendered', svg: cached };
    }
    return { status: 'loading' };
  });

  useEffect(() => {
    let cancelled = false;

    const cached = svgCache.get(normalizedCode);
    if (cached) {
      setState({ status: 'rendered', svg: cached });
      return () => {
        cancelled = true;
      };
    }

    setState({ status: 'loading' });

    const render = async () => {
      try {
        initMermaid();
        const { svg } = await mermaid.render(createRenderId(normalizedCode), normalizedCode);
        if (cancelled) return;
        svgCache.set(normalizedCode, svg);
        setState({ status: 'rendered', svg });
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Unknown Mermaid rendering error';
        setState({ status: 'error', message });
      }
    };

    void render();

    return () => {
      cancelled = true;
    };
  }, [normalizedCode]);

  if (state.status === 'rendered') {
    return (
      <div
        className="my-3 overflow-x-auto rounded-lg border border-[color:var(--border-1)] bg-[color:var(--bg-surface)] p-2"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  if (state.status === 'error') {
    return <FallbackCodeBlock code={code} errorMessage={state.message} />;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-[color:var(--text-3)]">Rendering Mermaid diagram...</div>
      <FallbackCodeBlock code={code} />
    </div>
  );
});
