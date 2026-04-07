import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  X,
} from 'lucide-react';
import { ansiConverter } from '../utils';

type Issue = { reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string };
type LogEntry = { timestamp: string; type: 'stdout' | 'stderr'; message: string };

export function StatusConsoleSection({
  issues,
  logs,
  fatalIssues,
  warningIssues,
  isRunning,
  isReady,
  dismissedSet,
  logsExpanded,
  setLogsExpanded,
  onDismissError,
  onApplyToChat,
}: {
  issues: Issue[];
  logs: LogEntry[];
  fatalIssues: Issue[];
  warningIssues: Issue[];
  isRunning: boolean;
  isReady: boolean;
  dismissedSet: Set<string>;
  logsExpanded: boolean;
  setLogsExpanded: (v: boolean) => void;
  onDismissError: (key: string) => void;
  onApplyToChat: (msg: string) => void;
}) {
  const { t } = useTranslation('explorer');

  const visibleFatal = useMemo(
    () => fatalIssues.filter(i => !dismissedSet.has(`issue:${i.reason}`)),
    [fatalIssues, dismissedSet],
  );
  const visibleWarnings = useMemo(
    () => warningIssues.filter(i => !dismissedSet.has(`issue:${i.reason}`)),
    [warningIssues, dismissedSet],
  );

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        {t('preview.statusConsole', 'Status Console')}
      </h3>

      {/* Fatal issues */}
      {visibleFatal.length > 0 && (
        <div className="space-y-2 mb-3">
          {visibleFatal.map((issue) => (
            <div key={issue.reason} className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-red-700 dark:text-red-300">{issue.reason}</p>
                  {issue.suggestedFix && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={() => onApplyToChat(issue.suggestedFix!)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                                 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300
                                 hover:bg-red-200 dark:hover:bg-red-800/50 transition-colors"
                      >
                        <MessageSquare className="w-3 h-3" />
                        Fix
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onDismissError(`issue:${issue.reason}`)}
                  className="p-0.5 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors flex-shrink-0"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warning issues */}
      {visibleWarnings.length > 0 && (
        <div className="space-y-2 mb-3">
          {visibleWarnings.map((issue) => (
            <div key={issue.reason} className="p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-yellow-700 dark:text-yellow-300">{issue.reason}</p>
                  {issue.suggestedFix && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={() => onApplyToChat(issue.suggestedFix!)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded
                                 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300
                                 hover:bg-yellow-200 dark:hover:bg-yellow-800/50 transition-colors"
                      >
                        <MessageSquare className="w-3 h-3" />
                        Fix
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onDismissError(`issue:${issue.reason}`)}
                  className="p-0.5 text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 transition-colors flex-shrink-0"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {issues.length === 0 && !isRunning && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t('preview.noIssues', 'No issues. Start the preview server to see status.')}
        </p>
      )}

      {issues.length === 0 && isRunning && isReady && (
        <p className="text-xs text-green-500 dark:text-green-400">
          {t('preview.allChecksPassed', 'All checks passed.')}
        </p>
      )}

      {/* Logs (collapsible) */}
      {logs.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setLogsExpanded(!logsExpanded)}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {logsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {t('preview.logsCount', 'Logs ({{count}})', { count: logs.length })}
          </button>
          {logsExpanded && (
            <div className="mt-2 max-h-60 overflow-y-auto bg-gray-900 dark:bg-gray-950 rounded-md p-3">
              {logs.slice(-50).map((log, idx) => (
                <div
                  key={`${log.timestamp}-${idx}`}
                  className={`text-xs font-mono leading-relaxed ${
                    log.type === 'stderr' ? 'text-red-400' : 'text-gray-300'
                  }`}
                  dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(log.message) }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
