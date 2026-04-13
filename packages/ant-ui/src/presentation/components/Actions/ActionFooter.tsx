import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { deriveFromIntent, type IntentGroup } from '@ant/shared';
import { MessageSquare, Zap, Loader2 } from 'lucide-react';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { addChatUserMessage } from '@/infrastructure/http/api';
import { useActionFooterPolicy } from '@/application/hooks/ui/useActionFooterPolicy';

interface ActionFooterProps {
  actionId: IntentGroup;
}

export function ActionFooter({ actionId }: ActionFooterProps) {
  const { t, i18n } = useTranslation('actions');

  const selectedProject = useStore(s => s.selectedProject);
  const selectedFeature = useStore(s => s.selectedFeature);
  const actionMetadata = useStore(s => s.actionMetadata);

  const policy = useActionFooterPolicy();

  const derived = actionMetadata.intent ? deriveFromIntent(actionMetadata.intent) : null;

  const handleChatStart = () => {
    if (!derived || !policy.canStartChat) return;
    const store = useStore.getState();
    store.updateActionMetadata({ explicit: true });
    requestAnimationFrame(() => {
      const input = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement | null;
      input?.focus();
    });
  };

  const handleBuild = async () => {
    if (!derived || !policy.canBuild || !selectedProject || !selectedFeature) return;

    const store = useStore.getState();
    store.updateActionMetadata({ explicit: true });
    store.setRunning(true, undefined, 'generate');

    const metadata = { ...useStore.getState().actionMetadata, locale: i18n.language };
    const hasMetadata = Object.keys(metadata).length > 0;
    const intentId = metadata.intent || '';
    const buildDirective = t(`buildDirective.${intentId}`, { defaultValue: t('footer.build') });

    try {
      await addChatUserMessage(
        selectedProject,
        selectedFeature,
        buildDirective,
        hasMetadata ? metadata : undefined,
      );

      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        jobType: derived.jobType as any,
        agent: derived.agent,
        overrideDirective: buildDirective,
        chatSource: true,
        actionMetadata: hasMetadata ? metadata : undefined,
      });

      store.setCurrentJob(jobExecution);

      if (hasMetadata) {
        store.resetActionMetadata();
      }

      jobExecution.onJobIdReady((jobId) => {
        useStore.getState().setRunning(true, jobId);
      });

      jobExecution.on('exit', (code, signal) => {
        const jobFailed = code !== 0 && code !== null;
        useStore.getState().setLastJobFailed(jobFailed);
        useStore.getState().setRunning(false);
        useStore.getState().setCurrentJob(null);
      });
    } catch (error) {
      console.error('[Actions] BUILD failed:', error);
      store.setRunning(false);
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 bg-white dark:bg-[#161b22]">
      <button
        type="button"
        onClick={handleChatStart}
        disabled={!policy.canStartChat}
        className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
          policy.canStartChat
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
      >
        <MessageSquare className="w-4 h-4" />
        {t('footer.chatStart')}
      </button>

      <button
        type="button"
        onClick={handleBuild}
        disabled={!policy.canBuild}
        className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
          policy.isBuilding
            ? 'bg-emerald-600 text-white cursor-wait'
            : policy.canBuild
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
      >
        {policy.isBuilding
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Zap className="w-4 h-4" />}
        {policy.isBuilding ? t('footer.building') : t('footer.build')}
      </button>

      {policy.buildDisabledReason && !policy.isBuilding && (
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
          {policy.buildDisabledReason === 'context-not-selected'
            ? t('footer.contextRequired')
            : policy.buildDisabledReason === 'refs-not-selected'
              ? t('footer.refsRequired')
              : ''}
        </span>
      )}
    </div>
  );
}
