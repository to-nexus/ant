/**
 * Prompt editor — the selected `base/*.md` file inside the Prompts card: the
 * file-ops row (path · rename · delete · save) above the SHARED prose body.
 * The viewport and the raw ⇄ preview toggle live in `proseSurface`, which the
 * intent's prompt.md card uses too — this file owns only what a multi-file
 * surface adds: which file, renaming it, deleting it, saving it.
 *
 * Saves go through the single definition write funnel (Save button / Cmd+S).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';
import { AuroraInput } from '@/presentation/components/ConfigEditor/aurora';
import { ProseBody } from './proseSurface';
import type { ViewMode } from '@/domain/file/viewMode';
import type { DefinitionValidationResult } from '@ant/shared';

export interface PromptEditorProps {
  openFile: { path: string; content: string; savedContent: string };
  readonly: boolean;
  /** Owned by the card, because the toggle renders in the card's header. */
  mode: ViewMode;
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
  mode,
  validation,
  onChange,
  onSave,
  onRename,
  onDelete,
  saveError,
}: PromptEditorProps) {
  const { t } = useTranslation('agents');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dirty = openFile.content !== openFile.savedContent;

  useEffect(() => {
    setConfirmingDelete(false);
    setRenaming(null);
  }, [openFile.path]);

  const doSave = useCallback(async () => {
    if (readonly || !dirty) return;
    await onSave();
  }, [readonly, dirty, onSave]);

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

  return (
    <div className="flex flex-col gap-2">
      {/* file ops: path · rename · delete · save (the mode toggle is in the
          card header, shared with the intent prompt card) */}
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
        {!readonly && !renaming && (
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
        {!readonly && (
          <Button size="sm" variant="ghost" onClick={() => void handleDelete()}>
            <Trash2 className="w-3 h-3" />
            {confirmingDelete ? ` ${t('prompts.confirmDelete', 'Click again to delete')}` : ''}
          </Button>
        )}
        {!readonly && (
          <Button size="sm" disabled={!dirty} onClick={() => void doSave()}>
            {t('prompts.save', 'Save')}
          </Button>
        )}
      </div>

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

      <ProseBody value={openFile.content} mode={mode} readonly={readonly} onChange={onChange} />
    </div>
  );
}
