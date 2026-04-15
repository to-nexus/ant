import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  INTENT_DEFINITIONS,
  getIntentsForAction,
  type IntentGroup,
  type IntentId,
  getConfigSlots,
  formatOutputSpec,
} from '@ant/shared';
import { IntentTabNav } from './IntentTabNav';
import { PageTransition } from './PageTransition';
import { ActionFooter } from './ActionFooter';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { FileText, BookOpen, Crosshair } from 'lucide-react';
import {
  Section,
  SlotEntryList,
  TargetDisplay,
  BasisSelector,
  resolveSlotEntries,
  listDir,
} from './config';
import type { FileWarningContext } from './config';

interface ActionConfigViewProps {
  actionId: IntentGroup;
  intentId: IntentId;
  onBack: () => void;
}

export function ActionConfigView({ actionId, intentId, onBack }: ActionConfigViewProps) {
  const { t, i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
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

  const intents = getIntentsForAction(actionId);
  const directionRef = useRef<1 | -1>(1);

  const handleIntentChange = useCallback((newIntentId: string) => {
    const oldIdx = intents.findIndex(i => i.id === intentId);
    const newIdx = intents.findIndex(i => i.id === newIntentId);
    directionRef.current = newIdx > oldIdx ? 1 : -1;
    selectIntent(newIntentId);
  }, [intents, intentId, selectIntent]);

  const intentDef = INTENT_DEFINITIONS.find(d => d.id === intentId);
  if (!intentDef) return null;

  const slots = getConfigSlots(intentId);

  const actionMetadata = useStore(s => s.actionMetadata);
  const selectedRefs = useMemo(() => new Set(actionMetadata.refs ?? []), [actionMetadata.refs]);
  const selectedCtx = useMemo(() => new Set(actionMetadata.context ?? []), [actionMetadata.context]);

  useEffect(() => {
    if (!slots) {
      updateActionMetadata({ refs: undefined, context: undefined, target: undefined });
      return;
    }

    const refEntries = resolveSlotEntries(slots.refs, fileTree, undefined, warningCtx);
    let defaultRefPaths = refEntries
      .filter(e => e.def.required)
      .flatMap(e => e.files)
      .filter(f => f.warnings.length === 0)
      .map(f => f.path);
    if (slots.refsSingleSelect && defaultRefPaths.length > 1) {
      defaultRefPaths = defaultRefPaths.slice(0, 1);
    }
    updateActionMetadata({ refs: defaultRefPaths.length > 0 ? defaultRefPaths : undefined });
    updateActionMetadata({ context: undefined });
    updateActionMetadata({ basis: undefined });

    const { target } = slots;
    if (target.kind === 'revise') {
      updateActionMetadata({ target: defaultRefPaths.length > 0 ? defaultRefPaths : undefined });
    } else if (target.kind === 'generate' && target.outputs.length > 0) {
      const expectedPaths = target.outputs.map(os => `${target.dir}/${formatOutputSpec(os)}`);
      updateActionMetadata({ target: expectedPaths });
    } else if (target.kind === 'generate') {
      updateActionMetadata({ target: [target.dir] });
    } else {
      updateActionMetadata({ target: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId]);

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
    openActionsPanel(targetIntentDef.intentGroup);
    selectIntent(targetIntentId);
    setActionsStep('config');
    toast.info(t('toast.navigated', { from: fromLabel, to: toLabel }));
  };

  const toggleFile = (path: string, field: 'refs' | 'context') => {
    const current = field === 'refs' ? (actionMetadata.refs ?? []) : (actionMetadata.context ?? []);
    let next: string[];
    if (current.includes(path)) {
      next = current.filter(p => p !== path);
    } else {
      if (field === 'refs' && slots) {
        if (slots.refsSingleSelect) {
          next = [path];
        } else {
          next = [...current, path];
        }
      } else {
        next = [...current, path];
      }
    }
    updateActionMetadata({ [field]: next.length > 0 ? next : undefined });

    if (field === 'refs' && slots?.target.kind === 'revise') {
      updateActionMetadata({ target: next.length > 0 ? next : undefined });
    }
  };

  const codebaseHasFiles = gitStatus?.codebaseHasFiles ?? false;
  const refEntries = useMemo(() => slots ? resolveSlotEntries(slots.refs, fileTree, selectedCtx, warningCtx, codebaseHasFiles) : [], [slots, fileTree, selectedCtx, warningCtx, codebaseHasFiles]);
  const ctxEntries = useMemo(() => slots ? resolveSlotEntries(slots.context, fileTree, selectedRefs, warningCtx) : [], [slots, fileTree, selectedRefs, warningCtx]);
  const targetExisting = useMemo(() => {
    if (!slots || slots.target.kind !== 'generate') return [];
    return listDir(fileTree, slots.target.dir);
  }, [slots, fileTree]);

  const hasRefSlots = slots ? slots.refs.some(r => !r.emptyHint) : false;
  const hasCtxSlots = slots ? slots.context.length > 0 : false;

  const refsHint = hasRefSlots
    ? slots!.refsSingleSelect
      ? { label: t('section.singleSelect'), tooltip: t('section.singleSelectHint'), colorScheme: 'amber' as const }
      : { label: t('section.multiSelect'), tooltip: t('section.multiSelectHint'), colorScheme: 'gray' as const }
    : undefined;

  const targetHint = slots?.target.kind === 'revise'
    ? { label: t('section.mirrorsRefs'), tooltip: t('section.mirrorsRefsHint'), colorScheme: 'blue' as const }
    : undefined;

  return (
    <div className="flex flex-col h-full overflow-x-hidden">
      <div className="shrink-0 px-5 pt-5">
        <IntentTabNav
          actionId={actionId}
          intents={intents}
          selectedIntentId={intentId}
          onSelect={handleIntentChange}
          onBack={onBack}
          lang={lang}
        />
      </div>

      <PageTransition pageKey={intentId} direction={directionRef.current} className="flex-1 overflow-y-auto p-5 space-y-5">

        {slots && (
          <>
            {/* Basis preset (conditional) */}
            {slots.basis && (
              <BasisSelector basisSlot={slots.basis} lang={lang} />
            )}

            {/* Refs (primary) */}
            <Section
              title={t('section.refs')}
              icon={FileText}
              iconColor="text-emerald-500 dark:text-emerald-400"
              hint={refsHint}
            >
              {hasRefSlots ? (
                <SlotEntryList
                  entries={refEntries}
                  selected={selectedRefs}
                  onToggle={(p) => toggleFile(p, 'refs')}
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
            <Section
              title={t('section.context')}
              icon={BookOpen}
              iconColor="text-gray-500 dark:text-gray-400"
              hint={hasCtxSlots ? { label: t('section.optional'), tooltip: t('section.optionalHint'), colorScheme: 'gray' as const } : undefined}
            >
              {hasCtxSlots ? (
                <SlotEntryList
                  entries={ctxEntries}
                  selected={selectedCtx}
                  onToggle={(p) => toggleFile(p, 'context')}
                  onHighlightDir={(dir) => highlightArtifactDirs([dir])}
                  onCreateIntent={handleCreateIntent}
                  onToggleSpotlight={handleToggleSpotlight}
                  onViewFile={handleViewFile}
                  spotlightPath={spotlightTarget?.path}
                  showEmptyActions={false}
                  lang={lang}
                />
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic px-1">
                  {t('section.none')}
                </p>
              )}
            </Section>

            {/* Target */}
            <Section
              title={t('section.target')}
              icon={Crosshair}
              iconColor="text-orange-500 dark:text-orange-400"
              hint={targetHint}
            >
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
      </PageTransition>

      <ActionFooter actionId={actionId} />
    </div>
  );
}
