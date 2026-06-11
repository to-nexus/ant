/**
 * CreditPurchaseModal — credit top-up checkout (thin wrapper over PaymentModal).
 *
 * Independent of plan selection: buys a one-off credit package. The shared
 * PaymentModal owns the card form; this wrapper supplies the package order
 * summary and drives `purchaseCredits`.
 */

import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { PaymentModal } from './PaymentModal';
import { formatUsd, formatCredits } from '@/shared/utils/tokenUtils';
import type { CreditPackageInfo } from '@ant/shared';

interface CreditPurchaseModalProps {
  /** Selected package, or null when the modal is closed. */
  pkg: CreditPackageInfo | null;
  onClose: () => void;
}

export function CreditPurchaseModal({ pkg, onClose }: CreditPurchaseModalProps) {
  const { t } = useTranslation('config');
  const purchaseCredits = useStore((s) => s.purchaseCredits);

  if (!pkg) return null;

  return (
    <PaymentModal
      isOpen={!!pkg}
      onClose={onClose}
      title={t('account.purchaseTitle', 'Buy credits')}
      eyebrow={t('account.buyCredits', 'Purchase')}
      accent="violet"
      amountUsd={pkg.priceUsd}
      onPay={(pm) => purchaseCredits(pkg.id, pm)}
      successMessage={t('account.paymentSucceeded', { credits: formatCredits(pkg.credits) })}
      summary={
        <div
          className="flex items-center justify-between rounded p-3"
          style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}
        >
          <div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {t('account.orderSummary', 'Order')}
            </div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
              {t(`account.package_${pkg.id}`, pkg.id)} · {formatCredits(pkg.credits)}{' '}
              {t('account.creditsUnit', 'credits')}
            </div>
          </div>
          <div className="text-lg font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
            {formatUsd(pkg.priceUsd)}
          </div>
        </div>
      }
    />
  );
}
