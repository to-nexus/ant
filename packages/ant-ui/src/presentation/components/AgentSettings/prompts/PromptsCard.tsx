/**
 * Prompts section card — the selection-scoped PROSE surface: file list on
 * top, the selected file's editor below. Scope model: agent = base/*.md +
 * on-demand/** · job = the same two under jobs/{id}/. Renders on agent/job
 * levels only — an intent's prose is its own prompt.md card, and structured
 * files (yaml, infer.md) are owned by their own cards above. On-demand docs
 * have no card of their own, so this one owns them.
 *
 * SAME ANATOMY as the intent prompt card (header description + a right-edge
 * raw ⇄ preview toggle over the shared `proseSurface` body); what a multi-file
 * scope adds is exactly the list, New file, Upload, and the per-file rename /
 * delete. The header describes HOW the files apply — "every file under base/",
 * the collective answer to the intent card's per-file one — instead of tagging
 * each row with a badge that says the same thing N times.
 *
 * Save rule: file-system ops and .md buffers save immediately here, not via
 * the shell ChangedBar (a different buffer owner than the intent card's docs).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Upload } from 'lucide-react';
import { useStore } from '@/domain/store';
import { Button } from '@/presentation/components/aurora';
import { AuroraInput, FIELD_MEASURE, SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import {
  createDefinitionFile,
  deleteDefinitionFile,
  renameDefinitionFile,
  uploadDefinitionFiles,
} from '@/infrastructure/http/api/accountAgents';
import { type PromptsScope } from './promptRows';
import { ProseModeToggle, useProseMode } from './proseSurface';
import { PromptFileList } from './PromptFileList';
import { PromptEditor } from './PromptEditor';

export type { PromptsScope };

export interface PromptsCardProps {
  id: string;
  agentId: string;
  readonly: boolean;
  scope: PromptsScope;
}

export function PromptsCard({ id, agentId, readonly, scope }: PromptsCardProps) {
  const { t } = useTranslation('agents');
  const tree = useStore((s) => s.definitionTree);
  const openFile = useStore((s) => s.openDefinitionFile);
  const validation = useStore((s) => s.definitionValidation);
  const openDefinitionFileBuffer = useStore((s) => s.openDefinitionFileBuffer);
  const setDefinitionFileContent = useStore((s) => s.setDefinitionFileContent);
  const saveOpenDefinitionFile = useStore((s) => s.saveOpenDefinitionFile);
  const loadDefinitionTree = useStore((s) => s.loadDefinitionTree);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');

  const baseDir = scope.level === 'agent' ? 'base/' : `jobs/${scope.jobId}/base/`;
  const [mode, setMode] = useProseMode(openFile?.path ?? '');
  // Markdown preview only means something for markdown. An on-demand `.json`
  // (a vendor swagger) is raw-only — rendering it through ReactMarkdown would
  // show a mangled blob. The toggle still renders, with Preview disabled: a
  // control that vanishes for some files moves position from card to card.
  const previewable = !!openFile?.path.endsWith('.md');
  const effectiveMode = previewable ? mode : 'raw';

  const dirty = !!openFile && openFile.content !== openFile.savedContent;

  const openWithGuard = (path: string) => {
    if (openFile && dirty && openFile.path !== path) {
      const ok = window.confirm(
        t('prompts.unsavedSwitchConfirm', 'Discard unsaved changes in {{file}}?', {
          file: openFile.path.split('/').pop(),
        }),
      );
      if (!ok) return;
    }
    void openDefinitionFileBuffer(agentId, path);
  };

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    setSaveError(null);
    try {
      await createDefinitionFile(agentId, `${baseDir}${fileName}`);
      setShowCreate(false);
      setCreateName('');
      await loadDefinitionTree(agentId);
      await openDefinitionFileBuffer(agentId, `${baseDir}${fileName}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUpload = (files: FileList) => {
    void uploadDefinitionFiles(
      agentId,
      Array.from(files).map((f) => ({ file: f, relativePath: `${baseDir}${f.name}` })),
    )
      .then(() => loadDefinitionTree(agentId))
      .catch((err) => setSaveError(err instanceof Error ? err.message : String(err)));
  };

  const handleSave = async () => {
    if (!openFile) return;
    setSaveError(null);
    try {
      await saveOpenDefinitionFile();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRename = async (newName: string) => {
    if (!openFile) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === openFile.path.split('/').pop()) return;
    setSaveError(null);
    try {
      await renameDefinitionFile(agentId, openFile.path, trimmed);
      const parent = openFile.path.split('/').slice(0, -1).join('/');
      useStore.getState().closeDefinitionFileBuffer();
      await loadDefinitionTree(agentId);
      await openDefinitionFileBuffer(agentId, parent ? `${parent}/${trimmed}` : trimmed);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async () => {
    if (!openFile) return;
    setSaveError(null);
    try {
      await deleteDefinitionFile(agentId, openFile.path);
      useStore.getState().closeDefinitionFileBuffer();
      await loadDefinitionTree(agentId);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const description = {
    agent: t(
      'prompts.agentDescription',
      'EVERY file under base/ is added to the system prompt on every turn — inherited by all of this agent\'s jobs.',
    ),
    job: t(
      'prompts.jobDescription',
      "EVERY file under this job's base/ is added to the system prompt on every turn, after the agent's own.",
    ),
  }[scope.level];

  return (
    <SectionCard
      id={id}
      icon="Files"
      accent="cool"
      title={t('prompts.title', 'Prompts')}
      description={description}
      headerAction={
        openFile ? (
          <ProseModeToggle
            mode={effectiveMode}
            onChange={setMode}
            previewDisabled={!previewable}
            previewDisabledTitle={t('prompts.previewMarkdownOnly', 'Preview is available for markdown files only.')}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {/* file list + toolbar — boxed, so the list reads as one control inside
            the card's padding instead of bleeding into its edges */}
        <div
          className="flex flex-col gap-2 p-1.5 rounded-md"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-1)',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          <PromptFileList
            tree={tree}
            scope={scope}
            selectedPath={openFile?.path ?? null}
            selectedDirty={dirty}
            onOpen={openWithGuard}
          />

          {!readonly && (
            <div className="flex flex-col gap-1.5">
              {showCreate && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: FIELD_MEASURE }}>
                    <AuroraInput
                      value={createName}
                      mono
                      onChange={setCreateName}
                      placeholder={t('prompts.newFileName', 'file-name.md')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCreate();
                        if (e.key === 'Escape') setShowCreate(false);
                      }}
                    />
                  </div>
                  <Button size="sm" onClick={() => void handleCreate()}>
                    {t('tree.create', 'Create')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
                    {t('tree.cancel', 'Cancel')}
                  </Button>
                </div>
              )}
              {!showCreate && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setShowCreate(true)}>
                    <Plus className="w-3 h-3" /> {t('prompts.newFile', 'New file')}
                  </Button>
                  <label className="cursor-pointer">
                    <span
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-[color:var(--bg-hover)]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      <Upload className="w-3 h-3" /> {t('prompts.upload', 'Upload')}
                    </span>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) handleUpload(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}
              {saveError && !openFile && (
                <div className="text-xs rounded-md px-2 py-1" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-2)' }}>
                  {saveError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* the selected file */}
        <div>
          {openFile ? (
            <PromptEditor
              openFile={openFile}
              readonly={readonly}
              mode={effectiveMode}
              validation={validation}
              onChange={setDefinitionFileContent}
              onSave={handleSave}
              onRename={handleRename}
              onDelete={handleDelete}
              saveError={saveError}
            />
          ) : (
            <div className="flex items-center justify-center text-sm" style={{ color: 'var(--text-4)', height: 120 }}>
              {t('prompts.selectFile', 'Select a prompt file')}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
