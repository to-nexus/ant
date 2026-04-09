import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { ACTION_DEFINITIONS, type ActionId, type ActionReadiness } from '@ant/shared';
import { MessageSquare, Zap } from 'lucide-react';
import { executeCodeJob } from '@/infrastructure/http/cli';

interface ActionFooterProps {
  actionId: ActionId;
  readiness: ActionReadiness;
  disabled?: boolean;
}

export function ActionFooter({ actionId, readiness, disabled = false }: ActionFooterProps) {
  const { t, i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';

  const selectedProject = useStore(s => s.selectedProject);
  const selectedFeature = useStore(s => s.selectedFeature);
  const def = ACTION_DEFINITIONS.find(d => d.id === actionId);

  const handleChatStart = () => {
    if (!def || disabled) return;
    const store = useStore.getState();
    store.setSelectedAgent(def.agent);
    store.setSelectedJobType(def.jobType as any);
    requestAnimationFrame(() => {
      const input = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement | null;
      input?.focus();
    });
  };

  const handleBuild = async () => {
    if (!def || !selectedProject || !selectedFeature || !readiness.buildReady) return;

    const store = useStore.getState();
    store.setSelectedJobType(def.jobType as any);
    store.closeMainPanelTab('actions');
    store.selectMainPanelTab('job');
    store.setRunning(true, undefined, 'generate');

    try {
      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        jobType: def.jobType as any,
        agent: def.agent,
        chatSource: true,
      });

      const jobId = await jobExecution.jobId;
      if (jobId) {
        store.setRunning(true, jobId);
      }
    } catch (error) {
      console.error('[Actions] BUILD failed:', error);
      store.setRunning(false);
    }
  };

  const blockReason = readiness.buildBlockReason
    ? (readiness.buildBlockReason[lang] || readiness.buildBlockReason.en)
    : undefined;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 bg-white dark:bg-[#161b22]">
      <button
        type="button"
        onClick={handleChatStart}
        disabled={disabled}
        className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
          disabled
            ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
      >
        <MessageSquare className="w-4 h-4" />
        {t('footer.chatStart')}
      </button>

      <button
        type="button"
        onClick={handleBuild}
        disabled={disabled || !readiness.buildReady}
        className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
          readiness.buildReady
            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
      >
        <Zap className="w-4 h-4" />
        {t('footer.build')}
      </button>

      {blockReason && (
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
          {blockReason}
        </span>
      )}
    </div>
  );
}
