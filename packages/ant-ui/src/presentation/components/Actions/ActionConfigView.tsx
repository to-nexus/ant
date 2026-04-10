import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  INTENT_DEFINITIONS,
  type ActionId,
  type Basis,
  getConfigSlots,
  getAvailableBases,
  matchesExpectedFile,
  formatExpectedFile,
  type ConfigSlots,
  type SlotDef,
  getFileDescription,
  getDirDescription,
  getPatternDescription,
} from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { ActionStepHeader } from './ActionStepHeader';
import { ActionFooter } from './ActionFooter';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import {
  CheckCircle2,
  Circle,
  Lock,
  AlertTriangle,
  FolderOpen,
  Plus,
  Upload,
  Eye,
  Unplug,
  Info,
} from 'lucide-react';
import { Tooltip } from '@/presentation/components/common/Tooltip';

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
  const spotlightTarget = useStore(s => s.spotlightTarget);
  const setSpotlightTarget = useStore(s => s.setSpotlightTarget);
  const clearSpotlightTarget = useStore(s => s.clearSpotlightTarget);
  const openActionsPanel = useStore(s => s.openActionsPanel);
  const selectIntent = useStore(s => s.selectIntent);
  const setActionsStep = useStore(s => s.setActionsStep);
  const figmaPopulated = useStore(s => s.figmaPopulated);
  const bridgeConnected = useStore(s => s.bridgeConnected);
  const figmaDesktopReachable = useStore(s => s.figmaDesktopReachable);
  const openMainPanelTab = useStore(s => s.openMainPanelTab);
  const selectFile = useStore(s => s.selectFile);
  const setMainView = useStore(s => s.setMainView);
  const setAccountConfigScrollTarget = useStore(s => s.setAccountConfigScrollTarget);
  const gitStatus = useStore(s => s.gitStatus);
  const { toast } = useToastContext();

  useEffect(() => {
    return () => clearSpotlightTarget();
  }, [clearSpotlightTarget]);

  const warningCtx = useMemo<FileWarningContext>(() => ({
    figmaPopulated,
    bridgeConnected,
    figmaDesktopReachable,
    onOpenFigmaSettings: () => {
      openMainPanelTab('accountConfig');
      setAccountConfigScrollTarget('figma');
    },
  }), [figmaPopulated, bridgeConnected, figmaDesktopReachable, openMainPanelTab, setAccountConfigScrollTarget]);

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

    const refEntries = resolveSlotEntries(slots.refs, fileTree, undefined, warningCtx);
    const defaultRefPaths = refEntries
      .flatMap(e => e.files)
      .filter(f => f.warnings.length === 0)
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

  const handleOpenIde = useCallback(() => {
    setMainView('codeIde');
  }, [setMainView]);

  const handleViewFile = useCallback((filePath: string) => {
    setTimeout(() => {
      selectFile(filePath);
      openMainPanelTab('fileEdit');
    }, 0);
  }, [selectFile, openMainPanelTab]);

  const handleUploadDir = (dir: string) => {
    highlightArtifactDirs([dir]);
    setTimeout(() => {
      (document.getElementById(`upload-${dir}`) as HTMLInputElement)?.click();
    }, 150);
  };

  const handleToggleSpotlight = useCallback((type: 'file' | 'dir', path: string) => {
    if (spotlightTarget?.path === path) {
      clearSpotlightTarget();
    } else {
      setSpotlightTarget({ type, path });
    }
  }, [spotlightTarget, setSpotlightTarget, clearSpotlightTarget]);

  const handleCreateIntent = (targetIntentId: string) => {
    const targetIntentDef = INTENT_DEFINITIONS.find(d => d.id === targetIntentId);
    if (!targetIntentDef) return;
    const fromLabel = intentDef?.label[lang] || intentDef?.label.en || intentId;
    const toLabel = targetIntentDef.label[lang] || targetIntentDef.label.en;
    openActionsPanel(targetIntentDef.actionId);
    selectIntent(targetIntentId);
    setActionsStep('config');
    toast.info(lang === 'ko'
      ? `${fromLabel} → ${toLabel}(으)로 이동했습니다`
      : `Navigated from ${fromLabel} to ${toLabel}`);
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

  const refEntries = useMemo(() => slots ? resolveSlotEntries(slots.refs, fileTree, selectedCtx, warningCtx) : [], [slots, fileTree, selectedCtx, warningCtx]);
  const ctxEntries = useMemo(() => slots ? resolveSlotEntries(slots.context, fileTree, selectedRefs, warningCtx) : [], [slots, fileTree, selectedRefs, warningCtx]);
  const targetExisting = useMemo(() => {
    if (!slots?.target.dir) return [];
    return listDir(fileTree, slots.target.dir);
  }, [slots, fileTree]);

  const hasRefSlots = slots ? slots.refs.some(r => !r.emptyHint) : false;
  const hasCtxSlots = slots ? slots.context.length > 0 : false;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5">
        <ActionStepHeader
          actionId={actionId}
          title={intentDef.label[lang] || intentDef.label.en}
          subtitle={intentDef.description[lang] || intentDef.description.en}
          onBack={onBack}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

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
            <Section title={lang === 'ko' ? '참조' : 'References'}>
              {hasRefSlots ? (
                <SlotEntryList
                  entries={refEntries}
                  selected={selectedRefs}
                  onToggle={(p) => toggleFile(p, setSelectedRefs, 'refs')}
                  onHighlightDir={(dir) => highlightArtifactDirs([dir])}
                  onCreateIntent={handleCreateIntent}
                  onUploadDir={handleUploadDir}
                  onToggleSpotlight={handleToggleSpotlight}
                  onViewFile={handleViewFile}
                  spotlightPath={spotlightTarget?.path}
                  lang={lang}
                />
              ) : slots.refs[0]?.emptyHint ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic px-1">
                  {slots.refs[0].emptyHint[lang] || slots.refs[0].emptyHint.en}
                </p>
              ) : null}
            </Section>

            {/* Context (secondary) */}
            <Section title={lang === 'ko' ? '컨텍스트' : 'Context'}>
              {hasCtxSlots ? (
                <SlotEntryList
                  entries={ctxEntries}
                  selected={selectedCtx}
                  onToggle={(p) => toggleFile(p, setSelectedCtx, 'context')}
                  onHighlightDir={(dir) => highlightArtifactDirs([dir])}
                  onCreateIntent={handleCreateIntent}
                  onToggleSpotlight={handleToggleSpotlight}
                  onViewFile={handleViewFile}
                  spotlightPath={spotlightTarget?.path}
                  showEmptyActions={false}
                  lang={lang}
                />
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic px-1">
                  {lang === 'ko' ? '없음' : 'None'}
                </p>
              )}
            </Section>

            {/* Target */}
            <Section title={lang === 'ko' ? '타겟' : 'Target'}>
              <TargetDisplay
                target={slots.target}
                selectedRefs={selectedRefs}
                targetExisting={targetExisting}
                onToggleSpotlight={handleToggleSpotlight}
                spotlightPath={spotlightTarget?.path}
                onOpenIde={handleOpenIde}
                codebaseHasFiles={gitStatus?.codebaseHasFiles ?? false}
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

