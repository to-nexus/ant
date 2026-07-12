import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useGitSnapshot } from '@/domain/git-world';
import {
  INTENT_DEFINITIONS,
  getIntentsForAction,
  type IntentGroup,
  type IntentId,
  getConfigSlotsForDomain,
  getDefaultTargetPaths,
  getIntentLabel,
  pickDefaultUiSourceRefs,
  listActiveTiers,
  supportsReferenceCodebase,
  pruneFileTreeForWorkspaceDomain,
  type ReferenceTarget,
} from '@ant/shared';
import { FileTreePicker } from '@/presentation/components/common/FileTreePicker';
import { IntentTabNav } from './IntentTabNav';
import { DomainBadge } from './DomainBadge';
import { PageTransition } from './PageTransition';
import { ActionFooter } from './ActionFooter';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { FileText, BookOpen, Crosshair, Layers, Link2, Plus } from 'lucide-react';
import {
  Section,
  SlotEntryList,
  TargetDisplay,
  ReferenceTargetPicker,
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
  const { t: tCommon } = useTranslation('common');
  const lang = i18n.language as 'en' | 'ko';
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const selectedProject = useStore(s => s.selectedProject);
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

  const actionMetadata = useStore(s => s.actionMetadata);
  // D28-revised — single domain-aware slot SSOT. Drops wrong-domain
  // slots (`gen-code-*` ui-source vs game-art-source), collapses
  // `gen-plan`'s `target.outputs` to the single domain-correct file,
  // and rewrites plan-dir slot labels / `excludeFiles` so neither
  // domain ever previews the other domain's plan artifact.
  //
  // Codebase Channel SSOT — pass `hasCodebase` so plan/design intents
  // pick up the auto codebase context slot when the workspace contains
  // existing code. Greenfield workspaces are unaffected.
  const slots = getConfigSlotsForDomain(
    intentId,
    actionMetadata.domain ?? 'service',
    { hasCodebase: gitSnapshot?.hasCodebase ?? false },
  );

  const selectedRefs = useMemo(() => new Set(actionMetadata.refs ?? []), [actionMetadata.refs]);
  const selectedCtx = useMemo(() => new Set(actionMetadata.context ?? []), [actionMetadata.context]);

  useEffect(() => {
    if (!slots) {
      updateActionMetadata({ refs: undefined, context: undefined, target: undefined });
      return;
    }

    const refEntries = resolveSlotEntries(slots.refs, fileTree, undefined, warningCtx);
    // ui-source slots are hard-exclusive — feed them through the SSOT picker
    // (`pickDefaultUiSourceRefs`, canonical.ts) so the auto-fill never seeds
    // mixed UiSource paths into `actionMetadata.refs`. Without this funnel a
    // workspace with both `visual/ui/ant/*` and `visual/ui/figma/figma.json`
    // would auto-select both, producing a RAC that BE detect's
    // `validateUiSourceExclusivity` rejects mid-run.
    const refCandidates = refEntries
      .filter(e => e.def.required)
      .flatMap(e =>
        e.def.type === 'ui-source' && e.subgroups
          ? pickDefaultUiSourceRefs(e.subgroups)
          : e.files,
      )
      .filter(f => f.warnings.length === 0);
    // refsSingleSelect intents (rev-*, gen-code-spec/dev-by-spec) auto-pick
    // the most recently modified candidate, not the alphabetically-first one
    // — users iterating "generate doc → use doc" expect the doc they just
    // produced. Candidates without mtime sort last (deterministic fallback).
    let defaultRefPaths: string[];
    if (slots.refsSingleSelect && refCandidates.length > 1) {
      const latest = [...refCandidates].sort(
        (a, b) => (b.meta?.mtime ?? 0) - (a.meta?.mtime ?? 0),
      )[0];
      defaultRefPaths = [latest.path];
    } else {
      defaultRefPaths = refCandidates.map(f => f.path);
    }
    updateActionMetadata({ refs: defaultRefPaths.length > 0 ? defaultRefPaths : undefined });
    updateActionMetadata({ context: undefined });

    const { target } = slots;
    if (target.kind === 'revise') {
      // Revise targets the locked single ref selection — the matrix
      // helper returns undefined for `kind: 'revise'` because there is
      // no static path. Fall back to the resolved ref(s) here.
      updateActionMetadata({ target: defaultRefPaths.length > 0 ? defaultRefPaths : undefined });
    } else {
      // generate / codebase / chat-only — the matrix SSOT
      // (`getDefaultTargetPaths`) drives both this panel and BE detect's
      // explicit branch fallback. Keeping a single derivation here
      // prevents the FE/BE divergence that produced the
      // dusk-mounding-pilot regression (FE-only target population, BE
      // saw `target=undefined`).
      //
      // gen-plan output is the domain-neutral `plan/prd.md` in every
      // domain (a game PRD carries game sections via the overlay, not a
      // different filename).
      updateActionMetadata({
        target: getDefaultTargetPaths(intentId, actionMetadata.domain),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId, actionMetadata.domain]);

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
    const fromLabel = intentDef ? getIntentLabel(intentDef, actionMetadata.domain, lang) : intentId;
    const toLabel = getIntentLabel(targetIntentDef, actionMetadata.domain, lang);
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
  // Codebase Channel SSOT — plan/design 인텐트는 `getConfigSlots` 가 동적으로
  // codebaseSlot('context', { auto: true }) 를 주입하므로 context 쪽도 ref 와
  // 동일하게 codebaseHasFiles 를 흘려야 한다. 누락 시 resolveSlots.ts 의
  // def.codebase 분기가 hasFiles=false 로 평가되어 항상 amber empty card 로
  // 렌더된다 (실제 코드베이스 존재 여부와 무관).
  const ctxEntries = useMemo(() => slots ? resolveSlotEntries(slots.context, fileTree, selectedRefs, warningCtx, codebaseHasFiles) : [], [slots, fileTree, selectedRefs, warningCtx, codebaseHasFiles]);

  // Free-add picker (unified tree). Domain-pruned tree so a workspace never
  // exposes the other domain's asset pool (I6). `suggestedDirs` are the slot
  // candidate dirs so the tree ★-marks the recommended locations.
  const [pickerField, setPickerField] = useState<'refs' | 'context' | null>(null);
  const workspaceDomain = actionMetadata.domain ?? 'service';
  const prunedTree = useMemo(
    () => pruneFileTreeForWorkspaceDomain(fileTree as any, workspaceDomain) as typeof fileTree,
    [fileTree, workspaceDomain],
  );
  const suggestedRefDirs = useMemo(
    () => (slots?.refs ?? []).map(s => s.path).filter((p): p is string => !!p && p !== ''),
    [slots],
  );
  const suggestedCtxDirs = useMemo(
    () => (slots?.context ?? []).map(s => s.path).filter((p): p is string => !!p && p !== ''),
    [slots],
  );

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
          domain={actionMetadata.domain}
          rightAccessory={<DomainBadge />}
        />
      </div>

      <PageTransition pageKey={intentId} direction={directionRef.current} className="flex-1 overflow-y-auto p-5 space-y-5">

        {slots && (
          <>
            {/* Basis preset — visibility is gated on (static slot.tiers ×
                TIER_DOMAIN_MATRIX), evaluated by `listActiveTiers` with an
                empty runtime context so suppressors (`hasCodebase`,
                `hasUiDoc`, backend stack) do NOT hide the Section. The
                runtime suppressors are consumed only by
                `decideActionsStepAfterIntent` for auto-routing — they
                must not hide the manual override entry.
                  - rev-* / plan / spec intents declare `basis.tiers === []`
                    → 0 → skip (no wizard tiers to configure).
                  - gen-ui-figma / gen-game-art-figma → `tiers === []` → skip
                    (figma is the authority; the wizard would add nothing). */}
            {slots.basis && listActiveTiers(slots.basis, actionMetadata.domain ?? 'service').length > 0 && (
              <Section
                title={t('section.basis')}
                icon={Layers}
                iconColor="text-[var(--violet-500)]"
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
                      updated.techTier || updated.visualTier || updated.gameArtTier;
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
              iconColor="text-[var(--emerald-500)]"
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
                <p className="text-xs italic px-1" style={{ color: 'var(--text-3)' }}>
                  {slots.refs[0].emptyHint[lang] || slots.refs[0].emptyHint.en}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setPickerField('refs')}
                className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-[color:var(--text-3)] hover:text-[color:var(--emerald-600)] hover:bg-[color:var(--bg-hover)] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {tCommon('fileTreePicker.addRefs')}
              </button>
            </Section>

            {/* Context (secondary) */}
            <Section
              title={t('section.context')}
              icon={BookOpen}
              iconColor="text-[var(--text-3)]"
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
                <p className="text-xs italic px-1" style={{ color: 'var(--text-3)' }}>
                  {t('section.none')}
                </p>
              )}
              <button
                type="button"
                onClick={() => setPickerField('context')}
                className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-[color:var(--text-3)] hover:text-[color:var(--violet-600)] hover:bg-[color:var(--bg-hover)] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {tCommon('fileTreePicker.addContext')}
              </button>
            </Section>

            {/* Reference projects (cross-project code) — code + spec/system-design intents */}
            {supportsReferenceCodebase(intentId) && (
              <Section
                title={t('referenceCodebase.title')}
                icon={Link2}
                iconColor="text-[var(--sky-500)]"
              >
                <ReferenceTargetPicker
                  excludeProject={selectedProject}
                  selected={actionMetadata.referenceTargets ?? []}
                  onChange={(next: ReferenceTarget[]) =>
                    updateActionMetadata({ referenceTargets: next.length > 0 ? next : undefined })
                  }
                />
              </Section>
            )}

            {/* Target */}
            <Section
              title={t('section.target')}
              icon={Crosshair}
              iconColor="text-[var(--orange-500)]"
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

      {pickerField && (
        <FileTreePicker
          isOpen={true}
          onClose={() => setPickerField(null)}
          title={pickerField === 'refs' ? tCommon('fileTreePicker.addRefs') : tCommon('fileTreePicker.addContext')}
          eyebrow={pickerField === 'refs' ? t('section.refs') : t('section.context')}
          accent={pickerField === 'refs' ? 'emerald' : 'violet'}
          fileTree={prunedTree}
          initialSelected={pickerField === 'refs' ? [...selectedRefs] : [...selectedCtx]}
          suggestedDirs={pickerField === 'refs' ? suggestedRefDirs : suggestedCtxDirs}
          selectableTypes={['file', 'directory']}
          onConfirm={(paths) =>
            updateActionMetadata({ [pickerField]: paths.length > 0 ? paths : undefined })
          }
        />
      )}
    </div>
  );
}
