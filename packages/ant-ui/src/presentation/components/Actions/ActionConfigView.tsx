import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  INTENT_DEFINITIONS,
  type ActionId,
  type Basis,
  getConfigSlots,
  getAvailableBases,
  matchesExpectedFile,
  type ConfigSlots,
  type SlotDef,
} from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { ActionStepHeader } from './ActionStepHeader';
import { ActionFooter } from './ActionFooter';
import {
  CheckCircle2,
  Circle,
  Lock,
  AlertTriangle,
  FolderOpen,
} from 'lucide-react';

interface ActionConfigViewProps {
  actionId: ActionId;
  intentId: string;
  onBack: () => void;
}

const BASIS_LABELS: Record<Basis, { en: string; ko: string }> = {
  prd: { en: 'PRD', ko: 'PRD' },
  directive: { en: 'Directive', ko: '지시사항' },
  'existing-doc': { en: 'Existing Design', ko: '기존 설계' },
  figma: { en: 'Figma', ko: 'Figma' },
  references: { en: 'Reference Images', ko: '레퍼런스 이미지' },
  spec: { en: 'Spec Documents', ko: '스펙 문서' },
  'design-doc': { en: 'Design Documents', ko: '설계 문서' },
};

export function ActionConfigView({ actionId, intentId, onBack }: ActionConfigViewProps) {
  const { i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const actionMetadata = useStore(s => s.actionMetadata);
  const fileTree = useStore(s => s.fileTree);
  const highlightArtifactDirs = useStore(s => s.highlightArtifactDirs);

  const intentDef = INTENT_DEFINITIONS.find(d => d.id === intentId);
  if (!intentDef) return null;

  const availableBases = getAvailableBases(intentId);
  const selectedBasis = actionMetadata.basis;
  const slots = selectedBasis ? getConfigSlots(intentId, selectedBasis) : null;

  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [selectedCtx, setSelectedCtx] = useState<Set<string>>(new Set());
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (availableBases.length > 0 && !selectedBasis) {
      updateActionMetadata({ basis: availableBases[0] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId, actionId]);

  useEffect(() => {
    if (!slots) {
      setSelectedRefs(new Set());
      setSelectedCtx(new Set());
      setSelectedTargets(new Set());
      return;
    }

    const refEntries = resolveSlotEntries(slots.refs, fileTree);
    const defaultRefPaths = refEntries
      .flatMap(e => e.files)
      .filter((_, __, arr) => arr.length > 0)
      .map(f => f.path);
    setSelectedRefs(new Set(defaultRefPaths));
    updateActionMetadata({ refs: defaultRefPaths.length > 0 ? defaultRefPaths : undefined });

    setSelectedCtx(new Set());
    updateActionMetadata({ context: undefined });

    const targetPaths = slots.target.mirrorRefs
      ? defaultRefPaths
      : resolveTargetFiles(slots.target, fileTree);
    setSelectedTargets(new Set(targetPaths));
    updateActionMetadata({ target: targetPaths.length > 0 ? targetPaths : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId, selectedBasis]);

  const handleBasisSelect = (basis: Basis) => {
    if (basis === selectedBasis) return;
    updateActionMetadata({ basis, refs: undefined, context: undefined, target: undefined });
  };

  const toggleFile = (
    path: string,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    field: 'refs' | 'context' | 'target',
  ) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      const arr = Array.from(next);
      const patch: Record<string, unknown> = { [field]: arr.length > 0 ? arr : undefined };
      if (field === 'refs' && slots?.target.mirrorRefs) {
        setSelectedTargets(new Set(next));
        patch.target = arr.length > 0 ? arr : undefined;
      }
      updateActionMetadata(patch as any);
      return next;
    });
  };

  const refEntries = useMemo(() => slots ? resolveSlotEntries(slots.refs, fileTree, selectedCtx) : [], [slots, fileTree, selectedCtx]);
  const ctxEntries = useMemo(() => slots ? resolveSlotEntries(slots.context, fileTree, selectedRefs) : [], [slots, fileTree, selectedRefs]);
  const targetExisting = useMemo(() => {
    if (!slots?.target.dir) return [];
    return listDir(fileTree, slots.target.dir);
  }, [slots, fileTree]);

  const hasRefSlots = slots ? slots.refs.some(r => !r.emptyHint) : false;
  const hasCtxSlots = slots ? slots.context.length > 0 : false;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <ActionStepHeader
          actionId={actionId}
          title={intentDef.label[lang] || intentDef.label.en}
          subtitle={intentDef.description[lang] || intentDef.description.en}
          onBack={onBack}
        />

        {/* Basis */}
        {availableBases.length > 0 && (
          <Section title={lang === 'ko' ? '기반 소스' : 'Basis'}>
            <div className="flex flex-wrap gap-2">
              {availableBases.map(basis => {
                const label = BASIS_LABELS[basis];
                const isSelected = selectedBasis === basis;
                return (
                  <button
                    key={basis}
                    type="button"
                    onClick={() => handleBasisSelect(basis)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {label?.[lang] || label?.en || basis}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {slots && (
          <>
            {/* Refs (primary) */}
            <Section title={lang === 'ko' ? '참조 (Refs)' : 'References'}>
              {hasRefSlots ? (
                <SlotEntryList
                  entries={refEntries}
                  selected={selectedRefs}
                  onToggle={(p) => toggleFile(p, setSelectedRefs, 'refs')}
                  onHighlightDir={(dir) => highlightArtifactDirs([dir])}
                  lang={lang}
                />
              ) : slots.refs[0]?.emptyHint ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic px-1">
                  {slots.refs[0].emptyHint[lang] || slots.refs[0].emptyHint.en}
                </p>
              ) : null}
            </Section>

            {/* Context (secondary) — always show if slots define context */}
            {hasCtxSlots && (
              <Section title={lang === 'ko' ? '컨텍스트' : 'Context'}>
                <SlotEntryList
                  entries={ctxEntries}
                  selected={selectedCtx}
                  onToggle={(p) => toggleFile(p, setSelectedCtx, 'context')}
                  onHighlightDir={(dir) => highlightArtifactDirs([dir])}
                  lang={lang}
                />
              </Section>
            )}

            {/* Target */}
            <Section title={lang === 'ko' ? '타겟' : 'Target'}>
              <TargetDisplay
                target={slots.target}
                selectedRefs={selectedRefs}
                targetExisting={targetExisting}
                selectedTargets={selectedTargets}
                onToggleTarget={(p) => toggleFile(p, setSelectedTargets, 'target')}
                onHighlightDir={(dir) => highlightArtifactDirs([dir])}
                lang={lang}
              />
            </Section>
          </>
        )}
      </div>

      <ActionFooter actionId={actionId} />
    </div>
  );
}

// ============================================
// Sub-components
// ============================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
      {children}
    </div>
  );
}

interface SlotEntry {
  def: SlotDef;
  files: { name: string; path: string }[];
  hasFiles: boolean;
}

function SlotEntryList({ entries, selected, onToggle, onHighlightDir, lang }: {
  entries: SlotEntry[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onHighlightDir: (dir: string) => void;
  lang: 'en' | 'ko';
}) {
  return (
    <div className="space-y-1.5">
      {entries.map(entry => {
        if (!entry.hasFiles) {
          return (
            <button
              key={entry.def.path || entry.def.label.en}
              type="button"
              onClick={() => entry.def.path && onHighlightDir(entry.def.path)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20 opacity-50 hover:opacity-70 transition-opacity"
            >
              <Circle className="w-4 h-4 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-500 dark:text-gray-400 truncate block">
                  {entry.def.label[lang] || entry.def.label.en}
                </span>
                <span className="text-xs text-gray-400 truncate block">
                  {entry.def.path} — {lang === 'ko' ? '파일 없음' : 'no files'}
                </span>
              </div>
            </button>
          );
        }

        return entry.files.map(f => {
          const isOn = selected.has(f.path);
          const isLocked = entry.def.locked;
          return (
            <button
              key={f.path}
              type="button"
              onClick={() => !isLocked && onToggle(f.path)}
              disabled={isLocked}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all border ${
                isLocked
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 cursor-default'
                  : isOn
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                    : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60'
              }`}
            >
              {isLocked
                ? <Lock className="w-4 h-4 text-emerald-500 shrink-0" />
                : isOn
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  : <Circle className="w-4 h-4 text-gray-400 shrink-0" />}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-800 dark:text-gray-200 truncate block">{f.name}</span>
                <span className="text-xs text-gray-400 truncate block">{f.path}</span>
              </div>
            </button>
          );
        });
      })}
    </div>
  );
}

const TARGET_CARD = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left border bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';

function TargetDisplay({ target, selectedRefs, targetExisting, selectedTargets, onToggleTarget, onHighlightDir, lang }: {
  target: ConfigSlots['target'];
  selectedRefs: Set<string>;
  targetExisting: { name: string; path: string }[];
  selectedTargets: Set<string>;
  onToggleTarget: (path: string) => void;
  onHighlightDir: (dir: string) => void;
  lang: 'en' | 'ko';
}) {
  if (target.mirrorRefs) {
    if (selectedRefs.size === 0) {
      return (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic px-1">
          {lang === 'ko' ? '참조(Refs)에서 파일을 선택하면 타겟이 결정됩니다' : 'Select files in Refs to determine targets'}
        </p>
      );
    }
    return (
      <div className="space-y-1.5">
        {Array.from(selectedRefs).map(path => (
          <div key={path} className={TARGET_CARD}>
            <Lock className="w-4 h-4 text-gray-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm text-gray-800 dark:text-gray-200 truncate block">{path.split('/').pop()}</span>
              <span className="text-xs text-gray-400 truncate block">{path}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (target.codebase) {
    return (
      <div className={TARGET_CARD}>
        <FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {lang === 'ko' ? '코드베이스 (에이전트가 결정)' : 'Codebase (agent determines)'}
        </span>
      </div>
    );
  }

  if (target.expectedFiles && target.expectedFiles.length > 0) {
    return (
      <div className="space-y-1.5">
        {target.expectedFiles.map(ef => {
          const hasConflict = targetExisting.some(f => matchesExpectedFile(f.name, ef));
          return (
            <button
              key={ef.prefix}
              type="button"
              onClick={() => target.dir && onHighlightDir(target.dir)}
              className={`${TARGET_CARD} transition-colors hover:bg-gray-100 dark:hover:bg-gray-800`}
            >
              {hasConflict && <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-800 dark:text-gray-200 truncate block">
                  {ef.prefix}*{ef.ext}
                </span>
                <span className="text-xs text-gray-400 truncate block">
                  {target.dir}/{ef.prefix}*{ef.ext}
                  {hasConflict
                    ? ` — ${lang === 'ko' ? '기존 파일이 덮어쓰여질 수 있습니다' : 'may overwrite existing'}`
                    : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  if (target.dir) {
    return (
      <button
        type="button"
        onClick={() => onHighlightDir(target.dir!)}
        className={`${TARGET_CARD} transition-colors hover:bg-gray-100 dark:hover:bg-gray-800`}
      >
        <FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {target.dir}/ <span className="ml-1">{lang === 'ko' ? '(생성 예정)' : '(will be created)'}</span>
        </span>
      </button>
    );
  }

  return null;
}

// ============================================
// File resolution helpers
// ============================================

function resolveSlotEntries(defs: SlotDef[], fileTree: FileNode[], excludePaths?: Set<string>): SlotEntry[] {
  return defs
    .filter(def => !def.emptyHint || def.path)
    .map(def => {
      let files: { name: string; path: string }[] = [];
      if (def.type === 'file') {
        if (fileExistsInTree(fileTree, def.path)) {
          files = [{ name: def.path.split('/').pop() || def.path, path: def.path }];
        }
      } else if (def.path) {
        files = listDir(fileTree, def.path);
      }
      if (excludePaths && excludePaths.size > 0) {
        files = files.filter(f => !excludePaths.has(f.path));
      }
      return { def, files, hasFiles: files.length > 0 };
    });
}

function fileExistsInTree(tree: FileNode[], path: string): boolean {
  const parts = path.split('/');
  let nodes = tree;
  for (let i = 0; i < parts.length; i++) {
    const node = nodes.find(n => n.name === parts[i]);
    if (!node) return false;
    if (i === parts.length - 1) return node.type === 'file';
    if (!node.children) return false;
    nodes = node.children;
  }
  return false;
}

function resolveTargetFiles(target: ConfigSlots['target'], fileTree: FileNode[]): string[] {
  if (target.codebase || !target.dir) return [];
  return listDir(fileTree, target.dir).map(f => f.path);
}

function listDir(fileTree: FileNode[], dirPath: string): { name: string; path: string }[] {
  const parts = dirPath.split('/');
  let nodes: FileNode[] = fileTree;
  for (const part of parts) {
    const found = nodes.find(n => n.name === part);
    if (!found || found.type !== 'directory' || !found.children) return [];
    nodes = found.children;
  }
  return nodes
    .filter(n => n.type === 'file')
    .map(n => ({ name: n.name, path: `${dirPath}/${n.name}` }));
}
