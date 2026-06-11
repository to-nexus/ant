/**
 * CreditRechargeCTA — the shared "credits ran out, top up" prompt.
 *
 * Surfaced in every credit-block case: a job paused mid-run on
 * `insufficient_credits`, a new job blocked at start (402), and a resume
 * blocked (402). Styled like a chat action card; the button routes to the
 * Payment Center (`/billing`).
 */

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CreditIcon } from './CreditIcon';

interface CreditRechargeCTAProps {
  /** Optional override message; defaults to a generic "credits exhausted" line. */
  message?: string;
  className?: string;
}

export function CreditRechargeCTA({ message, className }: CreditRechargeCTAProps) {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  return (
    <div
      className={`flex items-center gap-3 rounded-lg p-3 ${className ?? ''}`}
      style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-2)' }}
    >
      <CreditIcon size={16} gradient />
      <div className="flex-1 text-xs" style={{ color: 'var(--text-2)' }}>
        {message ?? t('credits.exhausted', '크레딧이 부족합니다. 충전하면 작업을 이어갈 수 있어요.')}
      </div>
      <button
        onClick={() => navigate('/billing')}
        className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-transform hover:scale-[1.03]"
        style={{ background: 'var(--gradient-violet-pink)', color: 'white' }}
      >
        {t('credits.recharge', '충전하기')}
      </button>
    </div>
  );
}
