import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useGitSnapshot } from '@/domain/git-world';
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
import { useActiveTiers } from '@/application/hooks/features/useActiveTiers';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { FileText, BookOpen, Crosshair, Layers } from 'lucide-react';
import {
  Section,
  SlotEntryList,
  TargetDisplay,
  resolveSlotEntries,
  listDir,
} from './config';
import { BasisSummaryBar } from './basis';
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
  const setBasisEditInitialTier = useStore(s => s.setBasisEditInitialTier);
  const figmaPopulated = useStore(s => s.figmaPopulated);
  const bridgeConnected = useStore(s => s.bridgeConnected);
  const figmaDesktopReachable = useStore(s => s.figmaDesktopReachable);
  const openMainPanelTab = useStore(s => s.openMainPanelTab);
  const selectFile = useStore(s => s.selectFile);
  const setMainView = useStore(s => s.setMainView);
  const setAccountConfigScrollTarget = useStore(s => s.setAccountConfigScrollTarget);
  const gitSnapshot = useGitSnapshot();
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
  // SSOT D27 — surface the BasisSummaryBar / Edit affordance only when at
  // least one tier is actually live for the current domain × runtime.
  // Static `slots.basis.tiers.length` would surface a Section whose Edit
  // button leads to an empty BasisWizard (sister bug to the
  // IntentChipGrid → blank-screen path).
  const activeTiers = useActiveTiers(slots?.basis);

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

  /**
   * Batch toggle used by dir-level cards (ui-source `ant` / `handoff`).
   * If every supplied path is already selected → deselect them all; otherwise
   * add the missing ones. Single `updateActionMetadata` call avoids the
   * state-races that looped `toggleFile` calls would trigger.
   */
  const toggleFiles = (paths: string[], field: 'refs' | 'context') => {
    if (paths.length === 0) return;
    const current = field === 'refs' ? (actionMetadata.refs ?? []) : (actionMetadata.context ?? []);
    const currentSet = new Set(current);
    const allSelected = paths.every(p => currentSet.has(p));
    const next = allSelected
      ? current.filter(p => !paths.includes(p))
      : [...current, ...paths.filter(p => !currentSet.has(p))];
    updateActionMetadata({ [field]: next.length > 0 ? next : undefined });
    if (field === 'refs' && slots?.target.kind === 'revise') {
      updateActionMetadata({ target: next.length > 0 ? next : undefined });
    }
  };

  const codebaseHasFiles = gitSnapshot?.codebaseHasFiles ?? false;
  const codebaseRequired = slots ? slots.refs.some(r => r.codebase && r.locked) : false;
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
            {/* Basis preset — rev-* intents declare `basis.tiers === []` so
                we skip the section entirely (their basis is fully encoded
                in the artifact under review; user picks would conflict).
                Domain × runtime gates can also collapse every tier — in
                that case there is nothing to edit, so the Section + Edit
                affordance must disappear (otherwise Edit lands on an
                empty BasisWizard). `useActiveTiers` is the SSOT facade
                that combines both. */}
            {slots.basis && activeTiers.length > 0 && (
              <Section
                title={t('section.basis')}
                icon={Layers}
                iconColor="text-violet-500 dark:text-violet-400"
              >
                <BasisSummaryBar
                  basisSlot={slots.basis}
                  onEdit={() => {
                    setBasisEditInitialTier(undefined);
                    setActionsStep('basis-edit');
                  }}
                  onEditTier={(tierKey) => {
                    setBasisEditInitialTier(tierKey);
                    setActionsStep('basis-edit');
                  }}
                  onResetTier={(tierKey) => {
                    const current = actionMetadata.basis;
                    if (!current) return;
                    const updated = { ...current, [tierKey]: undefined };
                    const hasAnything =
                      updated.techTier || updated.visualTier || updated.gameArtTier || updated.gameContentTier;
                    updateActionMetadata({ basis: hasAnything ? updated : undefined });
                  }}
                  lang={lang}
                />
              </Section>
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
                  onToggleMany={(paths) => toggleFiles(paths, 'refs')}
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
                  onToggleMany={(paths) => toggleFiles(paths, 'context')}
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
                codebaseHasFiles={codebaseHasFiles}
                codebaseRequired={codebaseRequired}
                lang={lang}
              />
            </Section>
          </>
        )}
      </PageTransition>

      <ActionFooter variant="intent" actionId={actionId} />
    </div>
  );
}
