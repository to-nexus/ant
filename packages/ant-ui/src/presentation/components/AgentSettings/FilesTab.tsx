import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parse as parseYaml } from 'yaml';
import { FileText, Folder, Plus, Trash2, Upload } from 'lucide-react';
import { useStore } from '@/domain/store';
import { Button } from '@/presentation/components/aurora';
import { LineNumberedEditor } from '../FileEditorPanel/LineNumberedEditor';
import {
  createDefinitionFile,
  deleteDefinitionFile,
  uploadDefinitionFiles,
} from '@/infrastructure/http/api/accountAgents';
import type { CustomAgentDefinitionFileNode } from '@ant/shared';

/**
 * Files tab — definition file tree + raw editor. Saves through the single
 * write funnel (agentSettingsSlice.saveOpenDefinitionFile): a client-side
 * YAML parse error blocks save; post-save semantic warnings render below.
 */
export function FilesTab({ agentId, readonly }: { agentId: string; readonly: boolean }) {
  const { t } = useTranslation('agents');
  const tree = useStore((s) => s.definitionTree);
  const openFile = useStore((s) => s.openDefinitionFile);
  const validation = useStore((s) => s.definitionValidation);
  const openDefinitionFileBuffer = useStore((s) => s.openDefinitionFileBuffer);
  const setDefinitionFileContent = useStore((s) => s.setDefinitionFileContent);
  const saveOpenDefinitionFile = useStore((s) => s.saveOpenDefinitionFile);
  const loadDefinitionTree = useStore((s) => s.loadDefinitionTree);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [creatingPath, setCreatingPath] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const dirty = !!openFile && openFile.content !== openFile.savedContent;

  // Client-side YAML syntax gate (save-blocking) for *.yaml buffers.
  const parseError = useMemo(() => {
    if (!openFile || !openFile.path.endsWith('.yaml')) return null;
    try {
      parseYaml(openFile.content);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [openFile]);

  const doSave = useCallback(async () => {
    if (!openFile || readonly || parseError) return;
    setSaveError(null);
    try {
      await saveOpenDefinitionFile();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [openFile, readonly, parseError, saveOpenDefinitionFile]);

  // Cmd/Ctrl+S
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

  const renderNode = (node: CustomAgentDefinitionFileNode, level: number): React.ReactElement => (
    <div key={node.path}>
      <button
        type="button"
        className="w-full text-left flex items-center gap-1.5 py-0.5 px-1 rounded text-xs hover:bg-[color:var(--bg-hover)]"
        style={{
          paddingLeft: 4 + level * 12,
          color: openFile?.path === node.path ? 'var(--violet-500)' : 'var(--text-2)',
        }}
        onClick={() => node.type === 'file' && void openDefinitionFileBuffer(agentId, node.path)}
      >
        {node.type === 'directory' ? <Folder className="w-3 h-3 shrink-0" /> : <FileText className="w-3 h-3 shrink-0" />}
        <span className="truncate">{node.name}</span>
      </button>
      {node.children?.map((c) => renderNode(c, level + 1))}
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {/* file tree */}
      <div
        className="w-56 shrink-0 overflow-y-auto p-2 flex flex-col gap-1"
        style={{ borderRight: '1px solid var(--border-1)' }}
      >
        {tree.map((n) => renderNode(n, 0))}
        {!readonly && (
          <div className="mt-2 flex flex-col gap-1">
            {showCreate ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const path = creatingPath.trim();
                  if (!path) return;
                  void createDefinitionFile(agentId, path)
                    .then(() => { setShowCreate(false); setCreatingPath(''); return loadDefinitionTree(agentId); })
                    .catch((err) => setSaveError(err instanceof Error ? err.message : String(err)));
                }}
              >
                <input
                  autoFocus
                  value={creatingPath}
                  onChange={(e) => setCreatingPath(e.target.value)}
                  placeholder="injections/example.md"
                  className="w-full text-xs px-1 py-0.5 rounded"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--text-2)' }}
                  onKeyDown={(e) => e.key === 'Escape' && setShowCreate(false)}
                />
              </form>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(true)}>
                <Plus className="w-3 h-3" /> {t('files.newFile', 'New file')}
              </Button>
            )}
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
                <Upload className="w-3 h-3" /> {t('files.upload', 'Upload')}
              </span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  void uploadDefinitionFiles(
                    agentId,
                    Array.from(files).map((f) => ({
                      file: f,
                      relativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
                    })),
                  )
                    .then(() => loadDefinitionTree(agentId))
                    .catch((err) => setSaveError(err instanceof Error ? err.message : String(err)));
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        )}
      </div>

      {/* editor */}
      <div className="flex-1 min-w-0 flex flex-col p-2 gap-2">
        {openFile ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono truncate" style={{ color: 'var(--text-3)' }}>
                {openFile.path}
                {dirty ? ' •' : ''}
              </span>
              <div className="flex-1" />
              {!readonly && openFile.path !== 'agent.yaml' && !/^jobs\/[^/]+\/job\.yaml$/.test(openFile.path) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void deleteDefinitionFile(agentId, openFile.path)
                      .then(() => { useStore.getState().closeDefinitionFileBuffer(); return loadDefinitionTree(agentId); })
                      .catch((err) => setSaveError(err instanceof Error ? err.message : String(err)))
                  }
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
              {!readonly && (
                <Button size="sm" disabled={!dirty || !!parseError} onClick={() => void doSave()}>
                  {t('files.save', 'Save')}
                </Button>
              )}
            </div>
            {parseError && (
              <div
                className="text-xs rounded-md px-2 py-1"
                style={{ background: 'var(--status-error-bg, var(--bg-surface-2))', color: 'var(--status-error-fg, var(--text-2))' }}
              >
                {t('files.yamlError', 'YAML syntax error (save blocked)')}: {parseError}
              </div>
            )}
            {saveError && (
              <div className="text-xs rounded-md px-2 py-1" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-2)' }}>
                {saveError}
              </div>
            )}
            {validation && validation.errors.length > 0 && (
              <div className="text-xs rounded-md px-2 py-1 flex flex-col gap-0.5" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-3)' }}>
                <span>{t('files.validationWarnings', 'Saved with warnings — affected jobs will fail to load until fixed:')}</span>
                {validation.errors.map((err, i) => (
                  <span key={i} className="font-mono">{err}</span>
                ))}
              </div>
            )}
            <div className="flex-1 min-h-0">
              <LineNumberedEditor
                value={openFile.content}
                onChange={setDefinitionFileContent}
                disabled={readonly}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-4)' }}>
            {t('files.selectFile', 'Select a definition file')}
          </div>
        )}
      </div>
    </div>
  );
}
