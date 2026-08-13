import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { selectIsApproved } from '@/domain/store/selectors/auth';

/**
 * Persistent "waiting for admin approval" (or "account denied") banner. Renders
 * only when the cloud account is not approved — self-gated via
 * `selectIsApproved` (local / legacy / pre-verify all read approved → null).
 * The composer + job-start CTAs are separately disabled; the BE is the hard
 * gate (403 on job/chat start).
 */
export function ApprovalBanner() {
  const { t } = useTranslation('common');
  const isApproved = useStore((state) => selectIsApproved(state));
  const approvalStatus = useStore((state) => state.approvalStatus);
  if (isApproved) return null;

  const denied = approvalStatus === 'denied';
  return (
    <div
      role="status"
      className="w-full px-4 py-2 text-sm text-center"
      style={{
        background: denied ? 'var(--status-error-bg, var(--bg-surface-2))' : 'var(--bg-surface-2)',
        color: denied ? 'var(--status-error-fg, var(--text-2))' : 'var(--text-2)',
        borderBottom: '1px solid var(--border-1)',
      }}
    >
      {denied
        ? t('approval.denied', 'This account has been deactivated. You cannot start work. Please contact the operator.')
        : t('approval.pending', 'Waiting for operator approval. Jobs and chat unlock once your account is approved.')}
    </div>
  );
}
