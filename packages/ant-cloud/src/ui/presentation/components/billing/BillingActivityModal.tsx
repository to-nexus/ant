/**
 * BillingActivityModal — full credit charge/usage ledger.
 *
 * The ledger is hard-capped at CREDIT_LEDGER_MAX_ENTRIES server-side, so the
 * modal fetches the whole thing in one call (on open) and filters client-side.
 * Kept out of the account-settings section so that surface never grows with
 * the transaction count.
 *
 * USD cost is shown only when the BE marks the caller an operator
 * (`billingCanViewUsd`) — the FE never decides visibility itself.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { Modal } from '@/presentation/components/common/Modal';
import { AsyncBoundary, EmptyFallback, useAsyncResource } from '@/presentation/components/common/async';
import { formatCredits, formatUsd } from '@/shared/utils/tokenUtils';
import {
  CREDIT_LEDGER_MAX_ENTRIES,
  microCreditsToCredits,
  type CreditTransaction,
} from '@ant/shared';

interface BillingActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ActivityFilter = 'all' | 'usage' | 'charges';

/** `debit` is consumption; everything else (topup/grant/refund/adjustment) is a charge. */
function matchesFilter(tx: CreditTransaction, filter: ActivityFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'usage') return tx.kind === 'debit';
  return tx.kind !== 'debit';
}

export function BillingActivityModal({ isOpen, onClose }: BillingActivityModalProps) {
  const { t, i18n } = useTranslation('config');
  const refreshUsage = useStore((s) => s.refreshUsage);
  const canViewUsd = useStore((s) => s.billingCanViewUsd);
  const usage = useAsyncResource<CreditTransaction[]>((s) => s.billingUsage);

  const [filter, setFilter] = useState<ActivityFilter>('all');

  useEffect(() => {
    if (isOpen) void refreshUsage(CREDIT_LEDGER_MAX_ENTRIES);
  }, [isOpen, refreshUsage]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [i18n.language],
  );

  const FILTERS: { id: ActivityFilter; label: string }[] = [
    { id: 'all', label: t('account.filterAll', 'All') },
    { id: 'usage', label: t('account.filterUsage', 'Usage') },
    { id: 'charges', label: t('account.filterCharges', 'Charges') },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('account.creditActivityTitle', 'Credit activity')}
      size="lg"
      accent="aurora"
    >
      <div className="space-y-3">
        {/* Filter tabs */}
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className="px-3 py-1 text-xs rounded-full transition-colors"
                style={{
                  background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-1)'}`,
                  color: active ? 'var(--accent)' : 'var(--text-3)',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <AsyncBoundary
          surface="modal"
          resource={usage}
          retry={() => void refreshUsage(CREDIT_LEDGER_MAX_ENTRIES)}
          empty={<EmptyFallback description={t('account.activityEmpty', 'No activity yet')} />}
        >
          {(txs) => {
            const rows = txs.filter((tx) => matchesFilter(tx, filter));
            if (rows.length === 0) {
              return (
                <div className="text-xs italic py-6 text-center" style={{ color: 'var(--text-3)' }}>
                  {t('account.activityEmpty', 'No activity yet')}
                </div>
              );
            }
            return (
              <div className="max-h-[60vh] overflow-y-auto space-y-0.5 pr-1">
                {rows.map((tx) => {
                  const credited = tx.microCredits >= 0;
                  return (
                    <div
                      key={tx.id}
                      className="flex items-start justify-between gap-3 py-1.5 px-1 rounded text-xs"
                      style={{ borderBottom: '1px solid var(--border-1)' }}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium" style={{ color: 'var(--text-2)' }}>
                            {t(`account.kind_${tx.kind}`, tx.kind)}
                          </span>
                          <span style={{ color: 'var(--text-4)' }}>{dateFmt.format(new Date(tx.ts))}</span>
                        </div>
                        {(tx.featureName || tx.projectId) && (
                          <div className="truncate" style={{ color: 'var(--text-3)' }}>
                            {tx.featureName ?? tx.projectId}
                          </div>
                        )}
                        {tx.note && (
                          <div className="truncate text-[11px]" style={{ color: 'var(--text-4)' }}>
                            {tx.note}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end whitespace-nowrap tabular-nums">
                        <span style={{ color: credited ? 'var(--status-done-fg)' : 'var(--text-1)' }}>
                          {credited ? '+' : '−'}
                          {formatCredits(Math.abs(microCreditsToCredits(tx.microCredits)))}
                        </span>
                        {canViewUsd && tx.usdCost !== undefined && (
                          <span style={{ color: 'var(--text-4)' }}>{formatUsd(tx.usdCost)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }}
        </AsyncBoundary>
      </div>
    </Modal>
  );
}
