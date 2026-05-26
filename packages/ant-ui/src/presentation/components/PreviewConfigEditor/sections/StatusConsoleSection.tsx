import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  MessageSquare,
  X,
} from 'lucide-react';
import {
  SectionCard,
  StatusPill,
} from '@/presentation/components/ConfigEditor/aurora';

type Issue = {
  reasoning: string;
  severity: 'fatal' | 'warning';
  reason: string;
  suggestedFix?: string;
};

export function StatusConsoleSection({
  issues,
  fatalIssues,
  warningIssues,
  isRunning,
  isReady,
  dismissedSet,
  onDismissError,
  onApplyToChat,
}: {
  issues: Issue[];
  fatalIssues: Issue[];
  warningIssues: Issue[];
  isRunning: boolean;
  isReady: boolean;
  dismissedSet: Set<string>;
  onDismissError: (key: string) => void;
  onApplyToChat: (msg: string) => void;
}) {
  const { t } = useTranslation('explorer');

  const visibleFatal = useMemo(
    () => fatalIssues.filter((i) => !dismissedSet.has(`issue:${i.reason}`)),
    [fatalIssues, dismissedSet],
  );
  const visibleWarnings = useMemo(
    () => warningIssues.filter((i) => !dismissedSet.has(`issue:${i.reason}`)),
    [warningIssues, dismissedSet],
  );

  const statusPills =
    visibleFatal.length > 0 || visibleWarnings.length > 0 ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {visibleFatal.length > 0 && (
          <StatusPill
            state="error"
            label={t('preview.issueCountFatal', '치명 {{n}}', {
              n: visibleFatal.length,
            })}
          />
        )}
        {visibleWarnings.length > 0 && (
          <StatusPill
            state="warning"
            label={t('preview.issueCountWarn', '경고 {{n}}', {
              n: visibleWarnings.length,
            })}
          />
        )}
      </span>
    ) : undefined;

  const fixChipStyle = (
    bg: string,
    fg: string,
    border: string,
  ): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 700,
    background: bg,
    color: fg,
    border: `1px solid ${border}`,
    borderRadius: 'var(--r-sm)',
    cursor: 'pointer',
    letterSpacing: '0.02em',
  });

  return (
    <SectionCard
      icon="AlertTriangle"
      title={t('preview.statusConsole', '이슈')}
      description={t(
        'preview.statusConsoleDesc',
        '감지된 구성 문제. Fix 버튼으로 대화에 자동 수정을 요청할 수 있습니다.',
      )}
      accent="pink-orange"
      status={statusPills}
    >
      {/* Fatal issues */}
      {visibleFatal.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginBottom: visibleWarnings.length > 0 ? 10 : 0,
          }}
        >
          {visibleFatal.map((issue) => (
            <div
              key={issue.reason}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: 10,
                background: 'var(--status-error-bg)',
                border: '1px solid oklch(82% 0.12 25)',
                borderRadius: 'var(--r-md)',
                color: 'var(--status-error-fg)',
              }}
            >
              <AlertCircle
                size={13}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                  }}
                >
                  {issue.reason}
                </p>
                {issue.suggestedFix && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => onApplyToChat(issue.suggestedFix!)}
                      style={fixChipStyle(
                        'oklch(92% 0.08 25)',
                        'var(--status-error-fg)',
                        'oklch(82% 0.12 25)',
                      )}
                    >
                      <MessageSquare size={10} strokeWidth={2.2} />
                      Fix
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismissError(`issue:${issue.reason}`)}
                title={t('preview.dismiss', 'Dismiss')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--status-error-fg)',
                  cursor: 'pointer',
                  opacity: 0.7,
                  padding: 2,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Warning issues */}
      {visibleWarnings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibleWarnings.map((issue) => (
            <div
              key={issue.reason}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: 10,
                background: 'oklch(96% 0.04 50 / 0.6)',
                border: '1px solid oklch(82% 0.10 50)',
                borderRadius: 'var(--r-md)',
                color: 'oklch(48% 0.16 50)',
              }}
            >
              <AlertTriangle
                size={13}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                  }}
                >
                  {issue.reason}
                </p>
                {issue.suggestedFix && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => onApplyToChat(issue.suggestedFix!)}
                      style={fixChipStyle(
                        'oklch(92% 0.08 50)',
                        'oklch(48% 0.16 50)',
                        'oklch(82% 0.10 50)',
                      )}
                    >
                      <MessageSquare size={10} strokeWidth={2.2} />
                      Fix
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismissError(`issue:${issue.reason}`)}
                title={t('preview.dismiss', 'Dismiss')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'oklch(48% 0.16 50)',
                  cursor: 'pointer',
                  opacity: 0.7,
                  padding: 2,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {issues.length === 0 && !isRunning && (
        <p
          style={{
            margin: 0,
            color: 'var(--text-4)',
            fontStyle: 'italic',
            fontSize: 12,
          }}
        >
          {t(
            'preview.noIssues',
            'No issues. Start the preview server to see status.',
          )}
        </p>
      )}

      {issues.length === 0 && isRunning && isReady && (
        <p
          style={{
            margin: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'oklch(45% 0.16 155)',
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          <CheckCircle size={12} strokeWidth={2.2} />
          {t('preview.allChecksPassed', 'All checks passed.')}
        </p>
      )}
    </SectionCard>
  );
}
