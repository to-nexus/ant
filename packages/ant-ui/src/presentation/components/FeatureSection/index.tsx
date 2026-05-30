import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useFeatureActions } from './hooks/useFeatureActions.tsx';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { QuickStartCTA } from '../common/QuickStartCTA';
import { CreationWizardModal } from '../CreationWizardModal';
import { SectionShell } from '../layout/Explorer/SectionShell';
import { RowList } from '../layout/Explorer/RowList';
import { FeatureRow } from '../layout/Explorer/FeatureRow';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { FeatureDeletionPanel } from '../common/FeatureDeletion/FeatureDeletionPanel';

/**
 * Aurora-tokenized FeatureSection.
 *
 * Spec §1.1.6 / §5.4 / §6.2-T8 deletions enforced here:
 *   - Preview server status panel JSX (installing/starting/running/error) — not rendered
 *   - JOB progress chip — not rendered
 *   - Domain hint chip — not rendered
 *   - Open / Fix / Install buttons — replaced by single Preview Editor entry
 *     (Monitor icon + "에디터" label) on the active row only
 *
 * The `useFeaturePreviewServer` / job-progress hooks remain available in
 * `application/hooks` for other consumers — this component simply does
 * not subscribe to them. Inactive rows do NOT switch on body-click; the
 * dedicated "전환" button surfaces the switching cost explicitly.
 */
