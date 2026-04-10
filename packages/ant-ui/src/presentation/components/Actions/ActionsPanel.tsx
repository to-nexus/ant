import { useStore } from '@/domain/store';
import { useActionReadiness } from '@/application/hooks/features/useActionReadiness';
import { useTranslation } from 'react-i18next';
import { ACTION_DEFINITIONS, getIntentsForAction, type ActionId } from '@ant/shared';
import { ActionChipGrid, IntentChipGrid, type ChipItem } from './ActionChipGrid';
import { ActionConfigView } from './ActionConfigView';
import { ActionStepHeader } from './ActionStepHeader';
import { ACTION_VISUALS } from './ActionChip';

export function ActionsPanel() {
  const { t, i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';
  const readiness = useActionReadiness();
  const step = useStore(s => s.actionsStep);
  const selectedActionId = useStore(s => s.selectedActionId) as ActionId | null;
  const selectedIntentId = useStore(s => s.selectedIntentId);
  const setActionsStep = useStore(s => s.setActionsStep);
  const selectAction = useStore(s => s.selectAction);
  const selectIntent = useStore(s => s.selectIntent);

  const handleActionSelect = (actionId: ActionId) => {
    selectAction(actionId);
    setActionsStep('pick-intent');
  };

  const handleIntentSelect = (intentId: string) => {
    selectIntent(intentId);
    setActionsStep('config');
  };

  const handleBack = () => {
    if (step === 'config') {
      const intents = selectedActionId ? getIntentsForAction(selectedActionId) : [];
      if (intents.length > 1) {
        setActionsStep('pick-intent');
      } else {
        setActionsStep('pick-action');
      }
    } else {
      setActionsStep('pick-action');
    }
  };

  const intentChipItems = (): ChipItem[] => {
    if (!selectedActionId) return [];
    const intents = getIntentsForAction(selectedActionId);
    const visual = ACTION_VISUALS[selectedActionId];

    return intents.map(intent => ({
      id: intent.id,
      label: intent.label[lang] || intent.label.en,
      description: intent.description[lang] || intent.description.en,
      icon: visual?.icon,
      bg: visual?.bg,
      text: visual?.text,
    }));
  };

  const actionDef = selectedActionId ? ACTION_DEFINITIONS.find(d => d.id === selectedActionId) : null;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-[#161b22]">
      <div className="flex-1 overflow-y-auto">
        {step === 'pick-action' && (
          <div className="h-full flex items-center justify-center p-8 overflow-y-auto animate-fadeIn">
            <ActionChipGrid
              readiness={readiness}
              variant="large"
              onSelect={handleActionSelect}
              title={t('title')}
            />
          </div>
        )}

        {step === 'pick-intent' && selectedActionId && (
          <div className="h-full flex flex-col animate-fadeIn">
            <div className="shrink-0 px-8 pt-8">
              <ActionStepHeader
                actionId={selectedActionId}
                title={actionDef?.label[lang] || actionDef?.label.en || ''}
                subtitle={actionDef?.description[lang] || actionDef?.description.en}
                onBack={() => setActionsStep('pick-action')}
              />
            </div>
            <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
              <IntentChipGrid
                items={intentChipItems()}
                onSelect={handleIntentSelect}
              />
            </div>
          </div>
        )}

        {step === 'config' && selectedActionId && selectedIntentId && (
          <div className="h-full animate-fadeIn">
            <ActionConfigView
              actionId={selectedActionId}
              intentId={selectedIntentId}
              onBack={handleBack}
            />
          </div>
        )}
      </div>
    </div>
  );
}
