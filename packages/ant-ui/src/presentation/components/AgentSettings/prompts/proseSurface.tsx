/**
 * Shared prose surface — the ONE markdown editing anatomy behind all three
 * prompt sections: the agent's `base/*.md`, a job's `base/*.md`, and an
 * intent's `prompt.md`. They differ in what OWNS the buffer (the first two are
 * a file list over the openDefinitionFile buffer with immediate saves; the
 * intent's rides `useDefinitionDocs` and the shell's ChangedBar) — but the
 * viewport, the raw ⇄ preview toggle and its per-file memory must not differ,
 * or the same file type reads as three different editors.
 *
 * Placement contract: the toggle goes in the SectionCard's `headerAction`
 * (header, right edge) on every prompt card; the body is one fixed-height box
 * so switching modes never jumps the page.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code, Eye } from 'lucide-react';
import { ViewModeButton } from '@/presentation/components/aurora';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { LineNumberedEditor } from '../../FileEditorPanel/LineNumberedEditor';
import type { ViewMode } from '@/domain/file/viewMode';

const MARKDOWN_PREVIEW_COMPONENTS = createMarkdownComponents({ paragraphTag: 'p' });

/** One box height for every prose surface, so cards line up across levels. */
const PROSE_BOX = { height: 'min(60vh, 560px)', minHeight: 280 } as const;

/**
 * Per-file view mode. Keyed so switching files (or intents) restores what that
 * file was last read as; readonly scopes open in preview — there is nothing to
 * edit, and the rendered form is the readable one.
 */
export function useProseMode(key: string, readonly: boolean): [ViewMode, (next: ViewMode) => void] {
  const [byKey, setByKey] = useState<Record<string, ViewMode>>({});
  const mode = byKey[key] ?? (readonly ? 'preview' : 'raw');
  return [mode, (next) => setByKey((prev) => ({ ...prev, [key]: next }))];
}

export function ProseModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  const { t } = useTranslation('agents');
  return (
    <div className="flex items-center gap-0.5">
      <ViewModeButton
        icon={Code}
        label={t('prompts.viewRaw', 'Raw')}
        active={mode === 'raw'}
        onClick={() => onChange('raw')}
      />
      <ViewModeButton
        icon={Eye}
        label={t('prompts.viewPreview', 'Preview')}
        active={mode === 'preview'}
        onClick={() => onChange('preview')}
      />
    </div>
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
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
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
