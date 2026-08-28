/**
 * Shared prose surface — the ONE markdown editing anatomy behind all three
 * prompt sections: the agent's `base/*.md`, a job's `base/*.md`, and an
 * intent's `prompt.md`. They differ in what OWNS the buffer (the first two are
 * a file list over the openDefinitionFile buffer with immediate saves; the
 * intent's rides `useDefinitionDocs` and the shell's ChangedBar) — but the
 * viewport, the preview ⇄ raw toggle and its per-file memory must not differ,
 * or the same file type reads as three different editors.
 *
 * Placement contract: the toggle goes in the SectionCard's `headerAction`
 * (header, right edge) on every prompt card; the body is one fixed-height box
 * so switching modes never jumps the page.
 */

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ViewModeToggle } from '@/presentation/components/aurora';
import { PROSE_WRAP } from '@/presentation/components/ConfigEditor/aurora';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { LineNumberedEditor } from '../../FileEditorPanel/LineNumberedEditor';
import { DEFAULT_VIEW_MODE, type ViewMode } from '@/domain/file/viewMode';

const MARKDOWN_PREVIEW_COMPONENTS = createMarkdownComponents({ paragraphTag: 'p' });

/**
 * One box HEIGHT for every prose surface, so cards line up across levels.
 * Not a width — unrelated to `PROSE_MEASURE`, which the name resembles.
 */
const PROSE_BOX = { height: 'min(60vh, 560px)', minHeight: 280 } as const;

/**
 * Per-file view mode. Keyed so switching files (or intents) restores what that
 * file was last read as. The unvisited default is the domain SSOT's
 * `DEFAULT_VIEW_MODE` ('preview') for EVERY scope — opening editable prose in
 * raw showed the author's own hard wraps, which read as the surface breaking
 * lines far short of its container.
 */
export function useProseMode(key: string): [ViewMode, (next: ViewMode) => void] {
  const [byKey, setByKey] = useState<Record<string, ViewMode>>({});
  const mode = byKey[key] ?? DEFAULT_VIEW_MODE;
  return [mode, (next) => setByKey((prev) => ({ ...prev, [key]: next }))];
}

export function ProseModeToggle({
  mode,
  onChange,
  previewDisabled = false,
  previewDisabledTitle,
}: {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
  /** The file cannot be markdown-previewed (e.g. an on-demand `.json`). */
  previewDisabled?: boolean;
  previewDisabledTitle?: string;
}) {
  return (
    <ViewModeToggle
      left="preview"
      value={mode === 'raw' ? 'raw' : 'left'}
      leftDisabled={previewDisabled}
      leftDisabledTitle={previewDisabledTitle}
      onChange={(next) => onChange(next === 'raw' ? 'raw' : 'preview')}
    />
  );
}

export function ProseBody({
  value,
  mode,
  readonly,
  onChange,
}: {
  value: string;
  mode: ViewMode;
  readonly: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div style={PROSE_BOX} className="flex flex-col min-h-0">
      {mode === 'preview' ? (
        <div
          className="flex-1 overflow-y-auto prose prose-sm dark:prose-invert max-w-none px-3 py-2 rounded-md"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', ...PROSE_WRAP }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_PREVIEW_COMPONENTS}>
            {value}
          </ReactMarkdown>
        </div>
      ) : (
        <LineNumberedEditor value={value} onChange={onChange} disabled={readonly} />
      )}
    </div>
  );
}
