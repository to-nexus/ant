import { useStore } from '@/domain/store';
import { useActionReadiness } from '@/application/hooks/features/useActionReadiness';
import { useTranslation } from 'react-i18next';
import { ACTION_DEFINITIONS, type ActionId } from '@ant/shared';
import { ActionChipGrid } from './ActionChipGrid';
import { ActionSubModeStep } from './ActionSubModeStep';
import { ActionDetailView } from './ActionDetailView';

export function ActionsPanel() {
  const { t } = useTranslation('actions');
  const readiness = useActionReadiness();
  const step = useStore(s => s.actionsStep);
  const selectedActionId = useStore(s => s.selectedActionId) as ActionId | null;
  const setActionsStep = useStore(s => s.setActionsStep);
  const selectAction = useStore(s => s.selectAction);
  const selectSubMode = useStore(s => s.selectSubMode);

  const selectedDef = selectedActionId ? ACTION_DEFINITIONS.find(d => d.id === selectedActionId) : null;

  const handleActionSelect = (actionId: ActionId) => {
    selectAction(actionId);
    const def = ACTION_DEFINITIONS.find(d => d.id === actionId);
    if (def?.hasSubModes) {
      setActionsStep('pick-mode');
    } else {
      setActionsStep('detail');
    }
  };

  const handleSubModeSelect = (modeId: string) => {
    selectSubMode(modeId);
    setActionsStep('detail');
  };

  const handleBack = () => {
    if (step === 'detail' && selectedDef?.hasSubModes) {
      setActionsStep('pick-mode');
    } else {
      setActionsStep('pick-action');
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-[#161b22]">
      <div className="flex-1 overflow-y-auto">
        {step === 'pick-action' && (
          <div className="h-full flex items-center justify-center p-8 animate-fadeIn">
            <ActionChipGrid
              readiness={readiness}
              variant="large"
              onSelect={handleActionSelect}
              title={t('title')}
            />
          </div>
        )}

        {step === 'pick-mode' && selectedActionId && (
          <div className="h-full animate-fadeIn">
            <ActionSubModeStep
              actionId={selectedActionId}
              readiness={readiness[selectedActionId]}
              onSelect={handleSubModeSelect}
              onBack={handleBack}
            />
          </div>
        )}

        {step === 'detail' && selectedActionId && (
          <div className="h-full animate-fadeIn">
            <ActionDetailView
              actionId={selectedActionId}
              readiness={readiness[selectedActionId]}
              onBack={handleBack}
            />
          </div>
        )}
      </div>
    </div>
  );
}
