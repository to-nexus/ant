/**
 * TopUpModal — credit-package picker (independent of plans).
 *
 * The package grid that used to sit inline in the account summary lives here.
 * Packages come from the server-driven catalog; selecting one opens the
 * (mock) checkout. Buying credits is orthogonal to the subscription plan.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { Modal } from '../common/Modal';
import { Spinner } from '../common/async';
import { CreditPurchaseModal } from './CreditPurchaseModal';
import { formatUsd, formatCredits } from '@/shared/utils/tokenUtils';
import type { CreditPackageInfo } from '@ant/shared';

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TopUpModal({ isOpen, onClose }: TopUpModalProps) {
  const { t } = useTranslation('config');
  const catalog = useStore((s) => s.billingCatalog);
  const refreshCatalog = useStore((s) => s.refreshCatalog);
  const [selectedPkg, setSelectedPkg] = useState<CreditPackageInfo | null>(null);

  useEffect(() => {
    if (isOpen) void refreshCatalog();
  }, [isOpen, refreshCatalog]);

  const packages = catalog.data?.creditPackages ?? [];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t('account.topUpTitle', 'Buy credits')}
        eyebrow={t('account.buyCredits', 'Purchase')}
        accent="violet"
        size="md"
      >
        {catalog.status === 'loading' || (catalog.status === 'idle' && catalog.refreshing) ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {packages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setSelectedPkg(pkg)}
                className="flex flex-col items-start gap-0.5 rounded p-2.5 text-left transition-colors"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
              >
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {t(`account.package_${pkg.id}`, pkg.id)}
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                  {formatCredits(pkg.credits)}
                </span>
                <span className="text-xs font-mono" style={{ color: 'var(--text-2)' }}>
                  {formatUsd(pkg.priceUsd)}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <CreditPurchaseModal pkg={selectedPkg} onClose={() => setSelectedPkg(null)} />
    </>
  );
}