export function FeatureSection({ explorerWidth: _explorerWidth }: { explorerWidth: number }) {
  const {
    features,
    selectedProject,
    selectedFeature,
    fetchFeatures,
  } = useStore();

  const { t } = useTranslation(['artifacts', 'nav', 'onboarding', 'common', 'explorer']);
  const policy = useUIActionPolicy();
  const runningJobsByFeature = useStore((state) => state.runningJobsByFeature);
  const { showConfirm } = useAlertModalContext();

  const {
    handleCreateFeature,
    handleDeleteFeature,
    handleForceDeleteFeature,
    handleFeatureChange,
  } = useFeatureActions(selectedProject);

  const setQuickStartProjectId = useStore((state) => state.setQuickStartProjectId);
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);

  // Defensive: auto-refresh features when the section mounts with a project
  // selected but an empty features list (e.g. after QuickStart transition).
  useEffect(() => {
    if (selectedProject && features.length === 0) {
      fetchFeatures(selectedProject);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  const [showWizard, setShowWizard] = useState(false);
  const [forceInlineCreate, setForceInlineCreate] = useState(false);
  const [newFeatureName, setNewFeatureName] = useState('');
  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleCreateEmpty = useCallback(() => {
    setShowWizard(false);
    setForceInlineCreate(true);
  }, []);

  // Filter out internal 'main' feature
  const visibleFeatures = useMemo(
    () => features.filter((f) => f.name !== 'main'),
    [features],
  );

  // Active feature on top, others below
  const orderedFeatures = useMemo(() => {
    if (!selectedFeature) return visibleFeatures;
    return [
      ...visibleFeatures.filter((f) => f.name === selectedFeature),
      ...visibleFeatures.filter((f) => f.name !== selectedFeature),
    ];
  }, [visibleFeatures, selectedFeature]);

  const handleSwitchFeature = useCallback(
    (name: string) => {
      if (!policy.canChangeFeature) return;
      handleFeatureChange(name);
    },
    [policy.canChangeFeature, handleFeatureChange],
  );

  const handleClearFeature = useCallback(() => {
    handleFeatureChange(null);
  }, [handleFeatureChange]);

  const handleOpenPreviewEditor = useCallback(() => {
    openMainPanelTab('previewConfig');
  }, [openMainPanelTab]);

  const handleDelete = useCallback(
    (name: string) => {
      if (!selectedProject) return;
      const featureKey = `${selectedProject}/${name}`;
      if (runningJobsByFeature[featureKey]) {
        return;
      }
      showConfirm(t('explorer:feature.deleteConfirm', { name, defaultValue: `Delete feature "${name}"?` }), {
        type: 'warning',
        title: t('explorer:feature.deleteTitle', { defaultValue: 'Delete feature' }),
        confirmText: t('common:button.delete', { defaultValue: 'Delete' }),
        cancelText: t('common:button.cancel', { defaultValue: 'Cancel' }),
        onConfirm: () => handleDeleteFeature(name),
      });
    },
    [selectedProject, runningJobsByFeature, showConfirm, t, handleDeleteFeature],
  );

  const handleSubmitNewFeature = useCallback(async () => {
    const name = newFeatureName.trim();
    if (!name) return;
    try {
      await handleCreateFeature(name);
      setNewFeatureName('');
      setForceInlineCreate(false);
    } catch (err) {
      console.error('Failed to create feature:', err);
    }
  }, [newFeatureName, handleCreateFeature]);

  if (!selectedProject) {
    return null;
  }

  return (
    <div>
      <SectionShell
        eyebrow={t('explorer:feature.title', { defaultValue: 'Feature' })}
        count={visibleFeatures.length}
        accent="pink"
        action={
          <button
            type="button"
            onClick={handleOpenWizard}
            disabled={!policy.canCreateFeature}
            onMouseEnter={(e) => {
              if (!policy.canCreateFeature) return;
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--pink-600)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-3)';
            }}
            title={
              !policy.canCreateFeature
                ? policy.createFeatureDisabledReason || undefined
                : t('explorer:featureDropdown.featureNamePlaceholder', { defaultValue: 'New feature' })
            }
            aria-label={t('explorer:feature.create', { defaultValue: 'New feature' })}
            style={{
              height: 22,
              width: 22,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              color: 'var(--text-3)',
              background: 'transparent',
              border: 'none',
              cursor: policy.canCreateFeature ? 'pointer' : 'not-allowed',
              opacity: policy.canCreateFeature ? 1 : 0.5,
              transition: 'all var(--dur-fast)',
            }}
          >
            <Plus size={12} />
          </button>
        }
      >
        {visibleFeatures.length === 0 ? (
          <div
            style={{
              padding: '14px 8px',
              fontSize: 11,
              fontStyle: 'italic',
              color: 'var(--text-3)',
              textAlign: 'center',
            }}
          >
            {t('explorer:feature.placeholder', { defaultValue: 'No features yet' })}
          </div>
        ) : (
          <RowList ariaLabel={t('explorer:feature.title', { defaultValue: 'Feature' })}>
            {orderedFeatures.map((feature) => {
              const isActive = feature.name === selectedFeature;
              const featureKey = `${selectedProject}/${feature.name}`;
              const deleteBlocked = !!runningJobsByFeature[featureKey];
              return (
                <FeatureRow
                  key={feature.name}
                  name={feature.name}
                  isActive={isActive}
                  disabled={!policy.canChangeFeature && !isActive}
                  disabledReason={policy.disabledReason || undefined}
                  onSwitch={() => handleSwitchFeature(feature.name)}
                  onClear={isActive ? handleClearFeature : undefined}
                  onOpenPreviewEditor={isActive ? handleOpenPreviewEditor : undefined}
                  onDelete={
                    !isActive && !deleteBlocked
                      ? () => handleDelete(feature.name)
                      : undefined
                  }
                  deleteBlockedReason={
                    deleteBlocked
                      ? t('nav:tabs.featureDeleteBlocked', { defaultValue: 'Job running' })
                      : undefined
                  }
                />
              );
            })}
          </RowList>
        )}

        {forceInlineCreate && (
          <div
            style={{
              marginTop: 6,
              display: 'flex',
              gap: 4,
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              autoFocus
              value={newFeatureName}
              onChange={(e) => setNewFeatureName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmitNewFeature();
                if (e.key === 'Escape') {
                  setForceInlineCreate(false);
                  setNewFeatureName('');
                }
              }}
              placeholder={t('explorer:featureDropdown.featureNamePlaceholder', { defaultValue: 'feature-name' })}
              style={{
                flex: 1,
                minWidth: 0,
                height: 26,
                padding: '0 8px',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text-1)',
                background: 'var(--surface-1)',
                border: '1px solid var(--border-1)',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => void handleSubmitNewFeature()}
              disabled={!newFeatureName.trim()}
              style={{
                height: 26,
                padding: '0 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-on-brand)',
                background: 'var(--gradient-aurora)',
                boxShadow: 'var(--shadow-glow-aurora)',
                border: 'none',
                cursor: newFeatureName.trim() ? 'pointer' : 'not-allowed',
                opacity: newFeatureName.trim() ? 1 : 0.5,
              }}
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => {
                setForceInlineCreate(false);
                setNewFeatureName('');
              }}
              style={{
                height: 26,
                padding: '0 10px',
                borderRadius: 6,
                fontSize: 11,
                color: 'var(--text-3)',
                background: 'transparent',
                border: '1px solid var(--border-1)',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        )}
      </SectionShell>

      <CreationWizardModal
        isOpen={showWizard}
        onClose={handleCloseWizard}
        existingProjectId={selectedProject}
        onCreateEmpty={handleCreateEmpty}
      />

      {visibleFeatures.length === 0 && selectedProject && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <QuickStartCTA
            variant="plan"
            title={t('onboarding:quickstart.fleshOutIdea')}
            hint={t('onboarding:quickstart.fleshOutIdeaHint')}
            onClick={() => setQuickStartProjectId(selectedProject)}
          />
        </div>
      )}

      <FeatureDeletionPanel onForceDelete={handleForceDeleteFeature} />
    </div>
  );
}
