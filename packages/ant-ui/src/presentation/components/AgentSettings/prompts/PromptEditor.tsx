/**
 * Prompt editor — the full-width bottom half of the Prompts card. Raw editing
 * (LineNumberedEditor) plus a per-file raw/preview toggle: md renders through
 * the chat markdown component factory, yaml through the read-only structured
 * JsonYamlPreview. Structured yaml *editing* deliberately stays in the form
 * cards (Tools / Intents / criteria) — single owner per field.
 *
 * Saves go through the single definition write funnel (Save button / Cmd+S,
 * YAML-syntax gate). Readonly scopes default to preview.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { parse as parseYaml } from 'yaml';
import { Code, Eye, Pencil, Trash2 } from 'lucide-react';
import { Button, ViewModeButton } from '@/presentation/components/aurora';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora';
import { JsonYamlPreview } from '@/presentation/components/JsonYamlPreview';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { LineNumberedEditor } from '../../FileEditorPanel/LineNumberedEditor';
import type { ViewMode } from '@/domain/file/viewMode';
import type { DefinitionValidationResult } from '@ant/shared';

const MARKDOWN_PREVIEW_COMPONENTS = createMarkdownComponents({ paragraphTag: 'p' });

export interface PromptEditorProps {
  openFile: { path: string; content: string; savedContent: string };
  readonly: boolean;
  structural: boolean;
  /** Draft-owned yaml paths with unsaved FORM changes — raw save would clobber them. */
  draftDirtyPaths: string[];
  validation: DefinitionValidationResult | null;
  onChange: (content: string) => void;
  onSave: () => Promise<void>;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  saveError: string | null;
}

export function PromptEditor({
  openFile,
  readonly,
  structural,
  draftDirtyPaths,
  validation,
  onChange,
  onSave,
  onRename,
  onDelete,
  saveError,
}: PromptEditorProps) {
  const { t } = useTranslation('agents');
  const [modeByPath, setModeByPath] = useState<Record<string, ViewMode>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isYaml = openFile.path.endsWith('.yaml');
  const isMarkdown = openFile.path.endsWith('.md');
  const mode: ViewMode = modeByPath[openFile.path] ?? (readonly ? 'preview' : 'raw');
  const dirty = openFile.content !== openFile.savedContent;

  useEffect(() => {
    setConfirmingDelete(false);
    setRenaming(null);
  }, [openFile.path]);

  // Client-side YAML syntax gate (save-blocking) for *.yaml buffers.
  const parseError = useMemo(() => {
    if (!isYaml) return null;
    try {
      parseYaml(openFile.content);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [isYaml, openFile.content]);

  const doSave = useCallback(async () => {
    if (readonly || parseError || !dirty) return;
    await onSave();
  }, [readonly, parseError, dirty, onSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void doSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doSave]);

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    await onDelete();
  };

  const setMode = (next: ViewMode) => setModeByPath((prev) => ({ ...prev, [openFile.path]: next }));

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* header: path · rename · mode toggle · delete · save */}
      <div className="flex items-center gap-2 flex-wrap">
        {renaming !== null ? (
          <div style={{ maxWidth: 260 }}>
            <AuroraInput
              value={renaming}
              mono
              onChange={setRenaming}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const next = renaming;
                  setRenaming(null);
                  void onRename(next);
                }
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          </div>
        ) : (
          <span className="text-xs font-mono truncate" style={{ color: 'var(--text-3)' }}>
            {openFile.path}
            {dirty ? ' •' : ''}
          </span>
        )}
        {!readonly && !renaming && isMarkdown && !structural && (
          <button
            type="button"
            className="p-0.5"
            title={t('prompts.rename', 'Rename')}
            onClick={() => setRenaming(openFile.path.split('/').pop() ?? '')}
            style={{ color: 'var(--text-4)' }}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          <ViewModeButton
            icon={Code}
            label={t('prompts.viewRaw', 'Raw')}
            active={mode === 'raw'}
            onClick={() => setMode('raw')}
          />
          <ViewModeButton
            icon={Eye}
            label={t('prompts.viewPreview', 'Preview')}
            active={mode === 'preview'}
            onClick={() => setMode('preview')}
          />
        </div>
        {!readonly && !structural && (
          <Button size="sm" variant="ghost" onClick={() => void handleDelete()}>
            <Trash2 className="w-3 h-3" />
            {confirmingDelete ? ` ${t('prompts.confirmDelete', 'Click again to delete')}` : ''}
          </Button>
        )}
        {!readonly && (
          <Button size="sm" disabled={!dirty || !!parseError} onClick={() => void doSave()}>
            {t('prompts.save', 'Save')}
          </Button>
        )}
      </div>

      {/* seam guard: raw-saving a draft-owned yaml resets pending form edits */}
      {!readonly && draftDirtyPaths.includes(openFile.path) && (
        <div className="text-xs rounded-md px-2 py-1" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-3)' }}>
          {t('prompts.rawDraftWarning', 'This file has unsaved form changes above — saving the raw buffer will reset them.')}
        </div>
      )}
      {parseError && (
        <div
          className="text-xs rounded-md px-2 py-1"
          style={{ background: 'var(--status-error-bg, var(--bg-surface-2))', color: 'var(--status-error-fg, var(--text-2))' }}
        >
          {t('prompts.yamlError', 'YAML syntax error (save blocked)')}: {parseError}
        </div>
      )}
      {saveError && (
        <div className="text-xs rounded-md px-2 py-1" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-2)' }}>
          {saveError}
        </div>
      )}
      {validation && validation.errors.length > 0 && (
        <div className="text-xs rounded-md px-2 py-1 flex flex-col gap-0.5" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-3)' }}>
          <span>{t('prompts.validationWarnings', 'Saved with warnings — affected jobs will fail to load until fixed:')}</span>
          {validation.errors.map((err, i) => (
            <span key={i} className="font-mono">{err}</span>
          ))}
        </div>
      )}

      {/* body — one stable box for both modes so toggling never jumps the page */}
      <div style={{ height: 'min(60vh, 560px)', minHeight: 280 }} className="flex flex-col">
        {mode === 'preview' && isMarkdown ? (
          <div
            className="flex-1 overflow-y-auto prose prose-sm dark:prose-invert max-w-none px-3 py-2 rounded-md"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={MARKDOWN_PREVIEW_COMPONENTS}
            >
              {openFile.content}
            </ReactMarkdown>
          </div>
        ) : mode === 'preview' && isYaml ? (
          <div
            className="flex-1 overflow-y-auto rounded-md"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
          >
            <JsonYamlPreview content={openFile.content} fileType="yaml" />
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <LineNumberedEditor value={openFile.content} onChange={onChange} disabled={readonly} />
          </div>
        )}
      </div>
    </div>
  );
}
