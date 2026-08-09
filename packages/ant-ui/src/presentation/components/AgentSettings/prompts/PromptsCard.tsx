/**
 * Prompts section card — the selection-scoped PROSE surface, stacked
 * vertically: grouped file list (with intent-binding badges) on top, the
 * full-width editor below. Replaces the old fixed-height left-tree /
 * right-editor split — the page scroller stays the single primary scroller.
 *
 * Scope model: agent = base/*.md · job = its jobs/{id}/ subtree grouped base
 * / injections · intent = only its bound injections (plus the Add-existing
 * picker over the job's unbound ones). Definition yaml never appears here —
 * each yaml is owned by its own card above.
 *
 * Save rule: catalog fields (bindings) mutate the intents document → shell
 * ChangedBar; file-system ops and .md buffers save immediately here.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderInput, Plus, Upload } from 'lucide-react';
import { useStore } from '@/domain/store';
import { Button } from '@/presentation/components/aurora';
import { AuroraInput, AuroraSelect, SectionCard } from '@/presentation/components/ConfigEditor/aurora';
import {
  createDefinitionFile,
  deleteDefinitionFile,
  renameDefinitionFile,
  uploadDefinitionFiles,
} from '@/infrastructure/http/api/accountAgents';
import { type PromptsScope } from './promptGroups';
import { PromptFileList } from './PromptFileList';
import { PromptEditor } from './PromptEditor';
import { AddExistingPicker } from './AddExistingPicker';

export type { PromptsScope };

export interface PromptsCardProps {
  id: string;
  agentId: string;
  readonly: boolean;
  scope: PromptsScope;
  /** Definition path → intent ids that inline it (reverse binding map, draft state). */
  intentBindings: Record<string, string[]>;
  /** Intent ids the given injections file can still be bound to. */
  bindableIntentIds: (path: string) => string[];
  onBind: (intentId: string, path: string) => void;
  onUnbind: (intentId: string, path: string) => void;
  /** Intent scope: a file created here is auto-bound to the selected intent. */
  onCreatedInjection?: (fileName: string) => void;
  /** Intent scope: bind an existing unbound injections file ("Add existing"). */
  onAddExisting?: (fileName: string) => void;
  /** The job's injection file names (Add-existing picker vocabulary). */
  jobInjectionFiles?: string[];
}

export function PromptsCard({
  id,
  agentId,
  readonly,
  scope,
  intentBindings,
  bindableIntentIds,
  onBind,
  onUnbind,
  onCreatedInjection,
  onAddExisting,
  jobInjectionFiles = [],
}: PromptsCardProps) {
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
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [createDir, setCreateDir] = useState('base/');
  const [createName, setCreateName] = useState('');

  const dirOptions = useMemo(() => {
    if (scope.level === 'agent') return ['base/'];
    return [`jobs/${scope.jobId}/injections/`, `jobs/${scope.jobId}/base/`];
  }, [scope]);
  const defaultDir = scope.level === 'intent' ? `jobs/${scope.jobId}/injections/` : dirOptions[0];

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
    const dir = scope.level === 'intent' ? defaultDir : createDir;
    setSaveError(null);
    try {
      await createDefinitionFile(agentId, `${dir}${fileName}`);
      setShowCreate(false);
      setCreateName('');
      await loadDefinitionTree(agentId);
      await openDefinitionFileBuffer(agentId, `${dir}${fileName}`);
      if (scope.level === 'intent' && dir.endsWith('injections/')) {
        onCreatedInjection?.(fileName);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUpload = (files: FileList) => {
    void uploadDefinitionFiles(
      agentId,
      Array.from(files).map((f) => ({ file: f, relativePath: `${defaultDir}${f.name}` })),
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

  // Add-existing candidates: the job's injection files not bound to this intent.
  const addExistingCandidates = useMemo(() => {
    if (scope.level !== 'intent') return [];
    return jobInjectionFiles.filter((f) => !scope.intentInjections.includes(f));
  }, [scope, jobInjectionFiles]);

  const boundCountOf = (fileName: string): number =>
    scope.level === 'intent'
      ? (intentBindings[`jobs/${scope.jobId}/injections/${fileName}`] ?? []).length
      : 0;

  const description = {
    agent: t('prompts.agentDescription', "The agent's always-on prompt — the base/*.md prose every job inherits."),
    job: t('prompts.jobDescription', "This job's prompt surface — base/ (always-on) and injections/ (intent-gated)."),
    intent: t('prompts.intentDescription', "The injection files this intent inlines when active. Creating a file here binds it automatically."),
  }[scope.level];

  return (
    <SectionCard
      id={id}
      icon="Files"
      accent="cool"
      title={t('prompts.title', 'Prompts')}
      description={description}
      padded={false}
    >
      <div className="flex flex-col">
        {/* file list + toolbar */}
        <div className="p-2 flex flex-col gap-2" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <PromptFileList
            tree={tree}
            scope={scope}
            intentBindings={intentBindings}
            bindableIntentIds={bindableIntentIds}
            selectedPath={openFile?.path ?? null}
            selectedDirty={dirty}
            readonly={readonly}
            onOpen={openWithGuard}
            onBind={onBind}
            onUnbind={onUnbind}
          />

          {!readonly && (
            <div className="flex flex-col gap-1.5">
              {showCreate && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {scope.level !== 'intent' && dirOptions.length > 1 && (
                    <div style={{ width: 220 }}>
                      <AuroraSelect
                        value={createDir}
                        onChange={setCreateDir}
                        options={dirOptions.map((d) => ({ value: d, label: d }))}
                      />
                    </div>
                  )}
                  <div style={{ width: 200 }}>
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
              {showAddExisting && scope.level === 'intent' && (
                <AddExistingPicker
                  candidates={addExistingCandidates}
                  boundCountOf={boundCountOf}
                  onPick={(fileName) => {
                    setShowAddExisting(false);
                    onAddExisting?.(fileName);
                  }}
                  onCancel={() => setShowAddExisting(false)}
                />
              )}
              {!showCreate && !showAddExisting && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCreateDir(defaultDir);
                      setShowCreate(true);
                    }}
                  >
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
                  {scope.level === 'intent' && (
                    <Button size="sm" variant="ghost" onClick={() => setShowAddExisting(true)}>
                      <FolderInput className="w-3 h-3" /> {t('prompts.addExisting', 'Add existing')}
                    </Button>
                  )}
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

        {/* editor */}
        <div style={{ borderTop: '1px solid var(--border-1)' }}>
          {openFile ? (
            <PromptEditor
              openFile={openFile}
              readonly={readonly}
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
