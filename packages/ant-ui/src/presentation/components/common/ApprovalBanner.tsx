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
        ? '이 계정은 비활성화되었습니다. 작업을 시작할 수 없습니다. 관리자에게 문의해 주세요.'
        : '관리자 승인 대기 중입니다. 승인이 완료되면 작업과 채팅을 사용할 수 있습니다.'}
    </div>
  );
}
