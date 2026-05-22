
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface LineNumberedEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Aurora-skinned line-numbered code editor.
 *
 * Same DOM + ResizeObserver-based per-line height measurement as the
 * pre-Aurora flat-file implementation, re-skinned with design tokens.
 * Focus surfaces an Aurora violet ring (`var(--violet-500)`) instead of
 * the legacy blue ring; gutter uses `var(--bg-surface)` + `var(--text-4)`.
 */
export function LineNumberedEditor({ value, onChange, disabled }: LineNumberedEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);
  const [focused, setFocused] = useState(false);

  const lines = useMemo(() => value.split('\n'), [value]);
  const lineCount = lines.length;

  useEffect(() => {
    const measureLineHeights = () => {
      if (!measureRef.current || !editorRef.current) return;

      const measureDiv = measureRef.current;
      const style = getComputedStyle(editorRef.current);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const editorContentWidth = editorRef.current.clientWidth - paddingLeft - paddingRight;

      measureDiv.style.width = `${editorContentWidth}px`;

      const heights: number[] = [];
      lines.forEach((line, i) => {
        const span = document.createElement('span');
        span.style.whiteSpace = 'pre-wrap';
        span.style.overflowWrap = 'break-word';
        span.textContent = line || ' ';
        measureDiv.innerHTML = '';
        measureDiv.appendChild(span);
        heights[i] = span.offsetHeight;
      });

      setLineHeights(heights);
    };

    measureLineHeights();

    const resizeObserver = new ResizeObserver(measureLineHeights);
    if (editorRef.current) {
      resizeObserver.observe(editorRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [lines]);

  const handleScroll = useCallback(() => {
    if (editorRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const lineNumberWidth = Math.max(String(lineCount).length * 8 + 16, 32);
  const lineHeight = 22;

  return (
    <div
      ref={containerRef}
      className="flex flex-1 overflow-hidden"
      style={{
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-lg)',
        boxShadow: focused ? '0 0 0 2px var(--violet-500)' : 'none',
        transition: 'box-shadow var(--dur-fast) var(--ease-smooth)',
      }}
    >
      <div
        ref={measureRef}
        className="absolute invisible text-sm leading-[1.625] p-0"
        style={{
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          fontFamily: 'var(--font-mono)',
        }}
        aria-hidden="true"
      />

      <div
        ref={lineNumbersRef}
        className="flex-shrink-0 overflow-hidden select-none"
        style={{
          width: lineNumberWidth,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border-1)',
        }}
      >
        <div className="py-3 text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
          {lines.map((_, i) => (
            <div
              key={i}
              className="px-2 text-right"
              style={{
                height: lineHeights[i] || lineHeight,
                color: 'var(--text-4)',
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      <textarea
        ref={editorRef}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        className="flex-1 p-3 text-sm resize-none overflow-auto leading-[1.625] break-words focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          minHeight: '100%',
          background: 'transparent',
          color: 'var(--text-1)',
          border: 'none',
          fontFamily: 'var(--font-mono)',
        }}
        spellCheck={false}
        wrap="soft"
      />
    </div>
  );
}