function WarningIcon({ warning, onViewFile, lang }: {
  warning: SlotWarning;
  onViewFile?: () => void;
  lang: 'en' | 'ko';
}) {
  const isFile = warning.type === 'invalid-file';
  const Icon = isFile ? AlertTriangle : Unplug;
  const iconColor = isFile ? 'text-amber-500' : 'text-red-400';
  const viewLabel = lang === 'ko' ? '보러가기' : 'View file';

  return (
    <Tooltip
      content={
        <div className="space-y-2 max-w-[220px]">
          <p className="text-xs">{warning.message[lang] || warning.message.en}</p>
          <div className="flex items-center gap-2">
            {isFile && onViewFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onViewFile(); }}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                {viewLabel}
              </button>
            )}
            {warning.onFix && warning.fixLabel && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); warning.onFix!(); }}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                {warning.fixLabel[lang] || warning.fixLabel.en}
              </button>
            )}
          </div>
        </div>
      }
      placement="top"
    >
      <span className={`inline-flex items-center justify-center shrink-0 p-1.5 rounded-lg ${iconColor} cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`}>
        <Icon className="w-4.5 h-4.5" />
      </span>
    </Tooltip>
  );
}

function InfoIcon({ description, lang }: { description: { en: string; ko: string }; lang: 'en' | 'ko' }) {
  return (
    <Tooltip
      content={<p className="text-sm leading-relaxed">{description[lang] || description.en}</p>}
      className="max-w-sm !px-5 !py-4 !text-base !rounded-xl"
      placement="top"
    >
      <span className="inline-flex items-center justify-center shrink-0 p-1.5 rounded-lg text-gray-400 dark:text-gray-500 cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
        <Info className="w-4.5 h-4.5" />
      </span>
    </Tooltip>
  );
}

function SpotlightToggle({ active, onClick, title }: { active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 p-2 rounded-lg transition-colors ${
        active
          ? 'bg-amber-200 dark:bg-amber-700/50 text-amber-700 dark:text-amber-300'
          : 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/50'
      }`}
      title={title}
    >
      <Eye className="w-4.5 h-4.5" />
    </button>
  );
}

/** Unified file card used across refs, context, and target sections */
interface FileCardProps {
  name: string;
  path: string;
  warnings?: SlotWarning[];
  description?: { en: string; ko: string } | null;
  icon?: React.ReactNode;
  selected?: boolean;
  locked?: boolean;
  disabled?: boolean;
  empty?: boolean;
  emptyStyle?: 'amber' | 'gray';
  onToggle?: () => void;
  onViewFile?: () => void;
  spotlight?: { active: boolean; onClick: () => void; title: string };
  actions?: React.ReactNode;
  lang: 'en' | 'ko';
}

function FileCard({ name, path, warnings, description, icon, selected, locked, disabled, empty, emptyStyle, onToggle, onViewFile, spotlight, actions, lang }: FileCardProps) {
  const hasWarnings = warnings && warnings.length > 0;
  const isDisabled = disabled || hasWarnings;
  const isEmpty = empty || false;
  const isAmber = emptyStyle === 'amber';

  const borderClass = isEmpty
    ? isAmber
      ? 'border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10'
      : 'border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20 opacity-50'
    : hasWarnings || isDisabled
      ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60'
      : locked
        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
        : selected
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
          : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60';

  const nameClass = isEmpty && isAmber
    ? 'text-sm truncate block text-amber-700 dark:text-amber-300 font-medium'
    : `text-sm truncate block ${hasWarnings ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`;

  return (
    <div className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all border ${borderClass}`}>
      {/* Toggle icon */}
      <button
        type="button"
        onClick={() => !isDisabled && !locked && onToggle?.()}
        disabled={!!isDisabled || !!locked || !onToggle}
        className="shrink-0"
      >
        {icon ?? (
          isEmpty
            ? <Circle className={`w-4 h-4 ${isAmber ? 'text-amber-400' : 'text-gray-400'}`} />
            : hasWarnings
              ? <Circle className="w-4 h-4 text-gray-300" />
              : locked
                ? <Lock className="w-4 h-4 text-emerald-500" />
                : selected
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <Circle className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {/* Text + inline status icons (sticks to text) */}
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="min-w-0">
          <span className={nameClass}>{name}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate block">{path}</span>
        </div>
        {description && <InfoIcon description={description} lang={lang} />}
        {warnings?.filter(w => w.type === 'invalid-file').map((w, i) => (
          <WarningIcon key={`warn-file-${i}`} warning={w} onViewFile={onViewFile} lang={lang} />
        ))}
        {warnings?.filter(w => w.type === 'invalid-env').map((w, i) => (
          <WarningIcon key={`warn-env-${i}`} warning={w} lang={lang} />
        ))}
      </div>
      {/* Action buttons (pushed to right edge) */}
      {(actions || spotlight) && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {actions}
          {spotlight && (
            <SpotlightToggle active={spotlight.active} onClick={spotlight.onClick} title={spotlight.title} />
          )}
        </div>
      )}
    </div>
  );
}

interface SlotWarning {
  type: 'invalid-file' | 'invalid-env';
  message: { en: string; ko: string };
  fixLabel?: { en: string; ko: string };
  onFix?: () => void;
}

interface SlotFileEntry {
  name: string;
  path: string;
  size?: number;
  warnings: SlotWarning[];
}

interface SlotEntry {
  def: SlotDef;
  files: SlotFileEntry[];
  hasFiles: boolean;
  hasValidFiles: boolean;
}

function SlotEntryList({ entries, selected, onToggle, onHighlightDir, onCreateIntent, onUploadDir, onToggleSpotlight, onViewFile, spotlightPath, showEmptyActions = true, lang }: {
  entries: SlotEntry[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onHighlightDir: (dir: string) => void;
  onCreateIntent: (intentId: string) => void;
  onUploadDir?: (dir: string) => void;
  onToggleSpotlight: (type: 'file' | 'dir', path: string) => void;
  onViewFile?: (path: string) => void;
  spotlightPath?: string | null;
  showEmptyActions?: boolean;
  lang: 'en' | 'ko';
}) {
  const { t } = useTranslation('actions');

  return (
    <div className="space-y-1.5">
      {entries.map(entry => {
        if (!entry.hasFiles) {
          const humanName = entry.def.humanLabel?.[lang] || entry.def.humanLabel?.en || entry.def.label[lang] || entry.def.label.en;
          const hasCreateIntent = showEmptyActions && !!entry.def.createIntent;
          const hasPath = !!entry.def.path;
          const dirDesc = hasPath ? getDirDescription(entry.def.path) : null;

          return (
            <FileCard
              key={entry.def.path || entry.def.label.en}
              name={showEmptyActions ? t('emptySlot.missing', { name: humanName }) : (entry.def.label[lang] || entry.def.label.en)}
              path={hasPath ? `${entry.def.path}/` : `— ${t('emptySlot.noFiles')}`}
              description={dirDesc?.description}
              empty
              emptyStyle={showEmptyActions ? 'amber' : 'gray'}
              spotlight={hasPath ? {
                active: spotlightPath === entry.def.path,
                onClick: () => onToggleSpotlight('dir', entry.def.path),
                title: t('emptySlot.viewInExplorer'),
              } : undefined}
              actions={showEmptyActions ? (
                <>
                  {hasCreateIntent && (
                    <button
                      type="button"
                      onClick={() => onCreateIntent(entry.def.createIntent!)}
                      className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                      title={t('emptySlot.create')}
                    >
                      <Plus className="w-4.5 h-4.5" />
                    </button>
                  )}
                  {hasPath && (
                    <button
                      type="button"
                      onClick={() => onUploadDir ? onUploadDir(entry.def.path) : onHighlightDir(entry.def.path)}
                      className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
                      title={t('emptySlot.upload')}
                    >
                      <Upload className="w-4.5 h-4.5" />
                    </button>
                  )}
                </>
              ) : undefined}
              lang={lang}
            />
          );
        }

        const fileCards = entry.files.map(f => {
          const dirPath = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : undefined;
          return (
            <FileCard
              key={f.path}
              name={f.name}
              path={f.path}
              warnings={f.warnings}
              description={getFileDescription(f.name, dirPath)}
              selected={f.warnings.length === 0 && selected.has(f.path)}
              locked={entry.def.locked}
              onToggle={() => onToggle(f.path)}
              onViewFile={onViewFile ? () => onViewFile(f.path) : undefined}
              spotlight={{
                active: spotlightPath === f.path,
                onClick: () => onToggleSpotlight('file', f.path),
                title: t('emptySlot.viewInExplorer'),
              }}
              lang={lang}
            />
          );
        });

        if (entry.def.type === 'dir' && showEmptyActions && entry.def.path) {
          const hasCreateIntent = !!entry.def.createIntent;
          fileCards.push(
            <FileCard
              key={`${entry.def.path}-add`}
              name={lang === 'ko' ? '파일 추가...' : 'Add file...'}
              path={entry.def.path + '/'}
              empty
              emptyStyle="gray"
              actions={
                <>
                  {hasCreateIntent && (
                    <button
                      type="button"
                      onClick={() => onCreateIntent(entry.def.createIntent!)}
                      className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                      title={t('emptySlot.create')}
                    >
                      <Plus className="w-4.5 h-4.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onUploadDir ? onUploadDir(entry.def.path) : onHighlightDir(entry.def.path)}
                    className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
                    title={t('emptySlot.upload')}
                  >
                    <Upload className="w-4.5 h-4.5" />
                  </button>
                </>
              }
              lang={lang}
            />
          );
        }

        return fileCards;
      })}
    </div>
  );
}

function TargetDisplay({ target, selectedRefs, targetExisting, onToggleSpotlight, spotlightPath, onOpenIde, codebaseHasFiles, lang }: {
  target: ConfigSlots['target'];
  selectedRefs: Set<string>;
  targetExisting: { name: string; path: string }[];
  onToggleSpotlight: (type: 'file' | 'dir', path: string) => void;
  spotlightPath?: string | null;
  onOpenIde?: () => void;
  codebaseHasFiles: boolean;
  lang: 'en' | 'ko';
}) {
  const { t } = useTranslation('actions');
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
        {Array.from(selectedRefs).map(p => {
          const fileName = p.split('/').pop() || p;
          const dirPath = p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : undefined;
          return (
            <FileCard
              key={p}
              name={fileName}
              path={p}
              description={getFileDescription(fileName, dirPath)}
              locked
              selected
              icon={<Lock className="w-4 h-4 text-gray-500 shrink-0" />}
              lang={lang}
            />
          );
        })}
      </div>
    );
  }

  if (target.codebase) {
    return (
      <FileCard
        name={lang === 'ko' ? '코드베이스' : 'Codebase'}
        path={lang === 'ko' ? (codebaseHasFiles ? '소스 코드 감지됨' : '소스 코드 없음 — 코드를 먼저 생성하세요') : (codebaseHasFiles ? 'Source code detected' : 'No source code — generate code first')}
        selected={codebaseHasFiles}
        locked={codebaseHasFiles}
        empty={!codebaseHasFiles}
        emptyStyle={!codebaseHasFiles ? 'amber' : undefined}
        icon={<FolderOpen className={`w-4 h-4 ${codebaseHasFiles ? 'text-emerald-500' : 'text-amber-400'} shrink-0`} />}
        description={{ en: 'Source code generated in the codebase/ directory.', ko: 'codebase/ 디렉터리에 생성된 소스 코드입니다.' }}
        actions={onOpenIde ? (
          <button
            type="button"
            onClick={onOpenIde}
            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
            title={lang === 'ko' ? 'IDE에서 보기' : 'View in IDE'}
          >
            <Eye className="w-4.5 h-4.5" />
          </button>
        ) : undefined}
        lang={lang}
      />
    );
  }

  if (target.expectedFiles && target.expectedFiles.length > 0 && target.dir) {
    return (
      <div className="space-y-1.5">
        {target.expectedFiles.map(ef => {
          const displayName = formatExpectedFile(ef);
          const fullPath = `${target.dir}/${displayName}`;
          const hasConflict = targetExisting.some(f => matchesExpectedFile(f.name, ef));
          const conflictWarning: SlotWarning | undefined = hasConflict
            ? { type: 'invalid-file', message: { en: 'May overwrite existing file', ko: '기존 파일이 덮어쓰여질 수 있습니다' } }
            : undefined;
          return (
            <FileCard
              key={ef.prefix}
              name={displayName}
              path={fullPath}
              warnings={conflictWarning ? [conflictWarning] : undefined}
              description={getPatternDescription(displayName)}
              disabled
              icon={<FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />}
              spotlight={{
                active: spotlightPath === target.dir,
                onClick: () => onToggleSpotlight('dir', target.dir!),
                title: t('emptySlot.viewInExplorer'),
              }}
              lang={lang}
            />
          );
        })}
      </div>
    );
  }

  if (target.dir) {
    return (
      <FileCard
        name={`${target.dir}/`}
        path={lang === 'ko' ? '생성 예정' : 'will be created'}
        description={getDirDescription(target.dir)?.description}
        disabled
        icon={<FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />}
        spotlight={{
          active: spotlightPath === target.dir,
          onClick: () => onToggleSpotlight('dir', target.dir!),
          title: t('emptySlot.viewInExplorer'),
        }}
        lang={lang}
      />
    );
  }

  return null;
}

// ============================================
// File resolution helpers
// ============================================

interface FileWarningContext {
  figmaPopulated: boolean | null;
  bridgeConnected: boolean | null;
  figmaDesktopReachable: boolean;
  onOpenFigmaSettings: () => void;
}

function resolveFileWarnings(
  filePath: string,
  fileSize: number | undefined,
  ctx: FileWarningContext,
): SlotWarning[] {
  const warnings: SlotWarning[] = [];
  const fileName = filePath.split('/').pop() || '';

  if (fileName === 'figma.json') {
    if (ctx.figmaPopulated === false) {
      warnings.push({
        type: 'invalid-file',
        message: { en: 'Figma URL is not configured', ko: 'Figma URL이 설정되지 않았습니다' },
      });
    }
    if (!ctx.bridgeConnected || !ctx.figmaDesktopReachable) {
      warnings.push({
        type: 'invalid-env',
        message: { en: 'Figma Desktop connection required', ko: 'Figma Desktop 연결이 필요합니다' },
        fixLabel: { en: 'Connect', ko: '연결하기' },
        onFix: ctx.onOpenFigmaSettings,
      });
    }
  } else if (fileSize === 0) {
    warnings.push({
      type: 'invalid-file',
      message: { en: 'File is empty', ko: '파일이 비어있습니다' },
    });
  }

  return warnings;
}

function resolveSlotEntries(
  defs: SlotDef[],
  fileTree: FileNode[],
  excludePaths?: Set<string>,
  warningCtx?: FileWarningContext,
): SlotEntry[] {
  return defs
    .filter(def => !def.emptyHint || def.path)
    .map(def => {
      let files: SlotFileEntry[] = [];
      if (def.type === 'file') {
        const node = findFileNode(fileTree, def.path);
        if (node) {
          const warnings = warningCtx ? resolveFileWarnings(def.path, node.size, warningCtx) : [];
          files = [{ name: def.path.split('/').pop() || def.path, path: def.path, size: node.size, warnings }];
        }
      } else if (def.path) {
        files = listDir(fileTree, def.path).map(f => {
          const warnings = warningCtx ? resolveFileWarnings(f.path, f.size, warningCtx) : [];
          return { ...f, warnings };
        });
      }
      if (excludePaths && excludePaths.size > 0) {
        files = files.filter(f => !excludePaths.has(f.path));
      }
      const hasFiles = files.length > 0;
      const hasValidFiles = files.some(f => f.warnings.length === 0);
      return { def, files, hasFiles, hasValidFiles };
    });
}

function findFileNode(tree: FileNode[], path: string): FileNode | null {
  const parts = path.split('/');
  let nodes = tree;
  for (let i = 0; i < parts.length; i++) {
    const node = nodes.find(n => n.name === parts[i]);
    if (!node) return null;
    if (i === parts.length - 1) return node.type === 'file' ? node : null;
    if (!node.children) return null;
    nodes = node.children;
  }
  return null;
}

function resolveTargetFiles(target: ConfigSlots['target'], fileTree: FileNode[]): string[] {
  if (target.codebase || !target.dir) return [];
  return listDir(fileTree, target.dir).map(f => f.path);
}

function listDir(fileTree: FileNode[], dirPath: string): { name: string; path: string; size?: number }[] {
  const parts = dirPath.split('/');
  let nodes: FileNode[] = fileTree;
  for (const part of parts) {
    const found = nodes.find(n => n.name === part);
    if (!found || found.type !== 'directory' || !found.children) return [];
    nodes = found.children;
  }
  return nodes
    .filter(n => n.type === 'file')
    .map(n => ({ name: n.name, path: `${dirPath}/${n.name}`, size: n.size }));
}
